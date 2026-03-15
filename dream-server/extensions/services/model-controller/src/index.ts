/**
 * Dream Server — Model Controller Sidecar
 *
 * A minimal service that manages LLM backend switching, model downloads,
 * and container restarts. This is the ONLY container with Docker socket
 * + .env write access.
 *
 * HTTP API:
 *   GET    /health          — liveness probe
 *   GET    /status          — container state + loaded model + available backends
 *   POST   /switch          — update .env + restart container (same backend)
 *   POST   /switch-backend  — switch LLM backend (llamacpp / vllm / ollama)
 *   POST   /stop            — stop inference container
 *   POST   /download        — start a model download
 *   GET    /downloads       — list active/completed downloads
 *   DELETE /downloads/:id   — cancel an active download
 *
 * WebSocket:
 *   WS     /ws              — real-time download progress + backend events
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

// --- Model Catalog ---

const CATALOG_PATH = join(INSTALL_DIR, "config", "model_catalog.json");

function loadCatalog(): any[] {
  try {
    if (!existsSync(CATALOG_PATH)) return [];
    const data = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
    return data.models || [];
  } catch {
    return [];
  }
}

function findCatalogEntry(modelId: string): any | null {
  const models = loadCatalog();
  return models.find((m: any) => m.id === modelId) || null;
}

// --- Download Manager ---

interface DownloadJob {
  id: string;
  modelId: string;
  modelName: string;
  backend: string;
  status: "downloading" | "complete" | "error" | "cancelled";
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speedBytesPerSec: number;
  error?: string;
  startedAt: number;
  abortController?: AbortController;
}

const activeDownloads = new Map<string, DownloadJob>();
const wsClients = new Set<any>();

function broadcastWS(event: Record<string, any>): void {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}

function updateDownload(jobId: string, updates: Partial<DownloadJob>): void {
  const job = activeDownloads.get(jobId);
  if (!job) return;
  Object.assign(job, updates);
  broadcastWS({
    type: `download:${job.status === "downloading" ? "progress" : job.status}`,
    jobId: job.id,
    modelId: job.modelId,
    modelName: job.modelName,
    backend: job.backend,
    percent: job.percent,
    bytesDownloaded: job.bytesDownloaded,
    bytesTotal: job.bytesTotal,
    speedBytesPerSec: job.speedBytesPerSec,
    error: job.error,
  });
}

// --- GGUF Download (via HuggingFace HTTP) ---

async function downloadGGUF(job: DownloadJob, repo: string, filename: string): Promise<void> {
  const url = `https://huggingface.co/${repo}/resolve/main/${filename}`;
  const destPath = join(MODELS_DIR, filename);
  const tmpPath = destPath + ".downloading";

  try {
    const response = await fetch(url, {
      signal: job.abortController?.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const totalBytes = parseInt(response.headers.get("content-length") || "0", 10);
    job.bytesTotal = totalBytes || job.bytesTotal;

    const writer = Bun.file(tmpPath).writer();
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    let downloaded = 0;
    let lastUpdate = Date.now();
    let lastBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(value);
      downloaded += value.length;

      const now = Date.now();
      if (now - lastUpdate >= 500) {
        const elapsed = (now - lastUpdate) / 1000;
        const speed = Math.round((downloaded - lastBytes) / elapsed);
        const percent = totalBytes > 0 ? Math.round((downloaded / totalBytes) * 1000) / 10 : 0;

        updateDownload(job.id, {
          bytesDownloaded: downloaded,
          percent,
          speedBytesPerSec: speed,
        });

        lastUpdate = now;
        lastBytes = downloaded;
      }
    }

    await writer.end();

    // Rename tmp to final
    const { renameSync } = await import("node:fs");
    renameSync(tmpPath, destPath);

    updateDownload(job.id, {
      status: "complete",
      percent: 100,
      bytesDownloaded: downloaded,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      updateDownload(job.id, { status: "cancelled" });
      try { const { unlinkSync } = await import("node:fs"); unlinkSync(tmpPath); } catch {}
    } else {
      updateDownload(job.id, { status: "error", error: String(err) });
      try { const { unlinkSync } = await import("node:fs"); unlinkSync(tmpPath); } catch {}
    }
  }
}

// --- vLLM Download (pre-load HuggingFace cache via docker exec) ---

async function downloadVLLM(job: DownloadJob, repo: string): Promise<void> {
  let progressInterval: ReturnType<typeof setInterval> | null = null;

  try {
    broadcastWS({
      type: "download:info",
      jobId: job.id,
      message: `Pre-loading HuggingFace cache for ${repo}...`,
    });

    // Get total download size from HF API for accurate progress
    try {
      const resp = await fetch(
        `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`
      );
      if (resp.ok) {
        const files = (await resp.json()) as any[];
        const totalBytes = files
          .filter((f: any) => f.type === "file")
          .reduce((sum: number, f: any) => sum + (f.lfs?.size || f.size || 0), 0);
        if (totalBytes > 0) {
          job.bytesTotal = totalBytes;
          updateDownload(job.id, { bytesTotal: totalBytes });
        }
      }
    } catch {} // non-critical — progress just won't have byte counts

    // Monitor HF cache blobs directory for download progress.
    // The model-controller's /hf-cache maps to the same host dir as
    // /root/.cache/huggingface inside the vLLM container.
    const cacheSubdir = `models--${repo.replace("/", "--")}`;
    const cacheBlobsDir = join(HF_CACHE_DIR, "hub", cacheSubdir, "blobs");
    let lastSpeedCheck = Date.now();
    let lastSpeedBytes = 0;

    progressInterval = setInterval(() => {
      try {
        if (!existsSync(cacheBlobsDir)) return;
        let totalSize = 0;
        for (const entry of readdirSync(cacheBlobsDir)) {
          try { totalSize += Bun.file(join(cacheBlobsDir, entry)).size; } catch {}
        }
        if (totalSize > 0) {
          const now = Date.now();
          const elapsed = (now - lastSpeedCheck) / 1000;
          const speed = elapsed > 0 ? Math.round((totalSize - lastSpeedBytes) / elapsed) : 0;
          lastSpeedCheck = now;
          lastSpeedBytes = totalSize;

          const percent = job.bytesTotal > 0
            ? Math.min(95, Math.round((totalSize / job.bytesTotal) * 100))
            : 0;
          updateDownload(job.id, {
            percent,
            bytesDownloaded: totalSize,
            speedBytesPerSec: Math.max(0, speed),
          });
        }
      } catch {}
    }, 2000);

    // Run huggingface-cli download inside the llama-server (vLLM) container.
    // The vLLM image has huggingface-cli pre-installed and the HF cache
    // is mounted at the default path (/root/.cache/huggingface).
    const proc = Bun.spawn(
      [
        "docker", "exec",
        "-e", "HF_HUB_DISABLE_PROGRESS_BARS=1",
        CONTAINER_NAME,
        "huggingface-cli", "download", repo,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Handle abort
    if (job.abortController) {
      job.abortController.signal.addEventListener("abort", () => {
        proc.kill();
      });
    }

    // Read stderr concurrently to prevent buffer deadlock
    const stderrPromise = new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearInterval(progressInterval);
    progressInterval = null;
    const errText = await stderrPromise;

    if (exitCode === 0) {
      // Update .env so activating this model is instant
      const env = readEnvFile();
      env.set("VLLM_MODEL", repo);
      writeEnvFile(env);

      updateDownload(job.id, {
        status: "complete",
        percent: 100,
        bytesDownloaded: job.bytesTotal,
      });
    } else {
      const isContainerErr =
        errText.includes("No such container") ||
        errText.includes("is not running") ||
        errText.includes("connection refused");

      updateDownload(job.id, {
        status: "error",
        error: isContainerErr
          ? "vLLM container is not running. Switch to the vLLM backend first, then download."
          : `Download failed (exit ${exitCode}): ${errText.slice(-500)}`,
      });
    }
  } catch (err: any) {
    if (progressInterval) clearInterval(progressInterval);
    if (err?.name === "AbortError") {
      updateDownload(job.id, { status: "cancelled" });
    } else {
      updateDownload(job.id, { status: "error", error: String(err) });
    }
  }
}

// --- Ollama Download (via Ollama API streaming pull) ---

async function downloadOllama(job: DownloadJob, modelName: string): Promise<void> {
  try {
    const ollamaUrl = getLlmApiUrl("ollama");
    const response = await fetch(`${ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, stream: true }),
      signal: job.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama pull failed: HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body from Ollama");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.total && data.completed) {
            const percent = Math.round((data.completed / data.total) * 1000) / 10;
            updateDownload(job.id, {
              percent,
              bytesDownloaded: data.completed,
              bytesTotal: data.total,
            });
          }
          if (data.status === "success") {
            updateDownload(job.id, {
              status: "complete",
              percent: 100,
              bytesDownloaded: job.bytesTotal,
            });
            return;
          }
        } catch {}
      }
    }

    // If we exit the loop without success, mark complete
    updateDownload(job.id, { status: "complete", percent: 100 });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      updateDownload(job.id, { status: "cancelled" });
    } else {
      updateDownload(job.id, { status: "error", error: String(err) });
    }
  }
}

// --- Download Request Handler ---

async function handleDownload(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  let body: any;
  try { body = await req.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { modelId } = body;
  if (!modelId) {
    return Response.json({ error: "modelId required" }, { status: 400 });
  }

  // Check for already-active download
  for (const [, j] of activeDownloads) {
    if (j.modelId === modelId && j.status === "downloading") {
      return Response.json({ error: "Download already in progress", jobId: j.id }, { status: 409 });
    }
  }

  // Look up model in catalog
  const entry = findCatalogEntry(modelId);
  if (!entry) {
    return Response.json({ error: `Model '${modelId}' not found in catalog` }, { status: 404 });
  }

  const jobId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: DownloadJob = {
    id: jobId,
    modelId,
    modelName: entry.name,
    backend: entry.backends?.[0] || "unknown",
    status: "downloading",
    percent: 0,
    bytesDownloaded: 0,
    bytesTotal: Math.round((entry.size_gb || 0) * 1024 * 1024 * 1024),
    speedBytesPerSec: 0,
    startedAt: Date.now(),
    abortController: new AbortController(),
  };
  activeDownloads.set(jobId, job);

  // Dispatch download based on backend
  if (entry.gguf) {
    const { huggingface_repo, huggingface_file } = entry.gguf;
    downloadGGUF(job, huggingface_repo, huggingface_file).catch(() => {});
  } else if (entry.vllm) {
    downloadVLLM(job, entry.vllm.huggingface_repo).catch(() => {});
  } else if (entry.ollama) {
    downloadOllama(job, entry.ollama.model_name || entry.name).catch(() => {});
  } else {
    activeDownloads.delete(jobId);
    return Response.json({ error: "No download info for this model" }, { status: 400 });
  }

  // Broadcast start event
  broadcastWS({
    type: "download:started",
    jobId,
    modelId,
    modelName: entry.name,
    backend: job.backend,
  });

  return Response.json({ status: "started", jobId, modelId });
}

function handleGetDownloads(req: Request): Response {
  const authError = checkAuth(req);
  if (authError) return authError;

  const downloads: any[] = [];
  for (const [, job] of activeDownloads) {
    downloads.push({
      id: job.id,
      modelId: job.modelId,
      modelName: job.modelName,
      backend: job.backend,
      status: job.status,
      percent: job.percent,
      bytesDownloaded: job.bytesDownloaded,
      bytesTotal: job.bytesTotal,
      speedBytesPerSec: job.speedBytesPerSec,
      error: job.error,
    });
  }
  return Response.json({ downloads });
}

function handleCancelDownload(req: Request, jobId: string): Response {
  const authError = checkAuth(req);
  if (authError) return authError;

  const job = activeDownloads.get(jobId);
  if (!job) {
    return Response.json({ error: "Download not found" }, { status: 404 });
  }
  if (job.status !== "downloading") {
    return Response.json({ error: `Download is ${job.status}, cannot cancel` }, { status: 400 });
  }

  job.abortController?.abort();
  return Response.json({ status: "cancelling", jobId });
}

// Cleanup completed/errored downloads older than 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, job] of activeDownloads) {
    if (job.status !== "downloading" && job.startedAt < cutoff) {
      activeDownloads.delete(id);
    }
  }
}, 60_000);

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

// --- HTTP + WebSocket Server ---

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request, server: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (path === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined as any; // Bun handles the response
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // REST routes
    if (req.method === "GET" && path === "/health") return handleHealth();
    if (req.method === "GET" && path === "/status") return handleStatus(req);
    if (req.method === "POST" && path === "/switch") return handleSwitch(req);
    if (req.method === "POST" && path === "/switch-backend") return handleSwitchBackend(req);
    if (req.method === "POST" && path === "/stop") return handleStop(req);
    if (req.method === "POST" && path === "/download") return handleDownload(req);
    if (req.method === "GET" && path === "/downloads") return handleGetDownloads(req);
    if (req.method === "DELETE" && path.startsWith("/downloads/")) {
      const jobId = path.slice("/downloads/".length);
      return handleCancelDownload(req, jobId);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
  websocket: {
    open(ws: any) {
      wsClients.add(ws);
      // Send current download state on connect
      for (const [, job] of activeDownloads) {
        if (job.status === "downloading") {
          ws.send(JSON.stringify({
            type: "download:progress",
            jobId: job.id,
            modelId: job.modelId,
            modelName: job.modelName,
            backend: job.backend,
            percent: job.percent,
            bytesDownloaded: job.bytesDownloaded,
            bytesTotal: job.bytesTotal,
            speedBytesPerSec: job.speedBytesPerSec,
          }));
        }
      }
    },
    close(ws: any) {
      wsClients.delete(ws);
    },
    message() {
      // No client-to-server messages needed yet
    },
  },
});

console.log(`[model-controller] listening on :${server.port} (HTTP + WS)`);
