const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_PROVIDER_MODE = "local";
const DEFAULT_LOCAL_HOST = "127.0.0.1";
const DEFAULT_LOCAL_LLAMA_PORT = 11435;
const DEFAULT_LOCAL_BASE_URL = `http://${DEFAULT_LOCAL_HOST}:${DEFAULT_LOCAL_LLAMA_PORT}/v1`;
const DEFAULT_LOCAL_MODEL = "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M";
let bundledLocalLlamaRuntimeCache = null;

function normalizeLocale(value) {
  const locale = String(value || "").trim().replace("_", "-");
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}

function defaultLocale() {
  return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale) || "en-US";
}

function projectRoot() {
  const root = path.resolve(__dirname, "..");
  return root.includes("app.asar") ? root.replace("app.asar", "app.asar.unpacked") : root;
}

function bundledLocalLlamaRuntimeAvailable() {
  if (bundledLocalLlamaRuntimeCache !== null) {
    return bundledLocalLlamaRuntimeCache;
  }
  const root = path.join(projectRoot(), "bin", "llama");
  const names = process.platform === "win32"
    ? new Set(["llama-server.exe", "server.exe"])
    : new Set(["llama-server", "server"]);

  function visit(dir, depth = 0) {
    if (depth > 5) {
      return false;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (visit(absolute, depth + 1)) {
          return true;
        }
      } else if (names.has(entry.name.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  bundledLocalLlamaRuntimeCache = visit(root);
  return bundledLocalLlamaRuntimeCache;
}

function defaultLocalLlamaModelDir() {
  if (process.platform === "win32") {
    return "%LOCALAPPDATA%\\Dream Server\\models";
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Dream Server", "models");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "dream-server", "models");
}

const DEFAULT_LOCAL_LLAMA_MODEL_DIR = defaultLocalLlamaModelDir();

function createDefaultState() {
  const managedLocalLlamaAvailable = bundledLocalLlamaRuntimeAvailable();
  return {
    settings: {
      providerMode: DEFAULT_PROVIDER_MODE,
      agentProfile: "manus-1.6",
      locale: defaultLocale(),
      interactiveMode: false,
      desktopBridgeEnabled: true,
      fullAccessMode: false,
      autoRunLocalActions: false,
      agentBackend: "hermes",
      localBaseUrl: DEFAULT_LOCAL_BASE_URL,
      localModel: DEFAULT_LOCAL_MODEL,
      localApiKey: "not-needed",
      hermesProvider: "custom",
      hermesApiMode: "auto",
      hermesProvidersAllowed: [],
      hermesProvidersIgnored: [],
      hermesProvidersOrder: [],
      hermesProviderSort: "",
      hermesProviderRequireParameters: false,
      hermesProviderDataCollection: "",
      localThinkingEnabled: false,
      localLlamaEnabled: managedLocalLlamaAvailable,
      localLlamaAutoStart: managedLocalLlamaAvailable,
      localLlamaHost: DEFAULT_LOCAL_HOST,
      localLlamaPort: DEFAULT_LOCAL_LLAMA_PORT,
      localLlamaModelDir: DEFAULT_LOCAL_LLAMA_MODEL_DIR,
      localLlamaModelPath: "",
      localLlamaContextSize: 16384,
      localLlamaGpuLayers: 999,
      localLlamaBatchSize: 1024,
      localLlamaStartupTimeoutMs: 180000,
      hermesDesktopIntegrationEnabled: true,
      hermesDoctorTimeoutMs: 60000,
      localMaxTokens: 4096,
      hermesMaxTokens: 8192,
      hermesMaxIterations: 16,
      hermesToolsets: [],
      gatewayEnabled: false,
      gatewayAutoStart: false,
      gatewayDoctorTimeoutMs: 60000,
      gatewayPlatforms: {},
      kanbanGitEnabled: false,
      kanbanAutoSchedulerEnabled: true,
      kanbanAutoRecoverEnabled: true,
      kanbanAutoCleanupEnabled: true,
      kanbanAutoPrEnabled: false,
      kanbanMultiAgentOrchestrationEnabled: false,
      kanbanMaxParallelAgents: 3,
      kanbanSchedulerIntervalMs: 2500,
      backgroundMediaPath: "./assets/default-wallpaper.png",
      dreamPetEnabled: false,
      dreamPetBubbleEnabled: true,
      dreamPetVoiceEnabled: false,
      dreamPetVoiceName: "",
      dreamPetWindowBounds: null,
      connectorIds: [],
      enableSkillIds: [],
      forceSkillIds: [],
      trustMode: "ask",
      allowedPermissionClasses: [],
      theme: {
        preset: "roxo",
        accent: "#7c6cfc",
        accentHi: "#a89bff",
        stopA: "rgba(130, 50,255,0.80)",
        stopB: "rgba( 30, 60,240,0.75)",
        stopC: "rgba( 80, 10,210,0.50)",
        stopD: "rgba(210, 70,255,0.45)",
        stopE: "rgba( 50, 30,200,0.45)",
        base: "#04030b",
        tint: "#0a081c",
        blur: 30,
        blurBackground: 30,
        blurSidebar: 30,
        blurTopbar: 30,
        blurComposer: 30
      },
      codeShaderEnabled: true,
      codeShaderPreset: "bar",
      codeCursorShader: "blaze",
      codeShaderIntensity: 100
    },
    todos: [],
    tasks: [],
    agents: [],
    projects: [],
    chats: [],
    selectedChatId: null
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function expandEnvPath(value) {
  const expanded = String(value || "")
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || "")
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || "")
    .replace(/%APPDATA%/gi, process.env.APPDATA || "")
    .trim();
  return path.normalize(expanded.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function normalizeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

const GATEWAY_PLATFORM_IDS = new Set([
  "discord",
  "telegram",
  "slack",
  "matrix",
  "mattermost",
  "signal",
  "whatsapp",
  "homeassistant",
  "email",
  "sms",
  "api_server",
  "webhook",
  "dingtalk",
  "feishu",
  "wecom",
  "weixin",
  "bluebubbles",
  "qqbot",
  "yuanbao"
]);

function normalizeGatewayPlatforms(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const id of GATEWAY_PLATFORM_IDS) {
    const entry = source[id] && typeof source[id] === "object" ? source[id] : {};
    normalized[id] = {};
    for (const [key, raw] of Object.entries(entry)) {
      if (key === "enabled") {
        normalized[id].enabled = Boolean(raw);
      } else {
        normalized[id][key] = String(raw || "").trim();
      }
    }
    normalized[id].enabled = Boolean(normalized[id].enabled);
  }
  return normalized;
}

const DEFAULT_THEME = {
  preset: "rose",
  accent: "#8a0000",
  accentHi: "#ff4b4b",
  stopA: "rgba(138,  0,  0,0.80)",
  stopB: "rgba( 86,  0,  0,0.75)",
  stopC: "rgba( 96,  0,  0,0.50)",
  stopD: "rgba(210, 28, 28,0.44)",
  stopE: "rgba( 70,  0,  0,0.45)",
  base: "#080202",
  tint: "#170505",
  blur: 30,
  blurBackground: 30,
  blurSidebar: 30,
  blurTopbar: 30,
  blurComposer: 30
};

const LEGACY_CODE_SHADER_PRESETS = Object.freeze({
  aurora: "bar",
  scanline: "block",
  manga: "underline",
  plasma: "outline"
});

const CODE_SHADER_PRESETS = new Set(["bar", "block", "underline", "outline"]);
const CODE_CURSOR_SHADERS = new Set([
  "blaze",
  "frozen",
  "rainbow",
  "lastletter",
  "sparks",
  "zoom",
  "shake",
  "border"
]);

function normalizeColor(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  // aceita #rgb, #rrggbb, rgb(...) e rgba(...)
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return text;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

function normalizeCodeShaderPreset(value, fallback = "bar") {
  const raw = String(value || "").toLowerCase();
  const preset = LEGACY_CODE_SHADER_PRESETS[raw] || raw;
  return CODE_SHADER_PRESETS.has(preset) ? preset : fallback;
}

function normalizeTheme(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    preset: String(src.preset || DEFAULT_THEME.preset),
    accent: normalizeColor(src.accent, DEFAULT_THEME.accent),
    accentHi: normalizeColor(src.accentHi, DEFAULT_THEME.accentHi),
    stopA: normalizeColor(src.stopA, DEFAULT_THEME.stopA),
    stopB: normalizeColor(src.stopB, DEFAULT_THEME.stopB),
    stopC: normalizeColor(src.stopC, DEFAULT_THEME.stopC),
    stopD: normalizeColor(src.stopD, DEFAULT_THEME.stopD),
    stopE: normalizeColor(src.stopE, DEFAULT_THEME.stopE),
    base: normalizeColor(src.base, DEFAULT_THEME.base),
    tint: normalizeColor(src.tint, DEFAULT_THEME.tint),
    blur: normalizeNumber(src.blur, DEFAULT_THEME.blur, 0, 400),
    blurBackground: normalizeNumber(src.blurBackground, src.blur ?? DEFAULT_THEME.blurBackground, 0, 400),
    blurSidebar: normalizeNumber(src.blurSidebar, src.blur ?? DEFAULT_THEME.blurSidebar, 0, 400),
    blurTopbar: normalizeNumber(src.blurTopbar, src.blur ?? DEFAULT_THEME.blurTopbar, 0, 400),
    blurComposer: normalizeNumber(src.blurComposer, src.blur ?? DEFAULT_THEME.blurComposer, 0, 400)
  };
}

function normalizeAction(action) {
  if (!action || typeof action !== "object") {
    return null;
  }

  const normalized = { ...action };
  if (!normalized.type && normalized.name) {
    normalized.type = normalized.name;
  }

  if (normalized.type) {
    normalized.type = String(normalized.type);
  }

  return normalized;
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  return {
    id: attachment.id ? String(attachment.id) : `att-${crypto.randomUUID()}`,
    type: String(attachment.type || "file"),
    filename: String(attachment.filename || attachment.name || "arquivo"),
    url: attachment.url ? String(attachment.url) : null,
    contentType: attachment.contentType
      ? String(attachment.contentType)
      : attachment.content_type
        ? String(attachment.content_type)
        : null,
    path: attachment.path ? String(attachment.path) : null,
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null
  };
}

function normalizeMessage(message) {
  return {
    id: String(message?.id || `msg-${crypto.randomUUID()}`),
    kind: String(message?.kind || "system"),
    content: String(message?.content || ""),
    timestamp: Number(message?.timestamp || Date.now()),
    status: message?.status ? String(message.status) : null,
    brief: message?.brief ? String(message.brief) : null,
    description: message?.description ? String(message.description) : null,
    waiting: message?.waiting || null,
    pending: Boolean(message?.pending),
    hidden: Boolean(message?.hidden),
    actions: Array.isArray(message?.actions)
      ? message.actions.map(normalizeAction).filter(Boolean)
      : [],
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.map(normalizeAttachment).filter(Boolean)
      : []
  };
}

function normalizeLocalEvent(event) {
  return {
    id: String(event?.id || `local-${crypto.randomUUID()}`),
    kind: "local_action",
    content: String(event?.content || ""),
    timestamp: Number(event?.timestamp || Date.now()),
    actionKey: event?.actionKey ? String(event.actionKey) : null,
    action: normalizeAction(event?.action),
    ok: typeof event?.ok === "boolean" ? event.ok : null,
    result: event?.result ? String(event.result) : null,
    permissionClass: event?.permissionClass ? String(event.permissionClass) : null
  };
}

function normalizeTodo(todo) {
  return {
    id: String(todo?.id || `todo-${crypto.randomUUID()}`),
    text: String(todo?.text || todo?.content || ""),
    status: ["pending", "in_progress", "done", "blocked"].includes(String(todo?.status || "pending"))
      ? String(todo?.status || "pending")
      : "pending",
    priority: ["low", "medium", "high"].includes(String(todo?.priority || "medium"))
      ? String(todo?.priority || "medium")
      : "medium",
    createdAt: Number(todo?.createdAt || Date.now()),
    updatedAt: Number(todo?.updatedAt || Date.now())
  };
}

const TASK_LOG_PHASES = ["planning", "coding", "validation"];

function defaultExecutionProgress(status = "backlog") {
  const normalized = String(status || "backlog");
  const phase =
    normalized === "planning" || normalized === "plan_review"
      ? "planning"
      : normalized === "coding" || normalized === "in_progress"
        ? "coding"
        : normalized === "ai_review" || normalized === "qa_review"
      ? "qa_review"
      : normalized === "qa_fixing"
        ? "qa_fixing"
      : normalized === "human_review"
        ? "complete"
        : normalized === "done" || normalized === "pr_created" || normalized === "archived"
          ? "complete"
          : normalized === "error"
            ? "failed"
            : "idle";
  const overallProgress = {
    backlog: 0,
    queue: 10,
    planning: 25,
    plan_review: 38,
    coding: 45,
    in_progress: 45,
    qa_review: 78,
    qa_fixing: 74,
    ai_review: 82,
    human_review: 92,
    creating_pr: 96,
    pr_created: 98,
    done: 100,
    archived: 100,
    error: 0
  }[normalized] ?? 0;
  return {
    phase,
    phaseProgress: overallProgress,
    overallProgress,
    currentSubtask: "",
    message: "",
    startedAt: null,
    sequenceNumber: 0,
    completedPhases: []
  };
}

function normalizeExecutionProgress(progress, status) {
  const base = defaultExecutionProgress(status);
  const value = progress && typeof progress === "object" ? progress : {};
  return {
    phase: String(value.phase || base.phase),
    phaseProgress: Math.max(0, Math.min(100, Number(value.phaseProgress ?? base.phaseProgress) || 0)),
    overallProgress: Math.max(0, Math.min(100, Number(value.overallProgress ?? base.overallProgress) || 0)),
    currentSubtask: value.currentSubtask ? String(value.currentSubtask) : "",
    message: value.message ? String(value.message) : "",
    startedAt: value.startedAt ? Number(value.startedAt) || null : base.startedAt,
    sequenceNumber: Math.max(0, Number(value.sequenceNumber ?? base.sequenceNumber) || 0),
    completedPhases: Array.isArray(value.completedPhases)
      ? value.completedPhases.map((entry) => String(entry)).slice(-12)
      : []
  };
}

function normalizeTaskLogs(logs) {
  const source = logs && typeof logs === "object" ? logs : {};
  const normalized = {};
  for (const phase of TASK_LOG_PHASES) {
    normalized[phase] = Array.isArray(source[phase])
      ? source[phase].slice(-120).map((entry) => ({
          timestamp: Number(entry?.timestamp || Date.now()),
          type: String(entry?.type || "info"),
          content: String(entry?.content || ""),
          phase,
          detail: entry?.detail ? String(entry.detail) : "",
          tool: entry?.tool ? String(entry.tool) : ""
        }))
      : [];
  }
  return normalized;
}

function normalizeTask(task) {
  const status = String(task?.status || "pending");
  const statusAliases = {
    pending: "backlog",
    running: "in_progress",
    blocked: "human_review",
    stopped: "human_review"
  };
  const allowedStatuses = [
    "backlog",
    "queue",
    "planning",
    "plan_review",
    "coding",
    "in_progress",
    "qa_review",
    "qa_fixing",
    "ai_review",
    "human_review",
    "creating_pr",
    "done",
    "pr_created",
    "archived",
    "error"
  ];
  const normalizedStatus = statusAliases[status] || status;
  return {
    id: String(task?.id || `task-${crypto.randomUUID()}`),
    title: String(task?.title || "Untitled task"),
    objective: String(task?.objective || ""),
    status: allowedStatuses.includes(normalizedStatus)
      ? normalizedStatus
      : "backlog",
    routeId: task?.routeId ? String(task.routeId) : null,
    agentId: task?.agentId ? String(task.agentId) : null,
    terminalSessionId: task?.terminalSessionId ? String(task.terminalSessionId) : null,
    workspaceRoot: task?.workspaceRoot ? String(task.workspaceRoot) : null,
    worktreePath: task?.worktreePath ? String(task.worktreePath) : null,
    worktreeBranch: task?.worktreeBranch ? String(task.worktreeBranch) : null,
    assignee: task?.assignee ? String(task.assignee) : "",
    tenant: task?.tenant ? String(task.tenant) : "",
    priority: Number.isFinite(Number(task?.priority)) ? Number(task.priority) : 0,
    maxRuntimeSeconds: Number.isFinite(Number(task?.maxRuntimeSeconds)) ? Number(task.maxRuntimeSeconds) : null,
    skills: Array.isArray(task?.skills) ? task.skills.map((entry) => String(entry || "")).filter(Boolean) : [],
    comments: Array.isArray(task?.comments)
      ? task.comments.slice(-200).map((entry) => ({
          id: String(entry?.id || `comment-${crypto.randomUUID()}`),
          author: String(entry?.author || "dashboard"),
          body: String(entry?.body || ""),
          createdAt: Number(entry?.createdAt || Date.now())
        })).filter((entry) => entry.body)
      : [],
    links: {
      parents: Array.isArray(task?.links?.parents) ? task.links.parents.map((entry) => String(entry || "")).filter(Boolean) : [],
      children: Array.isArray(task?.links?.children) ? task.links.children.map((entry) => String(entry || "")).filter(Boolean) : []
    },
    reviewReason: task?.reviewReason ? String(task.reviewReason) : null,
    prUrl: task?.prUrl ? String(task.prUrl) : "",
    prState: task?.prState ? String(task.prState) : "",
    cleanupState: task?.cleanupState ? String(task.cleanupState) : "",
    lastActivityAt: Number(task?.lastActivityAt || task?.updatedAt || Date.now()),
    stuckAt: task?.stuckAt ? Number(task.stuckAt) || null : null,
    executionProgress: normalizeExecutionProgress(task?.executionProgress, normalizedStatus),
    logs: normalizeTaskLogs(task?.logs || task?.taskLogs),
    createdAt: Number(task?.createdAt || Date.now()),
    updatedAt: Number(task?.updatedAt || Date.now()),
    result: task?.result ? String(task.result) : ""
  };
}

function normalizeAgent(agent) {
  return {
    id: String(agent?.id || `agent-${crypto.randomUUID()}`),
    name: String(agent?.name || "Agent"),
    objective: String(agent?.objective || ""),
    status: ["pending", "running", "done", "blocked", "stopped", "error"].includes(String(agent?.status || "pending"))
      ? String(agent?.status || "pending")
      : "pending",
    provider: String(agent?.provider || DEFAULT_PROVIDER_MODE),
    routeId: agent?.routeId ? String(agent.routeId) : null,
    chatId: agent?.chatId ? String(agent.chatId) : null,
    taskId: agent?.taskId ? String(agent.taskId) : null,
    workspaceRoot: agent?.workspaceRoot ? String(agent.workspaceRoot) : null,
    worktreePath: agent?.worktreePath ? String(agent.worktreePath) : null,
    worktreeBranch: agent?.worktreeBranch ? String(agent.worktreeBranch) : null,
    summary: agent?.summary ? String(agent.summary) : "",
    createdAt: Number(agent?.createdAt || Date.now()),
    updatedAt: Number(agent?.updatedAt || Date.now())
  };
}

function normalizeProject(project) {
  return {
    id: String(project?.id || project?.slug || `project-${crypto.randomUUID()}`),
    name: String(project?.name || "Projeto"),
    slug: String(project?.slug || project?.id || "project"),
    kind: String(project?.kind || "generic"),
    path: project?.path ? String(project.path) : null,
    url: project?.url ? String(project.url) : "",
    port: Number.isFinite(Number(project?.port)) ? Number(project.port) : null,
    job: project?.job ? String(project.job) : "",
    chatId: project?.chatId ? String(project.chatId) : null,
    runId: project?.runId ? String(project.runId) : null,
    lastObjective: project?.lastObjective ? String(project.lastObjective) : "",
    expectedFiles: Array.isArray(project?.expectedFiles)
      ? project.expectedFiles.map((entry) => String(entry || "")).filter(Boolean)
      : [],
    status: ["created", "starting", "running", "verified", "blocked", "stopped"].includes(String(project?.status || "created"))
      ? String(project?.status || "created")
      : "created",
    createdAt: Number(project?.createdAt || Date.now()),
    updatedAt: Number(project?.updatedAt || Date.now()),
    lastVerifiedAt: Number(project?.lastVerifiedAt || 0),
    lastError: project?.lastError ? String(project.lastError) : ""
  };
}

function normalizeChat(chat) {
  return {
    id: String(chat?.id || crypto.randomUUID()),
    title: String(chat?.title || "Nova sessao"),
    provider: String(chat?.provider || DEFAULT_PROVIDER_MODE),
    workspaceRoot: chat?.workspaceRoot ? String(chat.workspaceRoot) : null,
    activeRoute: chat?.activeRoute
      ? {
          id: String(chat.activeRoute.id || "general-purpose"),
          label: String(chat.activeRoute.label || "General"),
          prompt: chat.activeRoute.prompt ? String(chat.activeRoute.prompt) : null
        }
      : null,
    taskId: chat?.taskId ? String(chat.taskId) : null,
    taskUrl: chat?.taskUrl ? String(chat.taskUrl) : null,
    hiddenInSidebar: Boolean(chat?.hiddenInSidebar),
    status: String(chat?.status || "idle"),
    createdAt: Number(chat?.createdAt || Date.now()),
    updatedAt: Number(chat?.updatedAt || Date.now()),
    messages: Array.isArray(chat?.messages) ? chat.messages.map(normalizeMessage) : [],
    localEvents: Array.isArray(chat?.localEvents) ? chat.localEvents.map(normalizeLocalEvent) : []
  };
}

function normalizeState(state) {
  const base = createDefaultState();
  const normalized = {
    settings: {
      ...base.settings,
      ...(state?.settings || {})
    },
    todos: Array.isArray(state?.todos) ? state.todos.map(normalizeTodo) : [],
    tasks: Array.isArray(state?.tasks) ? state.tasks.map(normalizeTask) : [],
    agents: Array.isArray(state?.agents) ? state.agents.map(normalizeAgent) : [],
    projects: Array.isArray(state?.projects) ? state.projects.map(normalizeProject) : [],
    chats: Array.isArray(state?.chats) ? state.chats.map(normalizeChat) : [],
    selectedChatId: state?.selectedChatId || null
  };

  normalized.settings.connectorIds = normalizeStringArray(normalized.settings.connectorIds);
  normalized.settings.enableSkillIds = normalizeStringArray(normalized.settings.enableSkillIds);
  normalized.settings.forceSkillIds = normalizeStringArray(normalized.settings.forceSkillIds);
  normalized.settings.allowedPermissionClasses = normalizeStringArray(
    normalized.settings.allowedPermissionClasses
  );
  normalized.settings.locale = normalizeLocale(normalized.settings.locale) || defaultLocale();
  normalized.settings.interactiveMode = Boolean(normalized.settings.interactiveMode);
  normalized.settings.hermesDesktopIntegrationEnabled = normalized.settings.hermesDesktopIntegrationEnabled !== false;
  normalized.settings.desktopBridgeEnabled = Boolean(normalized.settings.desktopBridgeEnabled);
  normalized.settings.fullAccessMode = Boolean(normalized.settings.fullAccessMode);
  normalized.settings.autoRunLocalActions = Boolean(normalized.settings.autoRunLocalActions);
  normalized.settings.agentBackend = "hermes";
  normalized.settings.localBaseUrl =
    String(normalized.settings.localBaseUrl || DEFAULT_LOCAL_BASE_URL).trim() ||
    DEFAULT_LOCAL_BASE_URL;
  normalized.settings.localModel =
    String(normalized.settings.localModel || DEFAULT_LOCAL_MODEL).trim() || DEFAULT_LOCAL_MODEL;
  normalized.settings.localApiKey =
    String(normalized.settings.localApiKey || "not-needed").trim() || "not-needed";
  normalized.settings.hermesProvider =
    String(normalized.settings.hermesProvider || "custom").trim().toLowerCase() || "custom";
  const providerAliases = {
    local: "custom",
    external: "custom",
    "openai-compatible": "custom",
    ollama: "custom",
    "lm-studio": "custom",
    lm_studio: "custom",
    vllm: "custom",
    llamacpp: "custom",
    "llama.cpp": "custom",
    "llama-cpp": "custom",
    google: "gemini",
    "google-gemini": "gemini",
    "google-ai-studio": "gemini",
    claude: "anthropic",
    "claude-code": "anthropic",
    chatgpt: "openai",
    gpt: "openai",
    openai_codex: "openai-codex",
    kimi: "kimi-coding",
    moonshot: "kimi-coding",
    "kimi-for-coding": "kimi-coding",
    "kimi-cn": "kimi-coding-cn",
    kimi_cn: "kimi-coding-cn",
    "moonshot-cn": "kimi-coding-cn",
    "x-ai": "xai",
    "x.ai": "xai",
    grok: "xai",
    "z-ai": "zai",
    "z.ai": "zai",
    zhipu: "zai",
    nvidia_nim: "nvidia",
    "nvidia-nim": "nvidia",
    github: "copilot",
    copilot_acp: "copilot-acp",
    "github-copilot": "copilot",
    "github-models": "copilot",
    "github-model": "copilot",
    "github-copilot-acp": "copilot-acp",
    "copilot-acp-agent": "copilot-acp",
    hf: "huggingface",
    "hugging-face": "huggingface",
    "huggingface-hub": "huggingface",
    "arcee-ai": "arcee",
    arceeai: "arcee",
    "minimax-china": "minimax-cn",
    minimax_cn: "minimax-cn",
    glm: "zai",
    qwen: "qwen-oauth",
    "qwen-portal": "qwen-oauth",
    "qwen-cli": "qwen-oauth",
    "gemini-cli": "google-gemini-cli",
    "gemini-oauth": "google-gemini-cli",
    aigateway: "ai-gateway",
    vercel: "ai-gateway",
    "vercel-ai-gateway": "ai-gateway",
    opencode: "opencode-zen",
    zen: "opencode-zen",
    go: "opencode-go",
    "opencode-go-sub": "opencode-go",
    mimo: "xiaomi",
    "xiaomi-mimo": "xiaomi",
    aws: "bedrock",
    "aws-bedrock": "bedrock",
    "amazon-bedrock": "bedrock",
    amazon: "bedrock",
    kilo: "kilocode",
    "kilo-code": "kilocode",
    "kilo-gateway": "kilocode",
    ollama_cloud: "ollama-cloud"
  };
  normalized.settings.hermesProvider =
    providerAliases[normalized.settings.hermesProvider] || normalized.settings.hermesProvider;
  normalized.settings.providerMode = normalized.settings.hermesProvider === "manus" ? "cloud" : "local";
  normalized.settings.hermesApiMode = [
    "auto",
    "chat_completions",
    "codex_responses",
    "anthropic_messages",
    "bedrock_converse"
  ].includes(String(normalized.settings.hermesApiMode || "").toLowerCase())
    ? String(normalized.settings.hermesApiMode || "").toLowerCase()
    : "auto";
  normalized.settings.hermesProvidersAllowed = normalizeStringArray(normalized.settings.hermesProvidersAllowed);
  normalized.settings.hermesProvidersIgnored = normalizeStringArray(normalized.settings.hermesProvidersIgnored);
  normalized.settings.hermesProvidersOrder = normalizeStringArray(normalized.settings.hermesProvidersOrder);
  normalized.settings.hermesProviderSort = ["", "price", "throughput", "latency"].includes(
    String(normalized.settings.hermesProviderSort || "").toLowerCase()
  )
    ? String(normalized.settings.hermesProviderSort || "").toLowerCase()
    : "";
  normalized.settings.hermesProviderRequireParameters = Boolean(
    normalized.settings.hermesProviderRequireParameters
  );
  normalized.settings.hermesProviderDataCollection =
    String(normalized.settings.hermesProviderDataCollection || "").trim();
  normalized.settings.localLlamaEnabled = Boolean(normalized.settings.localLlamaEnabled);
  normalized.settings.localLlamaAutoStart = Boolean(normalized.settings.localLlamaAutoStart);
  if (!bundledLocalLlamaRuntimeAvailable()) {
    normalized.settings.localLlamaEnabled = false;
    normalized.settings.localLlamaAutoStart = false;
  }
  normalized.settings.localLlamaHost =
    String(normalized.settings.localLlamaHost || DEFAULT_LOCAL_HOST).trim() || DEFAULT_LOCAL_HOST;
  normalized.settings.localLlamaPort = normalizeNumber(
    normalized.settings.localLlamaPort,
    DEFAULT_LOCAL_LLAMA_PORT,
    1024,
    65535
  );
  normalized.settings.localLlamaModelDir =
    expandEnvPath(normalized.settings.localLlamaModelDir || DEFAULT_LOCAL_LLAMA_MODEL_DIR) ||
    DEFAULT_LOCAL_LLAMA_MODEL_DIR;
  normalized.settings.localLlamaModelPath =
    expandEnvPath(normalized.settings.localLlamaModelPath || "");
  normalized.settings.localLlamaContextSize = normalizeNumber(
    normalized.settings.localLlamaContextSize,
    16384,
    512,
    262144
  );
  normalized.settings.localLlamaGpuLayers = normalizeNumber(
    normalized.settings.localLlamaGpuLayers,
    999,
    0,
    999
  );
  normalized.settings.localLlamaBatchSize = normalizeNumber(
    normalized.settings.localLlamaBatchSize,
    1024,
    1,
    8192
  );
  normalized.settings.localLlamaStartupTimeoutMs = normalizeNumber(
    normalized.settings.localLlamaStartupTimeoutMs,
    180000,
    10000,
    600000
  );
  normalized.settings.hermesMaxIterations = Number.isFinite(Number(normalized.settings.hermesMaxIterations))
    ? Math.max(1, Math.min(90, Number(normalized.settings.hermesMaxIterations)))
    : 16;
  normalized.settings.hermesMaxTokens = Number.isFinite(Number(normalized.settings.hermesMaxTokens))
    ? Math.max(512, Math.min(16384, Number(normalized.settings.hermesMaxTokens)))
    : 8192;
  if (normalized.settings.hermesMaxTokens < 4096) {
    normalized.settings.hermesMaxTokens = 8192;
  }
  normalized.settings.hermesToolsets = normalizeStringArray(normalized.settings.hermesToolsets);
  normalized.settings.hermesDoctorTimeoutMs = normalizeNumber(
    normalized.settings.hermesDoctorTimeoutMs,
    60000,
    10000,
    300000
  );
  normalized.settings.gatewayEnabled = Boolean(normalized.settings.gatewayEnabled);
  normalized.settings.gatewayAutoStart = Boolean(normalized.settings.gatewayAutoStart);
  normalized.settings.gatewayDoctorTimeoutMs = normalizeNumber(
    normalized.settings.gatewayDoctorTimeoutMs,
    normalized.settings.hermesDoctorTimeoutMs,
    10000,
    300000
  );
  normalized.settings.gatewayPlatforms = normalizeGatewayPlatforms(normalized.settings.gatewayPlatforms);
  normalized.settings.kanbanGitEnabled = Boolean(normalized.settings.kanbanGitEnabled);
  normalized.settings.kanbanAutoSchedulerEnabled = normalized.settings.kanbanAutoSchedulerEnabled !== false;
  normalized.settings.kanbanAutoRecoverEnabled = normalized.settings.kanbanAutoRecoverEnabled !== false;
  normalized.settings.kanbanAutoCleanupEnabled = normalized.settings.kanbanAutoCleanupEnabled !== false;
  normalized.settings.kanbanAutoPrEnabled = Boolean(normalized.settings.kanbanAutoPrEnabled);
  normalized.settings.kanbanMultiAgentOrchestrationEnabled = Boolean(
    normalized.settings.kanbanMultiAgentOrchestrationEnabled
  );
  normalized.settings.kanbanMaxParallelAgents = normalizeNumber(
    normalized.settings.kanbanMaxParallelAgents,
    3,
    1,
    12
  );
  normalized.settings.kanbanSchedulerIntervalMs = normalizeNumber(
    normalized.settings.kanbanSchedulerIntervalMs,
    2500,
    900,
    30000
  );
  normalized.settings.backgroundMediaPath = String(normalized.settings.backgroundMediaPath || "").trim();
  normalized.settings.dreamPetEnabled = normalized.settings.dreamPetEnabled === true;
  normalized.settings.dreamPetBubbleEnabled = normalized.settings.dreamPetBubbleEnabled !== false;
  normalized.settings.dreamPetVoiceEnabled = normalized.settings.dreamPetVoiceEnabled === true;
  normalized.settings.dreamPetVoiceName = String(normalized.settings.dreamPetVoiceName || "").trim();
  normalized.settings.dreamPetWindowBounds =
    normalized.settings.dreamPetWindowBounds && typeof normalized.settings.dreamPetWindowBounds === "object"
      ? {
          x: normalizeNumber(normalized.settings.dreamPetWindowBounds.x, 0, -100000, 100000),
          y: normalizeNumber(normalized.settings.dreamPetWindowBounds.y, 0, -100000, 100000),
          width: normalizeNumber(normalized.settings.dreamPetWindowBounds.width, 230, 180, 320),
          height: normalizeNumber(normalized.settings.dreamPetWindowBounds.height, 274, 220, 360)
        }
      : null;
  normalized.settings.trustMode = ["ask", "session", "always"].includes(
    String(normalized.settings.trustMode || "ask").toLowerCase()
  )
    ? String(normalized.settings.trustMode || "ask").toLowerCase()
    : "ask";
  normalized.settings.theme = normalizeTheme(normalized.settings.theme);
  normalized.settings.codeShaderEnabled = normalized.settings.codeShaderEnabled !== false;
  normalized.settings.codeShaderPreset = normalizeCodeShaderPreset(normalized.settings.codeShaderPreset);
  normalized.settings.codeCursorShader = CODE_CURSOR_SHADERS.has(
    String(normalized.settings.codeCursorShader || "").toLowerCase()
  )
    ? String(normalized.settings.codeCursorShader).toLowerCase()
    : "blaze";
  normalized.settings.codeShaderIntensity = normalizeNumber(
    normalized.settings.codeShaderIntensity,
    100,
    0,
    100
  );
  normalized.chats.sort((left, right) => right.updatedAt - left.updatedAt);
  normalized.todos.sort((left, right) => right.updatedAt - left.updatedAt);
  normalized.tasks.sort((left, right) => right.updatedAt - left.updatedAt);
  normalized.agents.sort((left, right) => right.updatedAt - left.updatedAt);
  normalized.projects.sort((left, right) => right.updatedAt - left.updatedAt);

  const selectedExists = normalized.chats.some((chat) => chat.id === normalized.selectedChatId);
  if (!selectedExists) {
    normalized.selectedChatId = normalized.chats[0]?.id || null;
  }

  return normalized;
}

function getPublicState(state, extras = {}) {
  const normalized = normalizeState(state);
  return {
    settings: normalized.settings,
    todos: normalized.todos,
    tasks: normalized.tasks,
    agents: normalized.agents,
    projects: normalized.projects,
    chats: normalized.chats,
    selectedChatId: normalized.selectedChatId,
    hasCloudApiKey: Boolean(extras.hasCloudApiKey),
    supportedApps: Array.isArray(extras.supportedApps) ? extras.supportedApps : [],
    supportedTools: Array.isArray(extras.supportedTools) ? extras.supportedTools : [],
    profiles: Array.isArray(extras.profiles) ? extras.profiles : [],
    terminalSessions: Array.isArray(extras.terminalSessions) ? extras.terminalSessions : [],
    backgroundProcesses: Array.isArray(extras.backgroundProcesses) ? extras.backgroundProcesses : [],
    routingCatalog: extras.routingCatalog ? String(extras.routingCatalog) : "",
    hermesCatalog: extras.hermesCatalog && typeof extras.hermesCatalog === "object"
      ? extras.hermesCatalog
      : { commands: [], skills: [], gateways: [], counts: { commands: 0, skills: 0, gateways: 0 } },
    gateway: extras.gateway && typeof extras.gateway === "object"
      ? extras.gateway
      : { enabled: false, autoStart: false, running: false, pid: null, platforms: [], configuredCount: 0, enabledCount: 0 },
    mcpState: extras.mcpState && typeof extras.mcpState === "object" ? extras.mcpState : { configured: [], connected: [] },
    hostInfo: extras.hostInfo && typeof extras.hostInfo === "object"
      ? extras.hostInfo
      : {
          platform: process.platform,
          platformLabel: process.platform,
          arch: process.arch,
          release: "",
          locale: normalized.settings.locale,
          isWsl: false,
          managedLlamaAvailable: bundledLocalLlamaRuntimeAvailable(),
          managedLlamaBinaryPath: "",
          defaultShell: "",
          defaultShellLabel: ""
        },
    localLlamaState: extras.localLlamaState && typeof extras.localLlamaState === "object"
      ? extras.localLlamaState
      : { status: "idle", pid: null, baseUrl: "", model: "", modelPath: "", lastError: "", logs: [] },
    lspState: extras.lspState && typeof extras.lspState === "object"
      ? extras.lspState
      : { available: false, engine: "none", projects: [], externalServers: [], activeClients: [], lastError: null }
  };
}

module.exports = {
  DEFAULT_PROVIDER_MODE,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_HOST,
  DEFAULT_LOCAL_LLAMA_MODEL_DIR,
  DEFAULT_LOCAL_LLAMA_PORT,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_THEME,
  bundledLocalLlamaRuntimeAvailable,
  createDefaultState,
  getPublicState,
  normalizeAttachment,
  normalizeAgent,
  normalizeChat,
  normalizeLocalEvent,
  normalizeMessage,
  normalizeProject,
  normalizeTask,
  normalizeTodo,
  normalizeState,
  normalizeStringArray,
  normalizeGatewayPlatforms,
  normalizeCodeShaderPreset,
  normalizeTheme
};
