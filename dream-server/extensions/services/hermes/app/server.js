const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const { DreamRuntime } = require("./runtime/core");
const { DEFAULT_LOCAL_MODEL, createDefaultState, normalizeState } = require("./runtime/state");
const { getLocalTokenTelemetry } = require("./runtime/providers/local");
const { resolveLocalEndpointForHermes } = require("./runtime/providers/hermes");
const { getSystemDashboardSnapshot } = require("./runtime/system-dashboard");

const PORT = Number(process.env.PORT || process.env.HERMES_PORT || 3010);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_ROOT = path.resolve(process.env.HERMES_DATA_DIR || path.join(process.cwd(), ".data"));
const STORE_PATH = path.join(DATA_ROOT, "dream-server-hermes-state.json");
const WORKSPACE_ROOT = path.resolve(process.env.HERMES_WORKSPACE_ROOT || path.join(DATA_ROOT, "workspace"));
const UPLOADS_ROOT = path.resolve(process.env.HERMES_UPLOADS_DIR || path.join(DATA_ROOT, "uploads"));
const STATIC_ROOT = path.join(__dirname, "src");
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const AUTH_COOKIE_NAME = "dream_hermes_token";
const AUTH_TOKEN_PATH = path.join(DATA_ROOT, "dream-server-hermes-web-token");

let runtime = null;
let secretBlob = null;
let webAuthToken = "";
let persistTimer = null;
let previewDeviceMode = "desktop";
const eventClients = new Map();
const previewHarnessRequests = new Map();

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function initWebAuthToken() {
  const envToken = String(process.env.HERMES_WEB_TOKEN || "").trim();
  if (envToken) {
    webAuthToken = envToken;
    return;
  }
  const persisted = await fsp.readFile(AUTH_TOKEN_PATH, "utf8").then((raw) => raw.trim()).catch(() => "");
  if (persisted) {
    webAuthToken = persisted;
    return;
  }
  webAuthToken = crypto.randomBytes(32).toString("base64url");
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.writeFile(AUTH_TOKEN_PATH, `${webAuthToken}\n`, { mode: 0o600 });
}

function dreamLocalBaseUrl() {
  const explicit = String(process.env.HERMES_LOCAL_BASE_URL || "").trim();
  if (explicit) {
    return explicit;
  }
  const llmUrl = String(process.env.LLM_API_URL || "").trim().replace(/\/+$/, "");
  const basePath = String(process.env.LLM_API_BASE_PATH || "/v1").trim() || "/v1";
  if (llmUrl) {
    return `${llmUrl}${basePath.startsWith("/") ? basePath : `/${basePath}`}`;
  }
  return "http://litellm:4000/v1";
}

function defaultLocalApiKey() {
  return String(process.env.HERMES_LOCAL_API_KEY || process.env.LITELLM_KEY || "not-needed").trim() || "not-needed";
}

function createServiceDefaultState() {
  const state = createDefaultState();
  state.settings.providerMode = "local";
  state.settings.hermesProvider = "custom";
  state.settings.localBaseUrl = dreamLocalBaseUrl();
  state.settings.localApiKey = defaultLocalApiKey();
  state.settings.localModel = String(process.env.HERMES_LOCAL_MODEL || process.env.LLM_MODEL || "default").trim() || "default";
  state.settings.localLlamaEnabled = false;
  state.settings.localLlamaAutoStart = false;
  return state;
}

function applyDreamServerDefaults(state) {
  const normalized = normalizeState(state || createServiceDefaultState());
  const settings = normalized.settings || {};
  const defaultLocal = dreamLocalBaseUrl();
  const looksDesktopDefault = /^(https?:\/\/)?(127\.0\.0\.1|localhost):11435\/v1\/?$/i.test(String(settings.localBaseUrl || ""));
  if (!settings.localBaseUrl || looksDesktopDefault) {
    settings.localBaseUrl = defaultLocal;
  }
  if (!settings.localApiKey) {
    settings.localApiKey = defaultLocalApiKey();
  }
  if (!settings.hermesProvider) {
    settings.hermesProvider = "custom";
  }
  if (settings.hermesProvider === "custom" && (!settings.localModel || settings.localModel === DEFAULT_LOCAL_MODEL)) {
    settings.localModel = String(process.env.HERMES_LOCAL_MODEL || process.env.LLM_MODEL || "default").trim() || "default";
  }
  if (!settings.providerMode || settings.providerMode === "cloud") {
    settings.providerMode = "local";
  }
  normalized.settings = settings;
  return normalized;
}

function encodeSecret(value) {
  const raw = String(value || "");
  return raw ? Buffer.from(raw, "utf8").toString("base64") : null;
}

function decodeSecret(value = secretBlob) {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(String(value), "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function readPersistedStore() {
  if (!fs.existsSync(STORE_PATH)) {
    return {
      runtimeState: createServiceDefaultState(),
      apiKeySecret: null,
      previewDeviceMode: "desktop"
    };
  }
  try {
    const raw = JSON.parse(await fsp.readFile(STORE_PATH, "utf8"));
    return {
      runtimeState: applyDreamServerDefaults(raw.runtimeState || raw),
      apiKeySecret: raw.apiKeySecret || null,
      previewDeviceMode: normalizePreviewDeviceMode(raw.previewDeviceMode)
    };
  } catch {
    return {
      runtimeState: createServiceDefaultState(),
      apiKeySecret: null,
      previewDeviceMode: "desktop"
    };
  }
}

async function persistStore() {
  if (!runtime) {
    return;
  }
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.writeFile(
    STORE_PATH,
    JSON.stringify(
      {
        ...runtime.getSnapshot(),
        apiKeySecret: secretBlob,
        previewDeviceMode
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
    persistStore().catch(() => {});
  }, 80);
}

function buildHostInfo() {
  const envShell = path.basename(String(process.env.SHELL || "")).toLowerCase();
  return {
    platform: process.platform,
    platformLabel: `${process.platform} ${process.arch}`,
    arch: process.arch,
    release: os.release(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
    isWsl: Boolean(process.env.WSL_DISTRO_NAME),
    managedLlamaAvailable: false,
    managedLlamaBinaryPath: "",
    defaultShell: ["bash", "zsh", "sh"].includes(envShell) ? envShell : "sh",
    defaultShellLabel: "bash/sh"
  };
}

function uploadUrlForPath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const uploadsRoot = path.resolve(UPLOADS_ROOT);
  const resolved = path.resolve(raw);
  if (!isInsideRoot(resolved, uploadsRoot)) {
    return "";
  }
  const relative = path.relative(uploadsRoot, resolved);
  return `/uploads/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function isInsideRoot(target, root) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathOrCreateRoot(root) {
  await fsp.mkdir(root, { recursive: true });
  return fsp.realpath(root);
}

async function resolveWorkspaceWriteTarget(rawPath) {
  const workspaceRoot = await realpathOrCreateRoot(WORKSPACE_ROOT);
  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath);
  if (!isInsideRoot(candidate, workspaceRoot)) {
    throw Object.assign(new Error("File path must stay inside the Hermes workspace."), { statusCode: 400 });
  }
  const parent = path.dirname(candidate);
  await fsp.mkdir(parent, { recursive: true });
  const parentReal = await fsp.realpath(parent);
  if (!isInsideRoot(parentReal, workspaceRoot)) {
    throw Object.assign(new Error("File path must stay inside the Hermes workspace."), { statusCode: 400 });
  }
  const target = path.join(parentReal, path.basename(candidate));
  const existingReal = await fsp.realpath(target).catch(() => "");
  if (existingReal && !isInsideRoot(existingReal, workspaceRoot)) {
    throw Object.assign(new Error("File path must stay inside the Hermes workspace."), { statusCode: 400 });
  }
  return target;
}

function uploadPathForUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  let pathname = raw;
  try {
    pathname = new URL(raw, "http://hermes.local").pathname;
  } catch {}
  if (!pathname.startsWith("/uploads/")) {
    return raw;
  }
  const relative = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  const target = path.resolve(UPLOADS_ROOT, relative);
  if (!isInsideRoot(target, UPLOADS_ROOT)) {
    throw Object.assign(new Error("Invalid upload path."), { statusCode: 400 });
  }
  return target;
}

function decoratePublicStateForWeb(state) {
  if (!state || typeof state !== "object") {
    return state;
  }
  const backgroundUrl = uploadUrlForPath(state.settings?.backgroundMediaPath);
  if (backgroundUrl && state.settings) {
    state.settings.backgroundMediaPath = backgroundUrl;
  }
  for (const chat of state.chats || []) {
    for (const message of chat.messages || []) {
      for (const attachment of message.attachments || []) {
        const url = uploadUrlForPath(attachment.path);
        if (url) {
          attachment.url = url;
        }
      }
    }
  }
  return state;
}

function buildPublicState() {
  const state = decoratePublicStateForWeb(runtime.getPublicState({
    hasCloudApiKey: Boolean(decodeSecret()),
    previewDeviceMode,
    hostInfo: buildHostInfo()
  }));
  state.providerMode = state.settings?.providerMode || runtime.state?.settings?.providerMode || "local";
  state.previewDeviceMode = previewDeviceMode;
  return state;
}

function normalizePreviewDeviceMode(value) {
  return String(value || "").toLowerCase() === "mobile" ? "mobile" : "desktop";
}

function sendEvent(channel, payload) {
  const message = `event: message\ndata: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const [id, res] of eventClients) {
    try {
      res.write(message);
    } catch {
      eventClients.delete(id);
    }
  }
}

function requestPreviewHarness(command = {}, timeoutMs = 20000) {
  if (eventClients.size === 0) {
    return Promise.reject(new Error("Nenhum navegador conectado ao Dream Server DESKTOP para controlar o preview."));
  }
  const id = `preview-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const timeout = Math.max(1500, Math.min(Number(timeoutMs || 20000), 120000));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      previewHarnessRequests.delete(id);
      reject(new Error(`Preview harness nao respondeu em ${timeout}ms.`));
    }, timeout);
    previewHarnessRequests.set(id, { resolve, reject, timer });
    sendEvent("preview-harness:command", { id, command });
  });
}

async function initRuntime() {
  await fsp.mkdir(WORKSPACE_ROOT, { recursive: true });
  await fsp.mkdir(UPLOADS_ROOT, { recursive: true });
  const loaded = await readPersistedStore();
  secretBlob = loaded.apiKeySecret;
  previewDeviceMode = loaded.previewDeviceMode;
  runtime = new DreamRuntime({
    initialState: applyDreamServerDefaults(loaded.runtimeState),
    workspaceRoot: WORKSPACE_ROOT,
    previewHarness: requestPreviewHarness,
    getCloudApiKey: () => decodeSecret()
  });
  runtime.on("state_changed", (event) => {
    schedulePersist();
    sendEvent("runtime:event", event);
  });
  const before = JSON.stringify({
    localBaseUrl: runtime.state.settings.localBaseUrl,
    localModel: runtime.state.settings.localModel
  });
  await resolveLocalEndpointForHermes(runtime.state.settings).catch(() => {});
  const after = JSON.stringify({
    localBaseUrl: runtime.state.settings.localBaseUrl,
    localModel: runtime.state.settings.localModel
  });
  if (after !== before) {
    await persistStore();
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function requestHeaderToken(req) {
  const header = req.headers["x-dream-hermes-token"];
  return Array.isArray(header) ? header[0] : String(header || "");
}

function requestCookieToken(req) {
  return parseCookies(req)[AUTH_COOKIE_NAME] || "";
}

function sameOriginRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) {
    return true;
  }
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(req.headers.host || "").toLowerCase();
    return originHost === requestHost;
  } catch {
    return false;
  }
}

function assertApiAuth(req, url) {
  if (url.pathname === "/health") {
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    return;
  }
  if (!sameOriginRequest(req)) {
    throw Object.assign(new Error("Forbidden origin."), { statusCode: 403 });
  }
  const headerOk = tokenEquals(requestHeaderToken(req), webAuthToken);
  const cookieOk = tokenEquals(requestCookieToken(req), webAuthToken);
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET");
  if (unsafe ? !headerOk : !(headerOk || cookieOk)) {
    throw Object.assign(new Error("Missing or invalid local session token."), { statusCode: 403 });
  }
}

function assertJsonContentType(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw Object.assign(new Error("Expected application/json request body."), { statusCode: 415 });
  }
}

async function readBody(req, limitBytes = MAX_JSON_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  assertJsonContentType(req);
  const body = await readBody(req);
  const text = body.toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function sanitizeFilename(value) {
  const base = path.basename(String(value || "upload.bin")).replace(/[^\w.\-]+/g, "_");
  return base || "upload.bin";
}

function parseMultipart(buffer, contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw Object.assign(new Error("Missing multipart boundary."), { statusCode: 400 });
  }
  const boundary = `--${match[1] || match[2]}`;
  const raw = buffer.toString("binary");
  const parts = raw.split(boundary).slice(1, -1);
  return parts.map((part) => {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitAt = trimmed.indexOf("\r\n\r\n");
    if (splitAt < 0) {
      return null;
    }
    const headerText = trimmed.slice(0, splitAt);
    const bodyBinary = trimmed.slice(splitAt + 4);
    const disposition = headerText.match(/content-disposition:[^\r\n]*name="([^"]+)"(?:; filename="([^"]*)")?/i);
    if (!disposition || !disposition[2]) {
      return null;
    }
    const contentTypeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    return {
      field: disposition[1],
      filename: sanitizeFilename(disposition[2]),
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream",
      data: Buffer.from(bodyBinary, "binary")
    };
  }).filter(Boolean);
}

async function saveUploadedFiles(req) {
  const body = await readBody(req, MAX_UPLOAD_BYTES);
  const files = parseMultipart(body, req.headers["content-type"]);
  await fsp.mkdir(UPLOADS_ROOT, { recursive: true });
  const saved = [];
  for (const file of files) {
    const id = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${file.filename}`;
    const target = path.join(UPLOADS_ROOT, id);
    await fsp.writeFile(target, file.data);
    saved.push({
      id,
      filename: file.filename,
      path: target,
      url: `/uploads/${encodeURIComponent(id)}`,
      type: "file",
      contentType: file.contentType,
      size: file.data.length
    });
  }
  return saved;
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "hermes", mode: "web-service" });
  }
  assertApiAuth(req, url);
  if (req.method === "GET" && url.pathname === "/api/events") {
    const id = crypto.randomBytes(8).toString("hex");
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(`event: message\ndata: ${JSON.stringify({ channel: "connected", payload: { id } })}\n\n`);
    eventClients.set(id, res);
    req.on("close", () => eventClients.delete(id));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "GET" && url.pathname === "/api/system") {
    return sendJson(res, 200, await getSystemDashboardSnapshot({ tokens: getLocalTokenTelemetry() }));
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const payload = await readJson(req);
    const cloudApiKey = String(payload.apiKey || "").trim();
    if (cloudApiKey) {
      secretBlob = encodeSecret(cloudApiKey);
    }
    if (payload.backgroundMediaPath) {
      payload.backgroundMediaPath = uploadPathForUrl(payload.backgroundMediaPath);
    }
    runtime.updateSettings({ ...payload, apiKey: undefined });
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/settings/clear-api-key") {
    secretBlob = null;
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats") {
    runtime.createChat(runtime.state.settings.providerMode);
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats/select") {
    const payload = await readJson(req);
    runtime.selectChat(payload.chatId);
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats/delete") {
    const payload = await readJson(req);
    await runtime.deleteChat(payload.chatId);
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats/set-provider") {
    const payload = await readJson(req);
    runtime.setChatProvider(payload.chatId, payload.providerMode);
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats/stop") {
    const payload = await readJson(req);
    await runtime.stopChat(payload.chatId);
    await persistStore();
    return sendJson(res, 200, { state: buildPublicState() });
  }
  if (req.method === "GET" && url.pathname === "/api/provider/local-models") {
    return sendJson(res, 200, await runtime.listLocalModels());
  }
  if (req.method === "GET" && url.pathname === "/api/provider/local-llama-status") {
    return sendJson(res, 200, runtime.getLocalLlamaState());
  }
  if (req.method === "POST" && url.pathname === "/api/provider/local-llama-start") {
    runtime.updateSettings({ localBaseUrl: dreamLocalBaseUrl(), localApiKey: defaultLocalApiKey(), localLlamaEnabled: false });
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/provider/local-llama-stop") {
    await runtime.stopManagedLocalLlama().catch(() => {});
    await persistStore();
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/chats/send") {
    const payload = await readJson(req);
    const attachmentPaths = Array.isArray(payload.attachmentPaths)
      ? payload.attachmentPaths.map(uploadPathForUrl)
      : [];
    await runtime.sendMessage({
      chatId: payload.chatId,
      text: payload.text,
      attachmentPaths,
      cloudApiKey: decodeSecret()
    });
    await persistStore();
    return sendJson(res, 200, { state: buildPublicState(), aborted: false });
  }
  if (req.method === "GET" && url.pathname === "/api/chats/sync") {
    return sendJson(res, 200, buildPublicState());
  }
  if (req.method === "POST" && url.pathname === "/api/desktop/run-action") {
    const payload = await readJson(req);
    await runtime.runSuggestedAction({
      chatId: payload.chatId,
      actionKey: payload.actionKey,
      action: payload.action,
      cloudApiKey: decodeSecret()
    });
    await persistStore();
    return sendJson(res, 200, { ok: true, message: "Acao aprovada.", state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/desktop/stop-all-local-activity") {
    const response = await runtime.stopAllLocalActivity();
    await persistStore();
    return sendJson(res, 200, { ok: true, message: response.result || "Atividade local interrompida.", state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/desktop/stop-background-job") {
    const payload = await readJson(req);
    const response = await runtime.stopBackgroundJob(payload.jobId);
    await persistStore();
    return sendJson(res, 200, { ok: true, message: response.result || "Job interrompido.", state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/desktop/close-terminal-session") {
    const payload = await readJson(req);
    const response = await runtime.closeTerminalSession(payload.sessionId);
    await persistStore();
    return sendJson(res, 200, { ok: true, message: response.result || "Terminal fechado.", state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/code/save-file") {
    const payload = await readJson(req);
    const content = String(payload.content ?? "");
    const rawPath = String(payload.path || "").trim();
    if (!rawPath) {
      return sendJson(res, 400, { error: "Caminho do arquivo ausente." });
    }
    const target = await resolveWorkspaceWriteTarget(rawPath);
    await fsp.writeFile(target, content, "utf8");
    return sendJson(res, 200, { ok: true, path: target, state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/preview/ensure-mobile-service") {
    return sendJson(res, 200, {
      ok: true,
      mode: previewDeviceMode,
      uiUrl: "/",
      browserUrl: "/",
      capabilitiesUrl: "/health"
    });
  }
  if (req.method === "POST" && url.pathname === "/api/preview/set-mode") {
    const payload = await readJson(req);
    previewDeviceMode = normalizePreviewDeviceMode(payload.mode);
    await persistStore();
    return sendJson(res, 200, { ok: true, mode: previewDeviceMode, state: buildPublicState() });
  }
  if (req.method === "POST" && url.pathname === "/api/preview-harness/result") {
    const payload = await readJson(req);
    const request = previewHarnessRequests.get(String(payload.id || ""));
    if (!request) {
      return sendJson(res, 200, false);
    }
    previewHarnessRequests.delete(String(payload.id || ""));
    clearTimeout(request.timer);
    if (payload.ok) {
      request.resolve(payload.result);
    } else {
      request.reject(new Error(String(payload.error || "Preview harness falhou.")));
    }
    return sendJson(res, 200, true);
  }
  if (req.method === "POST" && url.pathname === "/api/preview-harness/request") {
    const payload = await readJson(req);
    return sendJson(res, 200, await requestPreviewHarness(payload.command || {}, payload.timeoutMs || 20000));
  }
  if (req.method === "POST" && url.pathname === "/api/uploads") {
    return sendJson(res, 200, { files: await saveUploadedFiles(req) });
  }
  return null;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ttf": "font/ttf",
    ".glsl": "text/plain; charset=utf-8"
  }[ext] || "application/octet-stream";
}

function authCookieHeader() {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(webAuthToken)}; Path=/; SameSite=Strict`;
}

async function serveFile(res, root, requestPath, cache = true, extraHeaders = {}) {
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, "") || "index.html";
  const target = path.resolve(root, relative);
  if (!isInsideRoot(target, root)) {
    return sendText(res, 403, "Forbidden");
  }
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) {
    return sendText(res, 404, "Not found");
  }
  res.writeHead(200, {
    "content-type": mimeType(target),
    "content-length": stat.size,
    "cache-control": cache ? "public, max-age=3600" : "no-cache",
    ...extraHeaders
  });
  fs.createReadStream(target).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    const apiResult = await routeApi(req, res, url);
    if (apiResult !== null) {
      return;
    }
    if (url.pathname.startsWith("/uploads/")) {
      return await serveFile(res, UPLOADS_ROOT, url.pathname.replace(/^\/uploads\//, ""), false);
    }
    return await serveFile(res, STATIC_ROOT, url.pathname === "/" ? "/index.html" : url.pathname, true, {
      "set-cookie": authCookieHeader()
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendJson(res, statusCode, { error: error.message || String(error) });
  }
}

initWebAuthToken()
  .then(initRuntime)
  .then(() => {
    http.createServer(handleRequest).listen(PORT, HOST, () => {
      console.log(`Dream Server DESKTOP service listening on http://${HOST}:${PORT}`);
      console.log(`Dream Server DESKTOP local base URL: ${dreamLocalBaseUrl()}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
