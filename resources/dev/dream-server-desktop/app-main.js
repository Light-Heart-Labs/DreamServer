const { app, BrowserWindow, Menu, dialog, safeStorage, ipcMain, shell, screen } = require("electron");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsNative = require("fs");
const { existsSync, mkdirSync } = fsNative;
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { DreamRuntime } = require("./runtime/core");
const { getLocalTokenTelemetry } = require("./runtime/providers/local");
const { createDefaultState, normalizeState } = require("./runtime/state");
const { normalizePathText } = require("./runtime/tools");

const execFileAsync = promisify(execFile);

let storePath;
let runtime;
let secretBlob = null;
let persistTimer = null;
let previewControlPath = "";
let desktopBridgePath = "";
let desktopBridgeServer = null;
let desktopBridgePort = 0;
let desktopBridgeToken = "";
let previewDeviceMode = "desktop";
let previewControlWatcherAttached = false;
let lastPreviewControlToken = "";
let managedLlamaBinaryPathCache = null;
let mainWindow = null;
let petWindow = null;
let petRuntime = {
  lastMode: "",
  lastLine: "",
  lastLineAt: 0
};
const previewHarnessRequests = new Map();
let mobilePreviewService = {
  child: null,
  port: 0,
  urls: null,
  starting: null,
  lastError: ""
};

function configureAppStorage() {
  const userDataRoot = path.join(app.getPath("appData"), "DreamServerDesktop");
  const cacheRoot = path.join(userDataRoot, "Cache");

  try {
    mkdirSync(userDataRoot, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
  } catch {}

  app.setPath("userData", userDataRoot);
  app.setPath("cache", cacheRoot);
  app.commandLine.appendSwitch("disk-cache-dir", cacheRoot);
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
}

configureAppStorage();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastCpuSample = null;
let gpuSnapshotCache = { sampledAt: 0, value: null };
let lastLlamaMetricsSample = null;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMetric(value, precision = 1) {
  const numeric = finiteNumber(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function mibToBytes(value) {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.round(numeric * 1024 * 1024);
}

function cpuTimesSnapshot() {
  const cpus = os.cpus();
  return cpus.reduce(
    (acc, cpu) => {
      const times = cpu.times || {};
      const idle = Number(times.idle || 0);
      const total = Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
      acc.idle += idle;
      acc.total += total;
      return acc;
    },
    { idle: 0, total: 0 }
  );
}

function sampleCpuPercent() {
  const next = cpuTimesSnapshot();
  const previous = lastCpuSample;
  lastCpuSample = next;
  if (!previous) {
    return null;
  }
  const idleDelta = next.idle - previous.idle;
  const totalDelta = next.total - previous.total;
  if (totalDelta <= 0) {
    return null;
  }
  return roundMetric(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)), 1);
}

async function execText(file, args = [], options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      timeout: options.timeoutMs || 1600,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 1024 * 512
    });
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function parseNvidiaCsvLine(line = "") {
  const [name, util, memUsed, memTotal, temp] = String(line)
    .split(",")
    .map((part) => part.trim());
  if (!name) {
    return null;
  }
  return {
    name,
    percent: roundMetric(util, 1),
    memoryUsedBytes: mibToBytes(memUsed),
    memoryTotalBytes: mibToBytes(memTotal),
    temperatureC: roundMetric(temp, 1),
    source: "nvidia-smi"
  };
}

async function queryNvidiaGpu() {
  const stdout = await execText(
    "nvidia-smi",
    [
      "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
      "--format=csv,noheader,nounits"
    ],
    { timeoutMs: 1800 }
  );
  const firstLine = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? parseNvidiaCsvLine(firstLine) : null;
}

async function queryWindowsGpuUsage() {
  if (process.platform !== "win32") {
    return null;
  }
  const command = [
    "$samples=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples;",
    "if($samples){",
    "$v=($samples | Measure-Object CookedValue -Sum).Sum;",
    "[math]::Round([math]::Min(100,[math]::Max(0,$v)),1)",
    "}"
  ].join(" ");
  const stdout = await execText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    timeoutMs: 1800
  });
  return roundMetric(stdout, 1);
}

async function queryWindowsGpuAdapter() {
  if (process.platform !== "win32") {
    return null;
  }
  const command = [
    "$a=Get-CimInstance Win32_VideoController |",
    "Where-Object { $_.Name } |",
    "Select-Object -First 1 Name,AdapterRAM,DriverVersion,VideoProcessor;",
    "if($a){$a | ConvertTo-Json -Compress}"
  ].join(" ");
  const stdout = await execText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    timeoutMs: 1800
  });
  if (!stdout) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout);
    const adapter = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      name: String(adapter?.Name || adapter?.VideoProcessor || "").trim(),
      percent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: finiteNumber(adapter?.AdapterRAM),
      temperatureC: null,
      source: "win32_video_controller"
    };
  } catch {
    return null;
  }
}

function parseMacVram(value = "") {
  const text = String(value || "").replace(",", ".");
  const match = text.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return Math.round(amount * (/gb/i.test(match[2]) ? 1024 * 1024 * 1024 : 1024 * 1024));
}

async function queryMacGpuAdapter() {
  if (process.platform !== "darwin") {
    return null;
  }
  const stdout = await execText("system_profiler", ["SPDisplaysDataType", "-json"], {
    timeoutMs: 2500,
    maxBuffer: 1024 * 1024
  });
  if (!stdout) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout);
    const adapters = Array.isArray(parsed?.SPDisplaysDataType) ? parsed.SPDisplaysDataType : [];
    const adapter = adapters[0] || null;
    if (!adapter) {
      return null;
    }
    return {
      name: String(adapter.sppci_model || adapter._name || adapter.spdisplays_device || "").trim(),
      percent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: parseMacVram(adapter.spdisplays_vram || adapter.spdisplays_vram_shared),
      temperatureC: null,
      source: "system_profiler"
    };
  } catch {
    return null;
  }
}

async function queryGpuSnapshot() {
  const now = Date.now();
  if (gpuSnapshotCache.value && now - gpuSnapshotCache.sampledAt < 3000) {
    return gpuSnapshotCache.value;
  }

  let snapshot = await queryNvidiaGpu();
  if (!snapshot && process.platform === "win32") {
    const [adapter, percent] = await Promise.all([queryWindowsGpuAdapter(), queryWindowsGpuUsage()]);
    if (adapter || percent !== null) {
      snapshot = {
        ...(adapter || {}),
        name: adapter?.name || "",
        percent,
        memoryUsedBytes: adapter?.memoryUsedBytes ?? null,
        memoryTotalBytes: adapter?.memoryTotalBytes ?? null,
        temperatureC: adapter?.temperatureC ?? null,
        source: adapter?.source || "windows_performance_counter"
      };
    }
  }
  if (!snapshot && process.platform === "darwin") {
    snapshot = await queryMacGpuAdapter();
  }

  const value = snapshot || {
    name: "",
    percent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    temperatureC: null,
    source: ""
  };
  gpuSnapshotCache = { sampledAt: now, value };
  return value;
}

function rootUrlForLlama(baseUrl = "") {
  const cleaned = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }
  return cleaned.replace(/\/v1$/i, "");
}

async function fetchTextWithTimeout(url, timeoutMs = 700) {
  if (!url) {
    return "";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer not-needed"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    clearTimeout(timer);
    return "";
  }
}

async function probeLocalLlamaLatency(llama = {}) {
  const baseUrl = String(llama.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl || String(llama.status || "").toLowerCase() !== "running") {
    return null;
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: "Bearer not-needed"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.ok ? Date.now() - startedAt : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function parsePrometheusSamples(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1],
        value: Number(match[2])
      };
    })
    .filter((sample) => sample && Number.isFinite(sample.value));
}

function sumPrometheus(samples, pattern, excludePattern = null) {
  const values = samples
    .filter((sample) => pattern.test(sample.name) && !(excludePattern && excludePattern.test(sample.name)))
    .map((sample) => sample.value);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function queryLocalLlamaMetrics(llama = {}) {
  if (String(llama.status || "").toLowerCase() !== "running") {
    lastLlamaMetricsSample = null;
    return null;
  }
  const rootUrl = rootUrlForLlama(llama.baseUrl);
  const metricsText = await fetchTextWithTimeout(`${rootUrl}/metrics`, 700);
  if (!metricsText) {
    return null;
  }
  const samples = parsePrometheusSamples(metricsText);
  if (!samples.length) {
    return null;
  }
  const completionTokens = sumPrometheus(
    samples,
    /(tokens?.*(predicted|generated|eval|completion).*total|(predicted|generated|eval|completion).*tokens?.*total)/i,
    /prompt|cache|cached|input/i
  );
  const promptTokens = sumPrometheus(samples, /(prompt.*tokens?.*total|tokens?.*prompt.*total)/i);
  const explicitTps = sumPrometheus(samples, /(tokens?.*(per_second|per_sec)|tok.*per_second|tps|eval.*rate)/i);
  const now = Date.now();
  let tokensPerSecond = explicitTps !== null ? explicitTps : null;
  if (completionTokens !== null && lastLlamaMetricsSample?.completionTokens !== null) {
    const seconds = Math.max(0.001, (now - lastLlamaMetricsSample.sampledAt) / 1000);
    const delta = completionTokens - lastLlamaMetricsSample.completionTokens;
    if (delta >= 0) {
      tokensPerSecond = roundMetric(delta / seconds, 1);
    }
  }
  lastLlamaMetricsSample = {
    sampledAt: now,
    completionTokens
  };
  return {
    sampledAt: now,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens !== null || completionTokens !== null
      ? Number(promptTokens || 0) + Number(completionTokens || 0)
      : null,
    tokensPerSecond: roundMetric(tokensPerSecond, 1),
    source: "llama_metrics"
  };
}

async function getTokenDashboardSnapshot() {
  const direct = typeof getLocalTokenTelemetry === "function" ? getLocalTokenTelemetry() : null;
  const llama = runtime?.getLocalLlamaState?.() || {};
  const [metrics, latencyMs] = await Promise.all([
    queryLocalLlamaMetrics(llama),
    probeLocalLlamaLatency(llama)
  ]);
  const directSampledAt = finiteNumber(direct?.sampledAt) || 0;
  const metricsSampledAt = finiteNumber(metrics?.sampledAt) || 0;
  const directHasTelemetry =
    finiteNumber(direct?.tokensPerSecond) !== null || finiteNumber(direct?.totalTokens) !== null;
  const metricsHasTelemetry =
    finiteNumber(metrics?.tokensPerSecond) !== null || finiteNumber(metrics?.totalTokens) !== null;
  const primary =
    metricsHasTelemetry && (!directHasTelemetry || metricsSampledAt >= directSampledAt)
      ? metrics
      : directHasTelemetry
      ? direct
      : metricsSampledAt >= directSampledAt
      ? metrics
      : direct;
  return {
    ...(primary || {}),
    model: String(primary?.model || direct?.model || llama.model || "").trim(),
    serverStatus: String(llama.status || "idle"),
    serverLatencyMs: roundMetric(latencyMs, 0),
    source: primary?.source || "",
    metricsSource: metrics?.source || "",
    usageSource: direct?.source || ""
  };
}

async function readLinuxCpuTemperature() {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    const entries = await fs.readdir("/sys/class/thermal", { withFileTypes: true });
    const values = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("thermal_zone")) {
        continue;
      }
      const raw = await fs.readFile(path.join("/sys/class/thermal", entry.name, "temp"), "utf8").catch(() => "");
      const numeric = Number(String(raw).trim());
      if (!Number.isFinite(numeric)) {
        continue;
      }
      const celsius = numeric > 1000 ? numeric / 1000 : numeric;
      if (celsius >= 0 && celsius <= 130) {
        values.push(celsius);
      }
    }
    return values.length ? roundMetric(Math.max(...values), 1) : null;
  } catch {
    return null;
  }
}

async function getSystemDashboardSnapshot() {
  const [gpu, cpuTemperatureC, tokens] = await Promise.all([
    queryGpuSnapshot(),
    readLinuxCpuTemperature(),
    getTokenDashboardSnapshot()
  ]);
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  return {
    sampledAt: Date.now(),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      model: os.cpus()[0]?.model || "",
      cores: os.cpus().length,
      percent: sampleCpuPercent(),
      loadAverage: os.loadavg().map((value) => roundMetric(value, 2)),
      temperatureC: cpuTemperatureC
    },
    memory: {
      totalBytes: totalMemoryBytes,
      freeBytes: freeMemoryBytes,
      usedBytes: usedMemoryBytes,
      percent: roundMetric(totalMemoryBytes ? (usedMemoryBytes / totalMemoryBytes) * 100 : null, 1)
    },
    gpu,
    tokens
  };
}

function normalizePreviewDeviceMode(value) {
  return String(value || "").trim().toLowerCase() === "mobile" ? "mobile" : "desktop";
}

function previewControlToken(payload = {}) {
  return [
    normalizePreviewDeviceMode(payload.mode),
    String(payload.source || ""),
    String(payload.requestId || ""),
    String(payload.updatedAt || "")
  ].join(":");
}

async function writePreviewControlFile(payload = {}) {
  if (!previewControlPath) {
    return;
  }
  await fs.mkdir(path.dirname(previewControlPath), { recursive: true });
  await fs.writeFile(previewControlPath, JSON.stringify(payload, null, 2), "utf8");
}

async function setPreviewDeviceMode(mode, source = "ui", options = {}) {
  const nextMode = normalizePreviewDeviceMode(mode);
  const nextSource = String(source || "ui");
  const changed = previewDeviceMode !== nextMode;
  previewDeviceMode = nextMode;

  if (options.persist !== false) {
    const payload = {
      mode: nextMode,
      source: nextSource,
      updatedAt: Date.now(),
      requestId: options.requestId || `preview-${Date.now()}`
    };
    lastPreviewControlToken = previewControlToken(payload);
    await writePreviewControlFile(payload);
  }

  if (changed || options.forceBroadcast) {
    broadcastRuntimeEvent({
      chatId: runtime?.state?.selectedChatId || null,
      event: {
        type: "preview_device_mode_changed",
        mode: nextMode,
        source: nextSource
      }
    });
  }

  return previewDeviceMode;
}

async function consumePreviewControlFile() {
  if (!previewControlPath || !existsSync(previewControlPath)) {
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(await fs.readFile(previewControlPath, "utf8"));
  } catch {
    return;
  }

  const mode = normalizePreviewDeviceMode(payload?.mode);
  const token = previewControlToken({
    ...payload,
    mode
  });
  if (!token || token === lastPreviewControlToken) {
    return;
  }

  lastPreviewControlToken = token;
  await setPreviewDeviceMode(mode, payload?.source || "tool", {
    persist: false,
    requestId: payload?.requestId,
    forceBroadcast: true
  });
}

function attachPreviewControlWatcher() {
  if (!previewControlPath || previewControlWatcherAttached) {
    return;
  }
  previewControlWatcherAttached = true;
  fsNative.watchFile(previewControlPath, { interval: 250 }, () => {
    consumePreviewControlFile().catch(() => { });
  });
}

function detachPreviewControlWatcher() {
  if (!previewControlPath || !previewControlWatcherAttached) {
    return;
  }
  previewControlWatcherAttached = false;
  fsNative.unwatchFile(previewControlPath);
}

function resolveBundledPath(...segments) {
  const baseRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : __dirname;
  return path.join(baseRoot, ...segments);
}

function getMobilePreviewScriptPath() {
  return resolveBundledPath("mobile-preview", "server.js");
}

async function findAvailablePort(preferred = 8420, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    const candidate = preferred + index;
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(candidate, "127.0.0.1");
    });
    if (available) {
      return candidate;
    }
  }
  throw new Error("Nao foi possivel encontrar uma porta livre para o preview mobile.");
}

async function waitForMobilePreviewHealth(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/api/sim/health`;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        return {
          port,
          origin: `http://127.0.0.1:${port}`,
          uiUrl: body.ui || `http://127.0.0.1:${port}/api/sim/ui`,
          browserUrl: body.browser || `http://127.0.0.1:${port}/api/sim/browser`,
          capabilitiesUrl: body.capabilities || `http://127.0.0.1:${port}/api/sim/capabilities`
        };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(
    lastError
      ? `Preview mobile nao respondeu a tempo: ${lastError.message}`
      : "Preview mobile nao respondeu a tempo."
  );
}

async function stopMobilePreviewService() {
  const child = mobilePreviewService.child;
  mobilePreviewService.child = null;
  mobilePreviewService.urls = null;
  mobilePreviewService.port = 0;
  mobilePreviewService.starting = null;

  if (child && !child.killed) {
    child.kill();
    await sleep(150);
  }
}

async function ensureMobilePreviewService(options = {}) {
  const forceRestart = Boolean(options?.forceRestart);
  if (forceRestart) {
    await stopMobilePreviewService();
  }

  if (mobilePreviewService.urls?.browserUrl) {
    try {
      const response = await fetch(`http://127.0.0.1:${mobilePreviewService.port}/api/sim/health`, { method: "GET" });
      if (response.ok) {
        return mobilePreviewService.urls;
      }
    } catch {}
  }

  if (mobilePreviewService.starting) {
    return mobilePreviewService.starting;
  }

  mobilePreviewService.starting = (async () => {
    const scriptPath = getMobilePreviewScriptPath();
    if (!existsSync(scriptPath)) {
      throw new Error(`Painel mobile nao encontrado: ${scriptPath}`);
    }

    const port = await findAvailablePort(8420, 50);
    const stdoutBuffer = [];
    const stderrBuffer = [];
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.dirname(scriptPath),
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        ELECTRON_RUN_AS_NODE: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer.push(String(chunk));
      if (stdoutBuffer.length > 20) {
        stdoutBuffer.shift();
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer.push(String(chunk));
      if (stderrBuffer.length > 20) {
        stderrBuffer.shift();
      }
    });
    child.once("exit", (code) => {
      if (mobilePreviewService.child === child) {
        mobilePreviewService.child = null;
        mobilePreviewService.urls = null;
        mobilePreviewService.port = 0;
      }
      mobilePreviewService.lastError = [
        `Preview mobile encerrou com codigo ${code}.`,
        stdoutBuffer.length ? `STDOUT:\n${stdoutBuffer.join("")}` : "",
        stderrBuffer.length ? `STDERR:\n${stderrBuffer.join("")}` : ""
      ].filter(Boolean).join("\n");
    });

    const urls = await waitForMobilePreviewHealth(port, 18000);
    mobilePreviewService.child = child;
    mobilePreviewService.port = port;
    mobilePreviewService.urls = urls;
    mobilePreviewService.lastError = "";
    return urls;
  })();

  try {
    return await mobilePreviewService.starting;
  } finally {
    mobilePreviewService.starting = null;
  }
}

function encodeSecret(secret) {
  if (!secret) {
    return null;
  }

  if (safeStorage.isEncryptionAvailable()) {
    return {
      mode: "safeStorage",
      value: safeStorage.encryptString(secret).toString("base64")
    };
  }

  return {
    mode: "plain",
    value: secret
  };
}

function decodeSecret(blob) {
  if (!blob) {
    return "";
  }

  if (blob.mode === "safeStorage" && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(blob.value, "base64"));
  }

  if (blob.mode === "plain") {
    return String(blob.value || "");
  }

  return "";
}

function contentTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".ogv": "video/ogg",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".json": "application/json",
    ".jsonc": "application/json",
    ".csv": "text/csv"
  })[ext] || "application/octet-stream";
}

function normalizeLocale(value) {
  const locale = String(value || "").trim().replace("_", "-");
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}

function detectHostLocale() {
  return normalizeLocale(app.getLocale?.()) ||
    normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale) ||
    "en-US";
}

function createHostDefaultState() {
  const state = createDefaultState();
  state.settings.locale = detectHostLocale();
  return state;
}

function hostPlatformLabel(value = process.platform) {
  return {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux"
  }[value] || value || "unknown";
}

function isWslRuntime() {
  if (process.platform !== "linux") {
    return false;
  }
  const release = `${os.release()} ${process.env.WSL_DISTRO_NAME || ""} ${process.env.WSL_INTEROP || ""}`;
  return /microsoft|wsl/i.test(release);
}

function appRuntimeRoot() {
  const root = path.resolve(__dirname);
  return root.includes("app.asar") ? root.replace("app.asar", "app.asar.unpacked") : root;
}

function findManagedLlamaBinarySync() {
  if (managedLlamaBinaryPathCache !== null) {
    return managedLlamaBinaryPathCache;
  }
  const root = path.join(appRuntimeRoot(), "bin", "llama");
  const executableNames = process.platform === "win32"
    ? new Set(["llama-server.exe", "server.exe"])
    : new Set(["llama-server", "server"]);

  function visit(dir, depth = 0) {
    if (depth > 5) {
      return "";
    }
    let entries = [];
    try {
      entries = fsNative.readdirSync(dir, { withFileTypes: true });
    } catch {
      return "";
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = visit(absolute, depth + 1);
        if (found) {
          return found;
        }
      } else if (executableNames.has(entry.name.toLowerCase())) {
        return absolute;
      }
    }
    return "";
  }

  managedLlamaBinaryPathCache = visit(root);
  return managedLlamaBinaryPathCache;
}

function buildHostInfo() {
  const managedLlamaBinaryPath = findManagedLlamaBinarySync();
  const envShell = path.basename(String(process.env.SHELL || "")).toLowerCase();
  const defaultShell = process.platform === "win32"
    ? "cmd"
    : ["bash", "zsh", "sh"].includes(envShell)
      ? envShell
      : process.platform === "darwin"
        ? "zsh"
        : "sh";
  return {
    platform: process.platform,
    platformLabel: hostPlatformLabel(),
    arch: process.arch,
    release: os.release(),
    locale: detectHostLocale(),
    isWsl: isWslRuntime(),
    managedLlamaAvailable: Boolean(managedLlamaBinaryPath),
    managedLlamaBinaryPath,
    defaultShell,
    defaultShellLabel: process.platform === "win32"
      ? "Command Prompt"
      : process.platform === "darwin"
        ? "zsh/bash"
        : "bash/sh"
  };
}

async function readPersistedStore() {
  if (!existsSync(storePath)) {
    return {
      runtimeState: createHostDefaultState(),
      apiKeySecret: null
    };
  }

  try {
    const raw = JSON.parse(await fs.readFile(storePath, "utf8"));
    const runtimeState = normalizeState(raw);
    if (!raw?.settings?.locale) {
      runtimeState.settings.locale = detectHostLocale();
    }
    return {
      runtimeState,
      apiKeySecret: raw.apiKeySecret || null
    };
  } catch {
    return {
      runtimeState: createHostDefaultState(),
      apiKeySecret: null
    };
  }
}

async function persistStore() {
  if (!runtime) {
    return;
  }

  const snapshot = runtime.getSnapshot();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        ...snapshot,
        apiKeySecret: secretBlob
      },
      null,
      2
    ),
    "utf8"
  );
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistStore().catch(() => { });
  }, 80);
}

function buildPublicState() {
  return {
    ...runtime.getPublicState({
    hasCloudApiKey: Boolean(decodeSecret(secretBlob)),
    previewDeviceMode,
    hostInfo: buildHostInfo()
    }),
    dreamPetExternalOverlay: true
  };
}

function broadcastRuntimeEvent(event) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("runtime:event", event);
    }
  }
}

function getPreviewHarnessWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
}

function requestPreviewHarness(command = {}, timeoutMs = 20000) {
  const window = getPreviewHarnessWindow();
  if (!window) {
    return Promise.reject(new Error("Nenhuma janela do Dream Server esta aberta para controlar o preview."));
  }

  const id = `preview-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timeout = Math.max(1500, Math.min(Number(timeoutMs || 20000), 120000));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      previewHarnessRequests.delete(id);
      reject(new Error(`Preview harness nao respondeu em ${timeout}ms.`));
    }, timeout);

    previewHarnessRequests.set(id, {
      resolve,
      reject,
      timer
    });

    window.webContents.send("preview-harness:command", {
      id,
      command
    });
  });
}

function dreamPetSettings() {
  const settings = runtime?.state?.settings || {};
  return {
    enabled: settings.dreamPetEnabled !== false,
    bubbleEnabled: settings.dreamPetBubbleEnabled !== false,
    voiceEnabled: settings.dreamPetVoiceEnabled === true,
    voiceName: String(settings.dreamPetVoiceName || "").trim(),
    bounds: settings.dreamPetWindowBounds || null
  };
}

function defaultDreamPetBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: 230,
    height: 274,
    x: Math.max(area.x + 12, area.x + area.width - 252),
    y: Math.max(area.y + 12, area.y + area.height - 310)
  };
}

function clampDreamPetBounds(bounds = {}) {
  const fallback = defaultDreamPetBounds();
  const area = screen.getDisplayMatching({
    x: Number(bounds.x ?? fallback.x),
    y: Number(bounds.y ?? fallback.y),
    width: Number(bounds.width ?? fallback.width),
    height: Number(bounds.height ?? fallback.height)
  }).workArea;
  const width = Math.max(210, Math.min(260, Number(bounds.width || fallback.width)));
  const height = Math.max(250, Math.min(310, Number(bounds.height || fallback.height)));
  return {
    width,
    height,
    x: Math.min(Math.max(area.x + 8, Number(bounds.x ?? fallback.x)), area.x + area.width - width - 8),
    y: Math.min(Math.max(area.y + 8, Number(bounds.y ?? fallback.y)), area.y + area.height - height - 8)
  };
}

function persistDreamPetBounds() {
  if (!petWindow || petWindow.isDestroyed() || !runtime?.state?.settings) {
    return;
  }
  const [x, y] = petWindow.getPosition();
  const [width, height] = petWindow.getSize();
  runtime.state.settings.dreamPetWindowBounds = clampDreamPetBounds({ x, y, width, height });
  schedulePersist();
}

function dreamPetMood() {
  const snapshot = runtime?.getSnapshot?.() || {};
  const chat = selectedDreamPetChat(snapshot);
  const status = String(chat?.status || "").toLowerCase();
  if (/fail|error|erro|crash|timeout/.test(status)) {
    return "failed";
  }
  if (status === "running" || status === "streaming") {
    return "running";
  }
  if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
    return "waiting";
  }
  return "idle";
}

function selectedDreamPetChat(snapshot = runtime?.getSnapshot?.() || {}) {
  const selectedId = snapshot.selectedChatId;
  return (snapshot.chats || []).find((entry) => entry.id === selectedId) || snapshot.chats?.[0] || null;
}

function compactDreamPetText(value = "", maxLength = 86) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "codigo")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/[#*_>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(12, maxLength - 1)).trim()}...`;
}

function dreamPetChatTitle(chat) {
  const title = compactDreamPetText(chat?.title || chat?.name || "", 34);
  if (title) {
    return title;
  }
  const root = String(chat?.workspaceRoot || "").trim();
  return root ? compactDreamPetText(path.basename(root), 34) : "chat atual";
}

function dreamPetLastMessage(chat, preferredKinds = []) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.hidden || message.pending) {
      continue;
    }
    if (preferredKinds.length && !preferredKinds.includes(message.kind)) {
      continue;
    }
    const text = compactDreamPetText(message.content || message.text || "");
    if (text) {
      return text;
    }
  }
  return "";
}

function dreamPetLine(mode = "idle") {
  const snapshot = runtime?.getSnapshot?.() || {};
  const chat = selectedDreamPetChat(snapshot);
  const title = dreamPetChatTitle(chat);
  const status = compactDreamPetText(chat?.status || "", 24);
  const lastAssistant = dreamPetLastMessage(chat, ["assistant"]);
  const lastUser = dreamPetLastMessage(chat, ["user"]);
  if (mode === "running") {
    return `Rodando em ${title}. ${lastUser ? `Pedido: ${compactDreamPetText(lastUser, 54)}` : "Acompanhando a execucao."}`;
  }
  if (mode === "failed") {
    return `Atencao em ${title}: ${status || "falha detectada"}.`;
  }
  if (mode === "waiting" && lastAssistant) {
    return `Resumo: ${compactDreamPetText(lastAssistant, 78)}`;
  }
  if (mode === "review") {
    return `Tem algo para revisar em ${title}.`;
  }
  if (mode === "waving") {
    return `Oi, estou de volta em ${title}.`;
  }
  if (mode === "jumping") {
    return "Peguei energia, soltei brilho e voltei ao posto.";
  }
  return chat ? `Pronta em ${title}.` : "Dream Server pronto.";
}

function sendDreamPetUpdate(options = {}) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const settings = dreamPetSettings();
  const mode = options.mode || dreamPetMood();
  const hasLineOption = Object.prototype.hasOwnProperty.call(options, "line");
  const nextLine = hasLineOption ? compactDreamPetText(options.line || "") : dreamPetLine(mode);
  const now = Date.now();
  const modeChanged = petRuntime.lastMode !== mode;
  const minGap = mode === "idle" ? 90000 : mode === "waiting" ? 45000 : 14000;
  const forceLine = Boolean(options.forceLine || options.forceSpeech);
  const shouldSendLine = Boolean(nextLine) && (
    forceLine ||
    modeChanged ||
    (nextLine !== petRuntime.lastLine && now - petRuntime.lastLineAt > 8000) ||
    now - petRuntime.lastLineAt > minGap
  );
  petRuntime.lastMode = mode;
  if (shouldSendLine) {
    petRuntime.lastLine = nextLine;
    petRuntime.lastLineAt = now;
  }
  petWindow.webContents.send("pet:update", {
    mode,
    bubbleEnabled: settings.bubbleEnabled,
    voiceEnabled: settings.voiceEnabled,
    voiceName: settings.voiceName,
    line: shouldSendLine ? nextLine : "",
    forceLine,
    forceSpeech: shouldSendLine && Boolean(options.forceSpeech)
  });
}

function closeDreamPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.close();
  }
  petWindow = null;
}

function ensureDreamPetWindow(options = {}) {
  const settings = dreamPetSettings();
  if (!settings.enabled) {
    closeDreamPetWindow();
    return;
  }
  if (petWindow && !petWindow.isDestroyed()) {
    if (!petWindow.isVisible()) {
      petWindow.showInactive();
    }
    sendDreamPetUpdate(options);
    return;
  }
  const bounds = clampDreamPetBounds(settings.bounds || defaultDreamPetBounds());
  petWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    focusable: false,
    hasShadow: false,
    show: false,
    title: "Dreamserver Pet",
    webPreferences: {
      preload: path.join(__dirname, "pet-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  petWindow.loadFile(path.join(__dirname, "src", "pet-overlay.html"));
  petWindow.once("ready-to-show", () => {
    petWindow?.showInactive();
    sendDreamPetUpdate(options);
  });
  petWindow.on("moved", persistDreamPetBounds);
  petWindow.on("closed", () => {
    petWindow = null;
  });
}

function readJsonRequestBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Payload da ponte de preview excedeu o limite."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`JSON invalido na ponte de preview: ${error.message || error}`));
      }
    });
    req.on("error", reject);
  });
}

function writeJsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function writeDesktopBridgeDescriptor() {
  if (!desktopBridgePath || !desktopBridgePort || !desktopBridgeToken) {
    return;
  }
  await fs.mkdir(path.dirname(desktopBridgePath), { recursive: true });
  await fs.writeFile(
    desktopBridgePath,
    JSON.stringify({
      pid: process.pid,
      host: "127.0.0.1",
      port: desktopBridgePort,
      token: desktopBridgeToken,
      updatedAt: Date.now()
    }, null, 2),
    "utf8"
  );
}

async function startDesktopBridgeServer() {
  if (desktopBridgeServer) {
    return;
  }

  desktopBridgePath = path.join(app.getPath("temp"), "dream-server-desktop-bridge.json");
  desktopBridgeToken = crypto.randomBytes(32).toString("hex");

  desktopBridgeServer = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/preview-harness") {
      writeJsonResponse(res, 404, { ok: false, error: "Endpoint da ponte nao encontrado." });
      return;
    }

    const token = String(req.headers["x-dream-bridge-token"] || "");
    if (!desktopBridgeToken || token !== desktopBridgeToken) {
      writeJsonResponse(res, 403, { ok: false, error: "Token invalido na ponte de preview." });
      return;
    }

    try {
      const payload = await readJsonRequestBody(req);
      const command = payload?.command && typeof payload.command === "object" ? payload.command : {};
      const timeoutMs = payload?.timeoutMs || command.timeoutMs || 20000;
      const result = await requestPreviewHarness(command, timeoutMs);
      writeJsonResponse(res, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(res, 500, {
        ok: false,
        error: error?.message || String(error)
      });
    }
  });

  await new Promise((resolve, reject) => {
    desktopBridgeServer.once("error", reject);
    desktopBridgeServer.listen(0, "127.0.0.1", () => {
      desktopBridgeServer.off("error", reject);
      const address = desktopBridgeServer.address();
      desktopBridgePort = typeof address === "object" && address ? Number(address.port) : 0;
      resolve();
    });
  });

  process.env.DREAM_DESKTOP_BRIDGE_FILE = desktopBridgePath;
  process.env.DREAM_DESKTOP_BRIDGE_PORT = String(desktopBridgePort);
  process.env.DREAM_DESKTOP_BRIDGE_TOKEN = desktopBridgeToken;
  await writeDesktopBridgeDescriptor();
}

async function stopDesktopBridgeServer() {
  const server = desktopBridgeServer;
  desktopBridgeServer = null;
  desktopBridgePort = 0;

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  if (desktopBridgePath) {
    try {
      await fs.unlink(desktopBridgePath);
    } catch { }
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 960,
    minHeight: 660,
    backgroundColor: "#0a0a0d",
    title: "Dream Server DESKTOP",
    icon: path.join(__dirname, "src", "assets", process.platform === "win32" ? "app-icon.ico" : "app-icon.png"),
    autoHideMenuBar: true,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  if (process.platform === "win32" && typeof window.setBackgroundMaterial === "function") {
    try {
      window.setBackgroundMaterial("mica");
    } catch { }
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  window.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  ensureDreamPetWindow();
}

function getDefaultWorkspaceRoot() {
  return path.join(app.getPath("documents"), "DreamServerProjects");
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) {
    return false;
  }
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPackagedWorkspacePath(candidate) {
  const value = normalizePathText(candidate);
  if (!value) {
    return true;
  }

  const resolved = path.resolve(value);
  const lowered = resolved.toLowerCase();
  const appRoot = path.resolve(__dirname);
  const cwdRoot = path.resolve(process.cwd());
  const resourcesRoot = process.resourcesPath ? path.resolve(process.resourcesPath) : "";
  const normalizedLowered = lowered.replace(/\\/g, "/");

  return (
    isPathInside(appRoot, resolved) ||
    isPathInside(cwdRoot, resolved) ||
    (resourcesRoot && isPathInside(resourcesRoot, resolved)) ||
    normalizedLowered.includes("/resources/app.asar") ||
    normalizedLowered.includes("/resources/app.asar.unpacked") ||
    normalizedLowered.includes("/dist/win-unpacked/") ||
    /\/dist[^/]*\/win-unpacked\//.test(normalizedLowered)
  );
}

function repairPersistedWorkspaceRoots(runtimeState, defaultWorkspaceRoot) {
  const state = normalizeState(runtimeState || createDefaultState());
  const repairList = (items) => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (item.workspaceRoot) {
        item.workspaceRoot = normalizePathText(item.workspaceRoot);
      }
      if (!item.workspaceRoot || isPackagedWorkspacePath(item.workspaceRoot)) {
        item.workspaceRoot = defaultWorkspaceRoot;
      }
      if (item.worktreePath) {
        item.worktreePath = normalizePathText(item.worktreePath);
        if (isPackagedWorkspacePath(item.worktreePath)) {
          item.worktreePath = "";
          item.worktreeBranch = "";
        }
      }
    }
  };
  const repairProjects = (items) => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      if (!item || typeof item !== "object" || !item.path) {
        continue;
      }
      const normalizedPath = normalizePathText(item.path);
      if (normalizedPath && !isPackagedWorkspacePath(normalizedPath)) {
        item.path = normalizedPath;
        continue;
      }
      const name = String(item.slug || item.id || path.basename(normalizedPath || "") || "project")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "project";
      item.path = path.join(defaultWorkspaceRoot, name);
    }
  };

  repairList(state.chats);
  repairList(state.tasks);
  repairList(state.agents);
  repairProjects(state.projects);

  return state;
}

async function initRuntime() {
  const loaded = await readPersistedStore();
  const defaultWorkspaceRoot = getDefaultWorkspaceRoot();
  mkdirSync(defaultWorkspaceRoot, { recursive: true });
  previewControlPath = path.join(app.getPath("userData"), "preview-control.json");
  process.env.DREAM_PREVIEW_CONTROL_PATH = previewControlPath;
  secretBlob = loaded.apiKeySecret;
  runtime = new DreamRuntime({
    initialState: repairPersistedWorkspaceRoots(loaded.runtimeState, defaultWorkspaceRoot),
    workspaceRoot: defaultWorkspaceRoot,
    previewHarness: requestPreviewHarness,
    getCloudApiKey: () => decodeSecret(secretBlob)
  });

  if (existsSync(previewControlPath)) {
    try {
      const persistedPreview = JSON.parse(await fs.readFile(previewControlPath, "utf8"));
      previewDeviceMode = normalizePreviewDeviceMode(persistedPreview?.mode);
      lastPreviewControlToken = previewControlToken(persistedPreview);
    } catch {
      previewDeviceMode = "desktop";
    }
  } else {
    await setPreviewDeviceMode("desktop", "bootstrap", {
      persist: true,
      forceBroadcast: false,
      requestId: "bootstrap"
    });
  }
  attachPreviewControlWatcher();

  runtime.on("state_changed", (event) => {
    schedulePersist();
    broadcastRuntimeEvent(event);
    ensureDreamPetWindow();
  });
}

ipcMain.handle("state:load", async () => buildPublicState());
ipcMain.handle("system:dashboard", async () => getSystemDashboardSnapshot());
ipcMain.handle("settings:save", async (_, payload) => {
  const cloudApiKey = String(payload?.apiKey || "").trim();
  const wasPetEnabled = runtime?.state?.settings?.dreamPetEnabled !== false;
  if (cloudApiKey) {
    secretBlob = encodeSecret(cloudApiKey);
  }
  runtime.updateSettings({
    ...payload,
    apiKey: undefined
  });
  await persistStore();
  const isPetEnabled = payload?.dreamPetEnabled !== false;
  ensureDreamPetWindow({
    mode: isPetEnabled && !wasPetEnabled ? "waving" : dreamPetMood(),
    line: isPetEnabled && !wasPetEnabled ? "Pet ativado." : "",
    forceLine: isPetEnabled && !wasPetEnabled,
    forceSpeech: false
  });
  return buildPublicState();
});
ipcMain.handle("pet:ready", async () => {
  sendDreamPetUpdate({ mode: "waving", line: "Dreamserver online.", forceLine: true, forceSpeech: false });
  return { ok: true };
});
ipcMain.handle("pet:wake", async () => {
  ensureDreamPetWindow({ mode: "waving", line: "Oi, eu sou a Dreamserver.", forceLine: true, forceSpeech: true });
  return { ok: true };
});
ipcMain.handle("pet:reset", async () => {
  ensureDreamPetWindow({ mode: "waving", line: "Voltei para o canto principal.", forceLine: true, forceSpeech: false });
  if (petWindow && !petWindow.isDestroyed() && runtime?.state?.settings) {
    const bounds = defaultDreamPetBounds();
    petWindow.setBounds(bounds);
    runtime.state.settings.dreamPetWindowBounds = bounds;
    schedulePersist();
  }
  return { ok: true };
});
ipcMain.handle("pet:speak", async (_, payload = {}) => {
  const mode = payload?.wake ? "waving" : dreamPetMood();
  sendDreamPetUpdate({
    mode,
    line: payload?.line || dreamPetLine(mode),
    forceLine: payload?.wake === true || payload?.forceLine === true,
    forceSpeech: payload?.wake === true || payload?.forceSpeech === true
  });
  return { ok: true };
});
ipcMain.on("pet:move-to", (_, payload = {}) => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const current = petWindow.getBounds();
  const x = Number(payload.x);
  const y = Number(payload.y);
  const next = clampDreamPetBounds({
    x: Number.isFinite(x) ? x : current.x,
    y: Number.isFinite(y) ? y : current.y,
    width: current.width,
    height: current.height
  });
  petWindow.setPosition(Math.round(next.x), Math.round(next.y), false);
});
ipcMain.handle("pet:persist-position", async () => {
  persistDreamPetBounds();
  return { ok: true };
});
ipcMain.handle("pet:interact", async (_, payload = {}) => {
  const type = String(payload?.type || "").toLowerCase();
  const responses = {
    single: { mode: "waving", line: "Oi. Estou aqui com voce." },
    double: { mode: "jumping", line: "Dois toques: energia extra ativada." },
    triple: { mode: "failed", line: "Aaa, modo choro ativado por tres toques." },
    hold: { mode: "jumping", line: "Segurou: soltei uma animacao especial." },
    drag: { mode: "waiting", line: "Fico bem aqui." }
  };
  const response = responses[type] || responses.single;
  sendDreamPetUpdate({
    ...response,
    forceLine: true,
    forceSpeech: false
  });
  return { ok: true };
});
ipcMain.handle("settings:clear-api-key", async () => {
  secretBlob = null;
  await persistStore();
  return buildPublicState();
});
ipcMain.handle("chat:create", async () => {
  runtime.createChat(runtime.state.settings.providerMode);
  return buildPublicState();
});
ipcMain.handle("chat:select", async (_, chatId) => {
  runtime.selectChat(chatId);
  return buildPublicState();
});
ipcMain.handle("chat:delete", async (_, chatId) => {
  await runtime.deleteChat(chatId);
  await persistStore();
  return buildPublicState();
});
ipcMain.handle("chat:set-provider", async (_, payload) => {
  runtime.setChatProvider(payload.chatId, payload.providerMode);
  return buildPublicState();
});
ipcMain.handle("chat:stop", async (_, chatId) => {
  await runtime.stopChat(chatId);
  return {
    state: buildPublicState()
  };
});
ipcMain.handle("external:open", async (_, url) => {
  await shell.openExternal(String(url || ""));
  return true;
});
ipcMain.handle("attachments:pick", async () => {
  const window = BrowserWindow.getFocusedWindow();
  const response = await dialog.showOpenDialog(window || null, {
    title: "Selecionar anexos",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Arquivos", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "txt", "md", "js", "ts", "json", "*"] }
    ]
  });

  if (response.canceled) {
    return [];
  }

  return await Promise.all(response.filePaths.map(async (filePath) => {
    const stat = await fs.stat(filePath).catch(() => null);
    return {
      id: `att-${path.basename(filePath)}-${Date.now()}`,
      filename: path.basename(filePath),
      path: filePath,
      type: "file",
      contentType: contentTypeForPath(filePath),
      size: stat?.size || null
    };
  }));
});
ipcMain.handle("background:pick-media", async () => {
  const window = BrowserWindow.getFocusedWindow();
  const response = await dialog.showOpenDialog(window || null, {
    title: "Selecionar background",
    properties: ["openFile"],
    filters: [
      {
        name: "Videos e imagens",
        extensions: ["mp4", "webm", "mov", "m4v", "ogv", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]
      }
    ]
  });

  if (response.canceled || !response.filePaths[0]) {
    return null;
  }

  const filePath = response.filePaths[0];
  const stat = await fs.stat(filePath).catch(() => null);
  return {
    filename: path.basename(filePath),
    path: filePath,
    contentType: contentTypeForPath(filePath),
    size: stat?.size || null
  };
});
ipcMain.handle("code:save-file", async (_, payload) => {
  const rawPath = normalizePathText(payload?.path);
  const content = String(payload?.content ?? "");
  if (!rawPath) {
    throw new Error("Caminho do arquivo ausente.");
  }
  if (/^assistant-snippet\./i.test(rawPath)) {
    throw new Error("Este código veio de uma resposta do chat. Crie um arquivo real antes de salvar.");
  }
  if (content.length > 5_000_000) {
    throw new Error("Arquivo grande demais para salvar pelo editor.");
  }

  const chatId = payload?.chatId || runtime.state.selectedChatId;
  const workspaceRoot = runtime.getWorkspaceRoot(chatId);
  const targetPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");

  const chat = runtime.state.chats.find((entry) => entry.id === chatId) || null;
  if (chat && typeof runtime._upsertLocalEvent === "function") {
    runtime._upsertLocalEvent(chat, {
      type: "local",
      ok: true,
      timestamp: Date.now(),
      action: {
        type: "write_file",
        path: targetPath,
        content
      },
      result: `Arquivo salvo pelo editor: ${targetPath}`
    });
    runtime.emit("state_changed", {
      type: "code_file_saved",
      chatId: chat.id,
      path: targetPath
    });
  }

  await persistStore();
  return {
    ok: true,
    path: targetPath,
    state: buildPublicState()
  };
});
ipcMain.handle("provider:list-local-models", async () => await runtime.listLocalModels());
ipcMain.handle("provider:local-llama-status", async () => runtime.getLocalLlamaState());
ipcMain.handle("provider:local-llama-start", async (_, payload = {}) => {
  await runtime.ensureManagedLocalLlama({
    forceRestart: Boolean(payload?.forceRestart),
    reason: "ui_start"
  });
  await persistStore();
  return buildPublicState();
});
ipcMain.handle("provider:local-llama-stop", async () => {
  await runtime.stopManagedLocalLlama();
  await persistStore();
  return buildPublicState();
});
ipcMain.handle("preview:ensure-mobile-service", async (_, payload) => {
  try {
    return await ensureMobilePreviewService({
      forceRestart: Boolean(payload?.forceRestart)
    });
  } catch (error) {
    const suffix = mobilePreviewService.lastError ? `\n${mobilePreviewService.lastError}` : "";
    throw new Error(`${error.message}${suffix}`);
  }
});
ipcMain.handle("preview:set-mode", async (_, payload) => {
  const mode = normalizePreviewDeviceMode(payload?.mode);
  if (mode === "mobile") {
    await ensureMobilePreviewService({
      forceRestart: Boolean(payload?.forceRestart)
    });
  }
  await setPreviewDeviceMode(mode, payload?.source || "ui", {
    persist: true,
    requestId: payload?.requestId || `ui-${Date.now()}`
  });
  return {
    ok: true,
    mode,
    state: buildPublicState()
  };
});
ipcMain.handle("preview-harness:result", async (_, payload = {}) => {
  const id = String(payload?.id || "");
  const request = previewHarnessRequests.get(id);
  if (!request) {
    return false;
  }
  previewHarnessRequests.delete(id);
  clearTimeout(request.timer);
  if (payload.ok) {
    request.resolve(payload.result);
  } else {
    request.reject(new Error(String(payload.error || "Preview harness falhou.")));
  }
  return true;
});
ipcMain.handle("preview-harness:request", async (_, command = {}) => {
  return await requestPreviewHarness(command, command?.timeoutMs || 20000);
});
ipcMain.handle("manus:send", async (_, payload) => {
  const state = await runtime.sendMessage({
    chatId: payload.chatId,
    text: payload.text,
    attachmentPaths: payload.attachmentPaths,
    cloudApiKey: decodeSecret(secretBlob)
  });
  return {
    state,
    aborted: false
  };
});
ipcMain.handle("manus:sync", async () => buildPublicState());
ipcMain.handle("window:minimize", async () => { BrowserWindow.getFocusedWindow()?.minimize(); });
ipcMain.handle("window:maximize", async () => { const w = BrowserWindow.getFocusedWindow(); if (w?.isMaximized()) w.unmaximize(); else w?.maximize(); });
ipcMain.handle("window:close", async () => { BrowserWindow.getFocusedWindow()?.close(); });
ipcMain.handle("desktop:run-action", async (_, payload) => {
  const state = await runtime.runSuggestedAction({
    chatId: payload.chatId,
    actionKey: payload.actionKey,
    action: payload.action,
    cloudApiKey: decodeSecret(secretBlob)
  });
  await persistStore();
  return {
    ok: true,
    message: "Acao aprovada.",
    state
  };
});
ipcMain.handle("desktop:stop-all-local-activity", async () => {
  const response = await runtime.stopAllLocalActivity();
  await persistStore();
  return {
    ok: true,
    message: response.result || "Atividade local interrompida.",
    state: buildPublicState()
  };
});
ipcMain.handle("desktop:stop-background-job", async (_, jobId) => {
  const response = await runtime.stopBackgroundJob(jobId);
  await persistStore();
  return {
    ok: true,
    message: response.result || "Job interrompido.",
    state: buildPublicState()
  };
});
ipcMain.handle("desktop:close-terminal-session", async (_, sessionId) => {
  const response = await runtime.closeTerminalSession(sessionId);
  await persistStore();
  return {
    ok: true,
    message: response.result || "Terminal fechado.",
    state: buildPublicState()
  };
});

async function runHermesSetupIfNeeded({ force = false } = {}) {
  const { needsSetup, ensureHermesVenv } = require("./runtime/hermes/setup");
  if (!force && !needsSetup()) {
    return false;
  }

  const sendSetupEvent = (payload) => {
    for (const target of BrowserWindow.getAllWindows()) {
      if (!target.isDestroyed()) {
        target.webContents.send("runtime:event", payload);
      }
    }
  };

  sendSetupEvent({
    type: "hermes_setup_required",
    message: "Preparando Hermes Agent para este dispositivo..."
  });

  await ensureHermesVenv({
    onProgress: (message) => {
      sendSetupEvent({
        type: "hermes_setup_progress",
        message
      });
    }
  });

  sendSetupEvent({
    type: "hermes_setup_done",
    message: "Hermes Agent pronto."
  });
  return true;
}

ipcMain.handle("hermes:setup", async () => {
  try {
    await runHermesSetupIfNeeded({ force: true });
    const { needsSetup } = require("./runtime/hermes/setup");
    return { ok: !needsSetup() };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  storePath = path.join(app.getPath("userData"), "dream-server-runtime.json");
  await initRuntime();
  await startDesktopBridgeServer();
  createWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      runHermesSetupIfNeeded().catch((error) => {
        mainWindow?.webContents?.send("runtime:event", {
          type: "hermes_setup_error",
          message: error && error.message ? error.message : String(error)
        });
      });
    });
  }

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.once("did-finish-load", () => {
          runHermesSetupIfNeeded().catch((error) => {
            mainWindow?.webContents?.send("runtime:event", {
              type: "hermes_setup_error",
              message: error && error.message ? error.message : String(error)
            });
          });
        });
      }
    }
  });
});

app.on("before-quit", () => {
  closeDreamPetWindow();
  detachPreviewControlWatcher();
  stopMobilePreviewService().catch(() => { });
  stopDesktopBridgeServer().catch(() => { });
  runtime?.stopManagedLocalLlama?.().catch(() => { });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
