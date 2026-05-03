const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  llamaBinaryPath: resolverBinaryPath,
  llamaDllDirs: resolverDllDirs
} = require("./platform/runtime-resolver");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 11435;
const DEFAULT_CONTEXT_SIZE = 16384;
const DEFAULT_GPU_LAYERS = 999;
const DEFAULT_BATCH_SIZE = 1024;
const STARTUP_TIMEOUT_MS = 180000;
const LOG_LIMIT = 240;

const state = {
  status: "idle",
  pid: null,
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  baseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1`,
  model: "",
  modelPath: "",
  binaryPath: "",
  startedAt: 0,
  lastError: "",
  logs: [],
  external: false
};

let serverProcess = null;
let startPromise = null;

function projectRoot() {
  const root = path.resolve(__dirname, "..");
  return root.includes("app.asar") ? root.replace("app.asar", "app.asar.unpacked") : root;
}

function userLocalAppData() {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function defaultUserModelDir() {
  return path.join(userLocalAppData(), process.platform === "linux" ? "dream-server" : "Dream Server", "models");
}

function legacyUserModelDir() {
  return path.join(os.homedir(), "dream-server", "data", "models");
}

function bundledModelDir() {
  return path.join(projectRoot(), "models");
}

function expandUserPath(value) {
  return String(value || "").trim().replace(/^~(?=$|[\\/])/, os.homedir());
}

function modelSearchDirs(settings = {}) {
  const dirs = [
    settings.localLlamaModelDir,
    process.env.DREAM_SERVER_MODELS_DIR,
    defaultUserModelDir(),
    legacyUserModelDir(),
    bundledModelDir()
  ];
  const seen = new Set();
  return dirs
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(expandUserPath)
    .map((entry) => path.resolve(entry))
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, predicate, options = {}) {
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 6;
  const results = [];

  async function visit(dir, depth) {
    if (depth > maxDepth) {
      return;
    }
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
      } else if (predicate(absolute, entry.name)) {
        results.push(absolute);
      }
    }
  }

  await visit(root, 0);
  return results;
}

async function findLlamaServerBinary() {
  const resolved = resolverBinaryPath();
  if (resolved) {
    return resolved;
  }

  const root = path.join(projectRoot(), "bin", "llama");
  const executableNames = process.platform === "win32"
    ? new Set(["llama-server.exe", "server.exe"])
    : new Set(["llama-server", "server"]);
  const matches = await walk(
    root,
    (_absolute, name) => executableNames.has(String(name).toLowerCase()),
    { maxDepth: 5 }
  );
  return matches[0] || "";
}

async function findDllDirs(runtimeDir) {
  if (process.platform !== "win32") {
    return [];
  }
  const resolved = resolverDllDirs();
  if (resolved.length > 0) {
    return resolved;
  }
  const dlls = await walk(
    runtimeDir,
    (_absolute, name) => String(name).toLowerCase().endsWith(".dll"),
    { maxDepth: 5 }
  );
  return [...new Set(dlls.map((file) => path.dirname(file)))];
}

function modelIdFromPath(modelPath) {
  return path.basename(String(modelPath || ""), path.extname(String(modelPath || "")));
}

async function listGgufModels(settings = {}) {
  const found = [];
  for (const dir of modelSearchDirs(settings)) {
    const models = await walk(
      dir,
      (_absolute, name) => String(name).toLowerCase().endsWith(".gguf"),
      { maxDepth: 2 }
    );
    for (const modelPath of models) {
      const stat = await fsp.stat(modelPath).catch(() => null);
      found.push({
        id: modelIdFromPath(modelPath),
        path: modelPath,
        size: stat?.size || 0,
        directory: dir
      });
    }
  }
  const seen = new Set();
  return found.filter((entry) => {
    const key = entry.path.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function findBestLocalModel(settings = {}) {
  const explicitPath = expandUserPath(settings.localLlamaModelPath);
  if (explicitPath && await exists(explicitPath)) {
    return {
      id: modelIdFromPath(explicitPath),
      path: path.resolve(explicitPath)
    };
  }

  const requested = String(settings.localModel || "").trim().toLowerCase();
  const models = await listGgufModels(settings);
  if (!models.length) {
    return null;
  }

  const exact = models.find((entry) =>
    entry.id.toLowerCase() === requested ||
    path.basename(entry.path).toLowerCase() === requested
  );
  if (exact) {
    return exact;
  }

  const gemma = models.find((entry) => entry.id.toLowerCase().includes("gemma"));
  if (gemma) {
    return gemma;
  }

  const qwen9 = models.find((entry) => entry.id.toLowerCase().includes("qwen3.5-9b"));
  if (qwen9) {
    return qwen9;
  }

  return [...models].sort((left, right) => right.size - left.size)[0];
}

function pushLog(line) {
  const text = String(line || "").trimEnd();
  if (!text) {
    return;
  }
  state.logs.push(text);
  if (state.logs.length > LOG_LIMIT) {
    state.logs.splice(0, state.logs.length - LOG_LIMIT);
  }
}

function snapshot() {
  return {
    status: state.status,
    pid: state.pid,
    host: state.host,
    port: state.port,
    baseUrl: state.baseUrl,
    model: state.model,
    modelPath: state.modelPath,
    binaryPath: state.binaryPath,
    startedAt: state.startedAt,
    lastError: state.lastError,
    logs: state.logs.slice(-80),
    external: state.external
  };
}

function emit(options, event) {
  if (typeof options?.onEvent === "function") {
    options.onEvent({
      type: "local_llama_status",
      ...snapshot(),
      ...event
    });
  }
}

async function probeServer(baseUrl, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: {
        Authorization: "Bearer not-needed"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function waitForReady(baseUrl, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : STARTUP_TIMEOUT_MS;
  while (Date.now() - startedAt < timeoutMs) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(state.lastError || `llama-server encerrou com codigo ${serverProcess.exitCode}.`);
    }
    if (await probeServer(baseUrl, 2500)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`llama-server nao respondeu em ${Math.round(timeoutMs / 1000)}s.`);
}

function normalizePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

async function ensureLocalLlamaServer(settings = {}, options = {}) {
  if (!settings.localLlamaEnabled) {
    return snapshot();
  }
  if (startPromise && !options.forceRestart) {
    return await startPromise;
  }

  startPromise = (async () => {
    const host = String(settings.localLlamaHost || DEFAULT_HOST).trim() || DEFAULT_HOST;
    const port = normalizePositiveInt(settings.localLlamaPort, DEFAULT_PORT, 1024, 65535);
    const baseUrl = `http://${host}:${port}/v1`;
    state.host = host;
    state.port = port;
    state.baseUrl = baseUrl;

    if (!options.forceRestart && serverProcess && serverProcess.exitCode === null) {
      settings.localBaseUrl = baseUrl;
      return snapshot();
    }

    if (!options.forceRestart && await probeServer(baseUrl, 1200)) {
      state.status = "running";
      state.external = true;
      state.lastError = "";
      settings.localBaseUrl = baseUrl;
      emit(options, { summary: "Servidor OpenAI-compatible ja esta ativo." });
      return snapshot();
    }

    const binaryPath = await findLlamaServerBinary();
    if (!binaryPath) {
      state.status = "missing-runtime";
      state.lastError = "llama-server nao encontrado em bin/llama para este sistema. Use Hermes Agent routing com provider externo ou empacote o runtime do llama.cpp deste OS.";
      emit(options, { summary: state.lastError });
      throw new Error(state.lastError);
    }

    const model = await findBestLocalModel(settings);
    if (!model?.path) {
      state.status = "missing-model";
      state.lastError = `Nenhum modelo .gguf encontrado. Coloque modelos em ${defaultUserModelDir()} ou configure a pasta de modelos.`;
      emit(options, { summary: state.lastError });
      throw new Error(state.lastError);
    }

    if (serverProcess && serverProcess.exitCode === null) {
      await stopLocalLlamaServer();
    }

    const contextSize = normalizePositiveInt(settings.localLlamaContextSize, DEFAULT_CONTEXT_SIZE, 512, 262144);
    const gpuLayers = normalizePositiveInt(settings.localLlamaGpuLayers, DEFAULT_GPU_LAYERS, 0, 999);
    const batchSize = normalizePositiveInt(settings.localLlamaBatchSize, DEFAULT_BATCH_SIZE, 1, 8192);
    const alias = model.id || modelIdFromPath(model.path);
    const args = [
      "-m", model.path,
      "--host", host,
      "--port", String(port),
      "-c", String(contextSize),
      "-ngl", String(gpuLayers),
      "-b", String(batchSize),
      "--alias", alias,
      "--cont-batching"
    ];

    const runtimeDir = path.dirname(binaryPath);
    const dllDirs = await findDllDirs(path.join(projectRoot(), "bin", "llama"));
    const env = {
      ...process.env,
      PATH: [...dllDirs, runtimeDir, process.env.PATH || ""].filter(Boolean).join(path.delimiter)
    };

    state.status = "starting";
    state.external = false;
    state.pid = null;
    state.binaryPath = binaryPath;
    state.model = alias;
    state.modelPath = model.path;
    state.lastError = "";
    state.logs = [];
    state.startedAt = Date.now();
    settings.localBaseUrl = baseUrl;
    settings.localModel = alias;
    settings.localLlamaModelPath = model.path;
    emit(options, { summary: `Iniciando llama.cpp gerenciado com ${alias}.` });

    serverProcess = spawn(binaryPath, args, {
      cwd: runtimeDir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    state.pid = serverProcess.pid || null;

    serverProcess.stdout?.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLog(line);
      }
    });
    serverProcess.stderr?.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLog(line);
      }
    });
    serverProcess.on("exit", (code, signal) => {
      state.pid = null;
      if (state.status !== "stopping") {
        state.status = code === 0 ? "stopped" : "error";
        state.lastError = code === 0 ? "" : `llama-server encerrou com codigo ${code}${signal ? ` (${signal})` : ""}.`;
      }
      serverProcess = null;
    });
    serverProcess.on("error", (error) => {
      state.status = "error";
      state.lastError = error.message || String(error);
      pushLog(state.lastError);
    });

    await waitForReady(baseUrl, {
      timeoutMs: normalizePositiveInt(settings.localLlamaStartupTimeoutMs, STARTUP_TIMEOUT_MS, 10000, 600000)
    });
    state.status = "running";
    state.lastError = "";
    emit(options, { summary: `llama.cpp ativo em ${baseUrl}.` });
    return snapshot();
  })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

async function stopLocalLlamaServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    state.status = state.status === "missing-runtime" || state.status === "missing-model" ? state.status : "stopped";
    state.pid = null;
    return snapshot();
  }

  const pid = serverProcess.pid;
  state.status = "stopping";
  if (process.platform === "win32" && pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  } else {
    serverProcess.kill("SIGTERM");
  }

  state.status = "stopped";
  state.pid = null;
  serverProcess = null;
  return snapshot();
}

module.exports = {
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_HOST,
  DEFAULT_PORT,
  defaultUserModelDir,
  ensureLocalLlamaServer,
  findBestLocalModel,
  getLocalLlamaState: snapshot,
  legacyUserModelDir,
  listGgufModels,
  stopLocalLlamaServer
};
