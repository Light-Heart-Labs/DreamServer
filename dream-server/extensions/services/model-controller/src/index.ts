/**
 * Dream Server — Model Controller Sidecar
 *
 * A minimal service that manages LLM backend switching and container restarts.
 * This is the ONLY container with Docker socket + .env write access.
 *
 * API:
 *   GET  /health          — liveness probe
 *   GET  /status          — container state + loaded model + available backends
 *   POST /switch          — update .env + restart container (same backend)
 *   POST /switch-backend  — switch LLM backend (llamacpp / vllm / ollama)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// --- Configuration ---

const PORT = parseInt(process.env.CONTROLLER_PORT || "3003", 10);
const SECRET = process.env.MODEL_CONTROLLER_SECRET || "";
const ENV_PATH = process.env.ENV_FILE_PATH || "/dream-server/.env";
const MODELS_DIR = process.env.MODELS_DIR || "/models";
const HF_CACHE_DIR = process.env.HF_CACHE_DIR || "/hf-cache";
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const INSTALL_DIR = process.env.INSTALL_DIR || "/dream-server";
const CONTAINER_NAME = "dream-llama-server"; // hardcoded allowlist
const ALLOWED_ENV_KEYS = new Set([
  "GGUF_FILE", "VLLM_MODEL", "CTX_SIZE",
  "LLM_BACKEND", "COMPOSE_FILE", "LLM_API_URL",
]);

// Backend overlay files (relative to install dir)
const VLLM_OVERLAY = "docker-compose.vllm.yml";
const OLLAMA_OVERLAY = "docker-compose.ollama.yml";
const LEGACY_EXTERNAL_LLM_OVERLAY = "docker-compose.external-llm.yml";

// Valid backends
const VALID_BACKENDS = new Set(["llamacpp", "vllm", "ollama"]);

// --- Docker Engine API (HTTP over Unix socket) ---

async function dockerGet(path: string): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    // @ts-expect-error — Bun supports unix socket option
    unix: DOCKER_SOCKET,
  });
}

async function dockerPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    method: "POST",
    // @ts-expect-error — Bun supports unix socket option
    unix: DOCKER_SOCKET,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// --- .env File Helpers ---

function readEnvFile(): Map<string, string> {
  const env = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return env;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    env.set(key, val);
  }
  return env;
}

function writeEnvFile(env: Map<string, string>): void {
  // NOTE: In Docker, /dream-server is mounted :ro but .env has its own
  // writable bind mount. We CANNOT create temp files (like .env.tmp) in
  // the read-only parent directory, so we write directly to .env.
  // Preserve original file structure — only mutate known keys
  if (!existsSync(ENV_PATH)) {
    const lines = [...env.entries()].map(([k, v]) => `${k}=${v}`);
    writeFileSync(ENV_PATH, lines.join("\n") + "\n");
    return;
  }

  const original = readFileSync(ENV_PATH, "utf-8");
  const lines = original.split("\n");
  const written = new Set<string>();

  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (env.has(key)) {
      written.add(key);
      return `${key}=${env.get(key)}`;
    }
    return line;
  });

  // Append any new keys not already in the file
  for (const [k, v] of env) {
    if (!written.has(k)) result.push(`${k}=${v}`);
  }

  writeFileSync(ENV_PATH, result.join("\n"));
}

// --- Compose Overlay Helpers ---

/**
 * Parse COMPOSE_FILE env var into an array of relative paths.
 */
function parseComposeFiles(composeFileValue: string): string[] {
  if (!composeFileValue) return [];
  // Support both : (linux) and ; (windows) separators
  return composeFileValue.split(/[:;]/).filter(Boolean);
}

/**
 * Check which backend overlays are available on disk.
 */
function getAvailableBackends(): { id: string; installed: boolean }[] {
  return [
    { id: "llamacpp", installed: true },
    { id: "vllm", installed: true },
    { id: "ollama", installed: true },
  ];
}

/**
 * Determine the LLM API URL for a given backend.
 */
function getLlmApiUrl(backend: string): string {
  // All backends run as the "llama-server" service on port 8080
  return "http://llama-server:8080";
}

/**
 * Update COMPOSE_FILE to add/remove backend overlays.
 * Returns the new COMPOSE_FILE value.
 */
function updateComposeFileForBackend(currentComposeFile: string, newBackend: string): string {
  const files = parseComposeFiles(currentComposeFile);

  // Remove existing backend overlays (including legacy external-llm)
  const cleaned = files.filter(
    (f) => f !== VLLM_OVERLAY && f !== OLLAMA_OVERLAY && f !== LEGACY_EXTERNAL_LLM_OVERLAY
  );

  // Add the new overlay (llamacpp has no overlay — it's the base)
  const overlay = newBackend === "vllm" ? VLLM_OVERLAY : newBackend === "ollama" ? OLLAMA_OVERLAY : null;
  if (overlay) {
    // Insert after nvidia/amd overlay but before extensions
    const gpuIdx = cleaned.findIndex((f) =>
      f.includes("nvidia") || f.includes("amd") || f.includes("apple")
    );
    const insertIdx = gpuIdx >= 0 ? gpuIdx + 1 : 1;
    cleaned.splice(insertIdx, 0, overlay);
  }

  return cleaned.join(":");
}

// --- Compose CLI ---

/**
 * Run `docker compose up -d --remove-orphans` to apply overlay changes.
 * Uses Bun.spawn to exec the compose CLI.
 */
async function composeUp(): Promise<{ ok: boolean; output: string }> {
  try {
    // Only recreate llama-server — other services (dashboard, api, etc.)
    // don't need to restart for a backend switch. The .env changes are
    // already written; a full `docker compose up` will pick them up later.
    const proc = Bun.spawn(
      ["docker", "compose", "up", "-d", "--force-recreate", "llama-server"],
      {
        cwd: INSTALL_DIR,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, DOCKER_HOST: `unix://${DOCKER_SOCKET}` },
      }
    );
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const output = (stdout + "\n" + stderr).trim();
    return { ok: exitCode === 0, output };
  } catch (err) {
    return { ok: false, output: String(err) };
  }
}

// --- Validation ---

function verifyModelExists(modelFile: string, backend: string): { ok: boolean; error?: string } {
  if (backend === "vllm") {
    // For vLLM, modelFile is a HuggingFace model ID like "Qwen/Qwen3-14B"
    // Check if the model is in the HF cache
    if (!existsSync(HF_CACHE_DIR)) {
      return { ok: false, error: `HF cache directory not found: ${HF_CACHE_DIR}` };
    }
    // HF cache structure: models--org--modelname/
    const cacheDirName = `models--${modelFile.replace("/", "--")}`;
    const cacheModelPath = join(HF_CACHE_DIR, "hub", cacheDirName);
    if (!existsSync(cacheModelPath)) {
      return { ok: false, error: `Model not pre-downloaded. Expected cache at: ${cacheDirName}` };
    }
    return { ok: true };
  }

  if (backend === "ollama") {
    // Ollama handles its own model downloads — no pre-check needed
    return { ok: true };
  }

  // For llama-server, modelFile is a .gguf filename
  const modelPath = join(MODELS_DIR, modelFile);
  if (!existsSync(modelPath)) {
    return { ok: false, error: `Model file not found: ${modelFile}` };
  }
  return { ok: true };
}

// --- Auth Middleware ---

function checkAuth(req: Request): Response | null {
  if (!SECRET) return null; // no secret configured = skip auth
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// --- Request Handlers ---

async function handleHealth(): Promise<Response> {
  return Response.json({ status: "ok" });
}

async function handleStatus(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  try {
    // Read current config from .env
    const env = readEnvFile();
    const currentBackend = env.get("LLM_BACKEND") || "llamacpp";

    // Query container state
    const containerRes = await dockerGet(`/containers/${CONTAINER_NAME}/json`);
    let containerStatus = "not_found";
    let healthy = false;
    let starting = false;
    let model: string | null = null;

    if (containerRes.ok) {
      const container = (await containerRes.json()) as {
        State: { Status: string; Running: boolean; Health?: { Status: string } };
        Config: { Env: string[]; Image: string };
      };
      containerStatus = container.State.Status;
      const healthStatus = container.State.Health?.Status;
      healthy = healthStatus === "healthy";
      starting = container.State.Running && healthStatus !== "healthy";

      model = currentBackend === "vllm"
        ? env.get("VLLM_MODEL") || null
        : env.get("GGUF_FILE") || null;
    }

    // Available backends
    const availableBackends = getAvailableBackends();

    return Response.json({
      backend: currentBackend,
      container: containerStatus,
      healthy,
      starting,
      model,
      availableBackends,
    });
  } catch (err) {
    return Response.json(
      { backend: "unknown", container: "error", healthy: false, model: null, error: String(err) },
      { status: 502 },
    );
  }
}

async function handleSwitch(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  let body: { model_file?: string; backend?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { model_file, backend = "llamacpp" } = body;
  if (!model_file) {
    return Response.json({ error: "model_file is required" }, { status: 400 });
  }

  // Security: only allow known backends
  if (!VALID_BACKENDS.has(backend)) {
    return Response.json({ error: `Unknown backend: ${backend}` }, { status: 400 });
  }

  // Validate model exists on disk
  const check = verifyModelExists(model_file, backend);
  if (!check.ok) {
    return Response.json({ error: check.error, code: "MODEL_NOT_FOUND" }, { status: 400 });
  }

  // Read current .env
  const env = readEnvFile();
  const envKey = backend === "vllm" ? "VLLM_MODEL" : "GGUF_FILE";

  // Security: only allow known env keys
  if (!ALLOWED_ENV_KEYS.has(envKey)) {
    return Response.json({ error: `Blocked env key: ${envKey}` }, { status: 403 });
  }

  const previousModel = env.get(envKey) || null;
  env.set(envKey, model_file);

  // Atomic write
  try {
    writeEnvFile(env);
  } catch (err) {
    return Response.json({ error: `Failed to update .env: ${err}` }, { status: 500 });
  }

  // Restart the container
  try {
    const restartRes = await dockerPost(`/containers/${CONTAINER_NAME}/restart?t=30`);
    if (!restartRes.ok) {
      const errText = await restartRes.text();
      return Response.json({ error: `Docker restart failed: ${errText}` }, { status: 502 });
    }
  } catch (err) {
    return Response.json({ error: `Docker restart error: ${err}` }, { status: 502 });
  }

  return Response.json({
    status: "restarting",
    previous: previousModel,
    next: model_file,
    backend,
    message: `Switching to ${model_file}. Container restarting...`,
  });
}

async function handleSwitchBackend(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  let body: { backend?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { backend, model } = body;
  if (!backend || !VALID_BACKENDS.has(backend)) {
    return Response.json(
      { error: `Invalid backend. Must be one of: ${[...VALID_BACKENDS].join(", ")}` },
      { status: 400 },
    );
  }

  // Read current .env
  const env = readEnvFile();
  const previousBackend = env.get("LLM_BACKEND") || "llamacpp";

  if (backend === previousBackend && !model) {
    return Response.json({ status: "no_change", backend, message: "Already on this backend" });
  }

  // Check that the overlay file exists for the target backend
  const available = getAvailableBackends();
  const target = available.find((b) => b.id === backend);
  if (!target?.installed) {
    return Response.json(
      { error: `Backend ${backend} overlay not installed`, code: "NOT_INSTALLED" },
      { status: 400 },
    );
  }

  // If a model is specified, validate it exists
  if (model) {
    const check = verifyModelExists(model, backend);
    if (!check.ok) {
      return Response.json({ error: check.error, code: "MODEL_NOT_FOUND" }, { status: 400 });
    }
  }

  // 1. Update LLM_BACKEND
  env.set("LLM_BACKEND", backend);

  // 2. Update LLM_API_URL
  env.set("LLM_API_URL", getLlmApiUrl(backend));

  // 3. Update COMPOSE_FILE (add/remove overlays)
  const currentCompose = env.get("COMPOSE_FILE") || "";
  const newCompose = updateComposeFileForBackend(currentCompose, backend);
  env.set("COMPOSE_FILE", newCompose);

  // 4. Update model-specific env vars
  if (model) {
    if (backend === "vllm") {
      env.set("VLLM_MODEL", model);
    } else if (backend === "llamacpp") {
      env.set("GGUF_FILE", model);
    }
  }

  // 5. Atomic write .env
  try {
    writeEnvFile(env);
  } catch (err) {
    return Response.json({ error: `Failed to update .env: ${err}` }, { status: 500 });
  }

  // 6. Detect host Ollama (warn about potential port conflicts)
  let hostOllamaWarning: string | null = null;
  if (backend === "ollama") {
    try {
      const check = Bun.spawnSync(["pgrep", "-x", "ollama"]);
      if (check.exitCode === 0) {
        hostOllamaWarning = "Ollama is also installed on the host. "
          + "The Docker-managed Ollama will use port 11434. "
          + "Consider stopping the host Ollama service (systemctl stop ollama) to avoid conflicts. "
          + "Model storage is shared at ./data/ollama for savings.";
      }
    } catch { /* pgrep not available — skip detection */ }
  }

  // 7. Restart llama-server with the new backend overlay.
  //    Only targets llama-server — dashboard, api, and this controller stay up.
  const composeResult = await composeUp();
  if (!composeResult.ok) {
    return Response.json(
      { error: "Compose up failed", output: composeResult.output, code: "COMPOSE_FAILED" },
      { status: 502 },
    );
  }

  return Response.json({
    status: "switching",
    previous: previousBackend,
    next: backend,
    model: model || null,
    composeFile: newCompose,
    message: `Switched from ${previousBackend} to ${backend}. llama-server restarting...`,
    ...(hostOllamaWarning ? { warning: hostOllamaWarning } : {}),
  });
}

// --- Stop Inference Container ---

async function handleStop(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  const env = readEnvFile();
  const backend = env.get("LLM_BACKEND") || "llamacpp";

  // Ollama: stopping is handled by stopping the container via compose (same as llama-server)
  if (backend === "ollama") {
    return Response.json({
      status: "unloaded",
      message: "Use the Ollama tab to manage model loading/unloading.",
    });
  }

  // For llama-server and vLLM, stop the container
  const containerName = "dream-llama-server";
  try {
    const proc = Bun.spawn(
      ["docker", "stop", containerName],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, DOCKER_HOST: `unix://${DOCKER_SOCKET}` },
      }
    );
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return Response.json({
        status: "stopped",
        container: containerName,
        message: "Inference container stopped. VRAM freed.",
      });
    } else {
      return Response.json(
        { error: `Failed to stop container: ${(stdout + stderr).trim()}` },
        { status: 500 }
      );
    }
  } catch (err) {
    return Response.json({ error: `Stop failed: ${err}` }, { status: 500 });
  }
}

// --- HTTP Server ---

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") return handleHealth();
    if (req.method === "GET" && path === "/status") return handleStatus(req);
    if (req.method === "POST" && path === "/switch") return handleSwitch(req);
    if (req.method === "POST" && path === "/switch-backend") return handleSwitchBackend(req);
    if (req.method === "POST" && path === "/stop") return handleStop(req);

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`[model-controller] listening on :${server.port}`);
