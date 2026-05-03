const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { DEFAULT_LOCAL_BASE_URL, DEFAULT_LOCAL_MODEL } = require("../state");
const {
  FALLBACK_TOOL_PROMPT,
  clampNumber,
  expandPathInput,
  extractActionsFromAssistant,
  getOpenAIToolSchemas,
  truncateText
} = require("../tools");

const DEFAULT_LOCAL_CHAT_TIMEOUT_MS = 90000;
const DEFAULT_LOCAL_META_TIMEOUT_MS = 15000;
const DEFAULT_LOCAL_MAX_TOKENS = 4096;
const LOCAL_BASE_URL_FALLBACKS = [
  DEFAULT_LOCAL_BASE_URL,
  "http://localhost:11434/v1",
  "http://localhost:8080/v1",
  "http://localhost:4000/v1"
];

const localTokenTelemetry = {
  sampledAt: 0,
  model: "",
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  tokensPerSecond: null,
  durationMs: null,
  source: ""
};
const LOCAL_TOKEN_STREAM_WINDOW_MS = 2500;
let localTokenStream = null;

function finiteUsageNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function usageField(usage = {}, ...keys) {
  for (const key of keys) {
    const value = finiteUsageNumber(usage?.[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function roundLocalTelemetry(value, precision = 1) {
  const numeric = finiteUsageNumber(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function estimateGeneratedTokenCount(text = "") {
  const source = String(text || "");
  if (!source) {
    return 0;
  }
  const compactLength = source.replace(/\s+/g, " ").trim().length;
  const charEstimate = Math.ceil(Math.max(source.length, compactLength) / 4);
  const pieceMatches = source.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
  const pieceEstimate = Math.ceil(pieceMatches.length * 0.75);
  return Math.max(1, charEstimate, pieceEstimate);
}

function resetLocalTokenStream(model = "") {
  const now = Date.now();
  localTokenStream = {
    startedAt: now,
    updatedAt: now,
    model: String(model || "").trim(),
    totalTokens: 0,
    samples: [{ sampledAt: now, tokens: 0 }]
  };
  localTokenTelemetry.sampledAt = now;
  localTokenTelemetry.model = localTokenStream.model || localTokenTelemetry.model || "";
  localTokenTelemetry.promptTokens = null;
  localTokenTelemetry.completionTokens = 0;
  localTokenTelemetry.totalTokens = 0;
  localTokenTelemetry.tokensPerSecond = 0;
  localTokenTelemetry.durationMs = 0;
  localTokenTelemetry.source = "stream_delta";
}

function recordLocalTokenDelta(delta = "", options = {}) {
  const tokenCount = estimateGeneratedTokenCount(delta);
  if (!tokenCount) {
    return;
  }
  const now = Date.now();
  const model = String(options.model || "").trim();
  if (!localTokenStream) {
    resetLocalTokenStream(model);
  } else if (model && !localTokenStream.model) {
    localTokenStream.model = model;
  }

  localTokenStream.updatedAt = now;
  localTokenStream.totalTokens += tokenCount;
  localTokenStream.samples.push({
    sampledAt: now,
    tokens: localTokenStream.totalTokens
  });
  while (
    localTokenStream.samples.length > 1 &&
    now - localTokenStream.samples[0].sampledAt > LOCAL_TOKEN_STREAM_WINDOW_MS
  ) {
    localTokenStream.samples.shift();
  }

  const firstSample = localTokenStream.samples[0] || { sampledAt: localTokenStream.startedAt, tokens: 0 };
  const windowSeconds = Math.max(0.001, (now - firstSample.sampledAt) / 1000);
  const windowTokens = Math.max(0, localTokenStream.totalTokens - firstSample.tokens);
  const averageSeconds = Math.max(0.001, (now - localTokenStream.startedAt) / 1000);
  const averageTps = localTokenStream.totalTokens / averageSeconds;
  const tps = windowTokens > 0 ? windowTokens / windowSeconds : averageTps;

  localTokenTelemetry.sampledAt = now;
  localTokenTelemetry.model = localTokenStream.model || localTokenTelemetry.model || "";
  localTokenTelemetry.completionTokens = localTokenStream.totalTokens;
  localTokenTelemetry.totalTokens = localTokenStream.totalTokens;
  localTokenTelemetry.tokensPerSecond = roundLocalTelemetry(tps, 1);
  localTokenTelemetry.durationMs = now - localTokenStream.startedAt;
  localTokenTelemetry.source = "stream_delta";
}

function finalizeLocalTokenStream(options = {}) {
  if (!localTokenStream) {
    return;
  }
  const endedAt = finiteUsageNumber(options.endedAt) || Date.now();
  localTokenTelemetry.sampledAt = endedAt;
  localTokenTelemetry.model = String(options.model || localTokenStream.model || localTokenTelemetry.model || "").trim();
  localTokenTelemetry.durationMs = Math.max(0, endedAt - localTokenStream.startedAt);
  localTokenTelemetry.source = localTokenTelemetry.source === "openai_usage" ? "openai_usage" : "stream_delta_final";
  localTokenStream = null;
}

function recordLocalTokenUsage(usage = null, options = {}) {
  if (!usage || typeof usage !== "object") {
    return;
  }
  const promptTokens = usageField(usage, "prompt_tokens", "promptTokens");
  const completionTokens = usageField(usage, "completion_tokens", "completionTokens");
  const totalTokens = usageField(usage, "total_tokens", "totalTokens");
  const startedAt = finiteUsageNumber(options.startedAt);
  const endedAt = finiteUsageNumber(options.endedAt) || Date.now();
  const durationMs = startedAt !== null ? Math.max(0, endedAt - startedAt) : null;
  const tokensPerSecond =
    completionTokens !== null && durationMs && durationMs > 0
      ? Math.round((completionTokens / (durationMs / 1000)) * 10) / 10
      : null;

  localTokenTelemetry.sampledAt = Date.now();
  localTokenTelemetry.model = String(options.model || usage.model || localTokenTelemetry.model || "").trim();
  localTokenTelemetry.promptTokens = promptTokens;
  localTokenTelemetry.completionTokens = completionTokens;
  localTokenTelemetry.totalTokens = totalTokens;
  localTokenTelemetry.tokensPerSecond = tokensPerSecond;
  localTokenTelemetry.durationMs = durationMs;
  localTokenTelemetry.source = "openai_usage";
}

function getLocalTokenTelemetry() {
  return { ...localTokenTelemetry };
}

function normalizeLocalBaseUrl(rawUrl) {
  const source = String(rawUrl || DEFAULT_LOCAL_BASE_URL).trim();
  if (!source) {
    return DEFAULT_LOCAL_BASE_URL;
  }

  let cleaned = source.replace(/#.*$/, "").replace(/\/+$/, "");
  if (!/\/v1$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\/chat(?:\/.*)?$/i, "");
    cleaned = cleaned.replace(/\/v1\/.*$/i, "/v1");
    if (!/\/v1$/i.test(cleaned)) {
      cleaned = `${cleaned}/v1`;
    }
  }

  return cleaned;
}

function isLikelyDockerContainer() {
  return Boolean(
    process.env.DREAM_CONTAINER === "1" ||
    process.env.DOCKER_CONTAINER === "1" ||
    fsSync.existsSync("/.dockerenv") ||
    String(process.env.HERMES_DATA_DIR || "").startsWith("/data/")
  );
}

function dockerHostBaseUrlForLocalhost(baseUrl) {
  if (!isLikelyDockerContainer()) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) {
      return "";
    }
    parsed.hostname = "host.docker.internal";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function requestBaseUrlForRuntime(baseUrl) {
  return dockerHostBaseUrlForLocalhost(baseUrl) || baseUrl;
}

function localProviderHeaders(settings) {
  const headers = {
    "Content-Type": "application/json"
  };
  const apiKey = String(settings.localApiKey || "not-needed").trim() || "not-needed";
  headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function createLinkedAbortController(signal) {
  const controller = new AbortController();
  if (!signal) {
    return { controller, detach: () => {} };
  }

  const abort = () => controller.abort();
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

  return {
    controller,
    detach: () => signal.removeEventListener("abort", abort)
  };
}

async function localProviderRequest(settings, endpoint, options = {}) {
  const baseUrl = normalizeLocalBaseUrl(settings.localBaseUrl);
  const requestBaseUrl = requestBaseUrlForRuntime(baseUrl);
  const timeoutMs = clampNumber(
    options.timeoutMs,
    1000,
    300000,
    endpoint.includes("chat/completions")
      ? DEFAULT_LOCAL_CHAT_TIMEOUT_MS
      : DEFAULT_LOCAL_META_TIMEOUT_MS
  );
  const { controller, detach } = createLinkedAbortController(options.signal);
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  let response;

  try {
    response = await fetch(`${requestBaseUrl}/${endpoint}`, {
      method: options.method || "GET",
      headers: {
        ...localProviderHeaders(settings),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError" && didTimeout) {
      throw new Error(
        `O Dream Server local demorou mais de ${Math.round(timeoutMs / 1000)}s para responder. Isso costuma acontecer quando o modelo ainda esta carregando ou a VRAM esta no limite.`
      );
    }
    throw error;
  } finally {
    detach();
  }

  clearTimeout(timer);

  if (options.expectStream) {
    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      const errorMessage =
        responseBody?.error?.message ||
        responseBody?.message ||
        `Dream Server local request failed with ${response.status}`;
      throw new Error(errorMessage);
    }
    return response;
  }

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      `Dream Server local request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  return responseBody;
}

function getLocalBaseUrlCandidates(settings) {
  const seen = new Set();
  return [settings?.localBaseUrl, ...LOCAL_BASE_URL_FALLBACKS]
    .map((entry) => normalizeLocalBaseUrl(entry))
    .filter((entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
}

async function probeLocalBaseUrl(baseUrl, settings, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestBaseUrl = requestBaseUrlForRuntime(baseUrl);

  try {
    const response = await fetch(`${requestBaseUrl}/models`, {
      method: "GET",
      headers: localProviderHeaders(settings),
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function ensureWorkingLocalBaseUrl(settings, options = {}) {
  const timeoutMs = clampNumber(options.timeoutMs, 500, 15000, 2500);
  const candidates = getLocalBaseUrlCandidates(settings);
  for (const candidate of candidates) {
    if (await probeLocalBaseUrl(candidate, settings, timeoutMs)) {
      settings.localBaseUrl = candidate;
      return candidate;
    }
  }
  return normalizeLocalBaseUrl(settings.localBaseUrl);
}

async function listLocalModels(settings) {
  await ensureWorkingLocalBaseUrl(settings, { timeoutMs: 2500 });
  const response = await localProviderRequest(settings, "models");
  return Array.isArray(response.data)
    ? response.data.map((entry) => ({
        id: entry.id,
        ownedBy: entry.owned_by || ""
      }))
    : [];
}

async function ensureWorkingLocalModel(settings) {
  const currentModel = String(settings.localModel || "").trim();
  const models = await listLocalModels(settings).catch(() => []);
  if (!models.length) {
    settings.localModel = currentModel || DEFAULT_LOCAL_MODEL;
    return settings.localModel;
  }

  if (currentModel && currentModel !== DEFAULT_LOCAL_MODEL && models.some((entry) => entry.id === currentModel)) {
    return currentModel;
  }

  if (currentModel === DEFAULT_LOCAL_MODEL && models.some((entry) => entry.id === DEFAULT_LOCAL_MODEL)) {
    return DEFAULT_LOCAL_MODEL;
  }

  settings.localModel = models[0].id;
  return settings.localModel;
}

function formatRecentLocalEvents(chat) {
  if (!Array.isArray(chat?.localEvents) || !chat.localEvents.length) {
    return "";
  }

  return chat.localEvents
    .slice(-6)
    .map((event) => `- ${event.content}`)
    .join("\n");
}

function formatMcpPrompt(mcpState) {
  const connected = Array.isArray(mcpState?.connected) ? mcpState.connected : [];
  if (!connected.length) {
    return "";
  }

  return [
    "Connected MCP servers:",
    ...connected.map((server) => `- ${server.name}: ${server.tools.join(", ") || "no tools cached yet"}`),
    "Use mcp_list_tools to inspect a server and mcp_call to invoke a server tool."
  ].join("\n");
}

function buildSystemPrompt(settings, route = null, mcpState = null) {
  const sections = [
    "You are Dream Server, a coding and desktop agent running inside a Windows shell.",
    "Prefer available tools for local actions, filesystem work, web search/fetch and commands.",
    "When the user asks for a direct local action that maps cleanly to one tool, call that tool immediately instead of asking what to do next.",
    "Do not rely on predefined site/project/topic templates. For coding or content generation, author the files from the user's actual request and the observed project state.",
    "When the user asks to build, create or update a frontend, web page, game, HTML/CSS/JS app or visual prototype, treat it as a local coding workflow: create or edit real files with tools, then open/verify the result in the Workbench preview. Do not answer only with a finished fenced code block.",
    "During coding workflows, prefer visible file operations over dumping source into chat so the Workbench Files and Code panels can show progress as the code is created.",
    "If your response claims that you are performing a local operation, call the matching tool in that same response. Do not return only a promise to act later.",
    "If the user asks only for code or an explanation, answer normally. If the request requires saving, running, previewing, opening, observing or modifying local state, use tools.",
    "Do not turn inspection questions into creation tasks. If the user asks to check/list/verify something, inspect it and report the result instead of scaffolding a new app.",
    "For multi-step project tasks, keep using tools until the task is actually runnable or blocked, then report the concrete result such as files created, commands executed and localhost URL.",
    "For web apps, completion requires verification: server alive, URL responding, expected files present, browser render not blank and no blocking console/build errors. Use verify_file, verify_url, verify_site, browser_check, browser_control or verify_browser_console before final answer.",
    "If verification fails, repair the exact failing file/command, rerun the failed step, verify again, and only then give the final result.",
    "For local web app work, choose the smallest appropriate tool sequence for the actual request. project_prepare_vite is available only when a Vite shell is genuinely useful; do not force Vite for every HTML/site request.",
    "Use terminal_open/terminal_exec/terminal_close for shell continuity when project_prepare_vite is not the right fit or when the task needs an interactive shell.",
    "Never stop at terminal_open alone when the task requires shell work. Open the session and immediately continue with terminal_exec or other concrete tools in the same turn.",
    "For questions about the local machine, prefer system_query or a concrete run_command/terminal_exec that returns the requested value immediately instead of merely opening a terminal window.",
    "Use adb_command, adb_shell and fastboot_command for Android device work instead of inventing unsupported helpers.",
    "Use set_volume for system audio changes instead of inventing PowerShell volume commands.",
    "Use media_control for play, pause, next, previous and stop music/media commands instead of opening Spotify, checking spotify:// or inventing unrelated APIs.",
    "Use system_query for concrete local information such as Wi-Fi password, SSID, local IP, hostname and Windows version when those map to the built-in query kinds.",
    "For public web research/search, use web_search/web_fetch first. Do not open the Workbench preview just to search, compare or summarize webpages.",
    "Use browser_control only when you need to interact with a page, capture a screenshot, read rendered text from a live page, test a local web app or inspect console/page errors.",
    "Use apply_patch with unified diff for precise code edits when possible. Use file_edit for small anchored edits, and write_file only when creating or intentionally replacing a whole file. If an edit is wrong, use file_rollback with the returned changeId.",
    "Use todo_write/task_* to keep persistent project state when work spans multiple steps.",
    "Use git_status, git_create_branch and git_worktree_* for repository workflow instead of vague git prose.",
    "Use lsp_document_symbols, lsp_workspace_symbols, lsp_definition, lsp_references, lsp_hover, lsp_code_actions, lsp_apply_code_action and lsp_rename for language-aware navigation and edits. JS/TS uses the built-in engine; other languages use external LSP servers when available in PATH.",
    "Use file_symbols and workspace_symbols only as fallback when the language engine is unavailable or the file type is unsupported.",
    "Use agent_spawn and agent_wait for bounded subproblems that can run in parallel chats, and prefer useWorktree=true for repository work when isolation matters.",
    "Do not repeat the same tool call after a successful result unless the user explicitly asked for another change.",
    "For self-contained desktop actions such as set_volume, media_control, launch_app, open_url, open_path and a single run_command, execute the tool once, report the result once and stop.",
    "Do not substitute approximate actions for a system change. If the exact requested local action is not available, say that explicitly instead of opening a related folder or settings page.",
    "When Runtime project memory lists a path or URL, use that exact path/URL for open_path, reveal_path, open_url, file and terminal actions. Never pass a natural-language reference as the path or URL.",
    "If native function calling is not available, fall back to the fenced dream-server-action blocks."
  ];

  if (settings.desktopBridgeEnabled) {
    sections.push(FALLBACK_TOOL_PROMPT);
  }

  if (route?.prompt) {
    sections.push(route.prompt);
  }

  const mcpPrompt = formatMcpPrompt(mcpState);
  if (mcpPrompt) {
    sections.push(mcpPrompt);
  }

  return sections.join("\n\n");
}

async function fileToDataUrl(filePath) {
  const absolutePath = expandPathInput(filePath);
  const bytes = await fs.readFile(absolutePath);
  const contentType = imageContentTypeForPath(absolutePath);

  if (!contentType) {
    return null;
  }

  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function imageContentTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp"
  })[ext];
}

function isImageAttachment(filePath) {
  return Boolean(imageContentTypeForPath(filePath));
}

function isTextAttachment(filePath) {
  return new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonc",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".scss",
    ".html",
    ".htm",
    ".xml",
    ".csv",
    ".log",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".ps1",
    ".bat",
    ".cmd",
    ".py",
    ".rs",
    ".go",
    ".lua"
  ]).has(path.extname(String(filePath || "")).toLowerCase());
}

async function fileToTextNote(filePath, options = {}) {
  const absolutePath = expandPathInput(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const stats = await fs.stat(absolutePath).catch(() => null);
  const size = stats?.size ? `${stats.size} bytes` : "tamanho desconhecido";

  if (isImageAttachment(absolutePath)) {
    return [
      `Imagem anexada: ${absolutePath} (${size})`,
      options.imageFallbackReason
        ? `Observacao: ${options.imageFallbackReason}`
        : "O arquivo de imagem foi recebido pelo app."
    ].join("\n");
  }

  if (isTextAttachment(absolutePath)) {
    const content = await fs.readFile(absolutePath, "utf8");
    return [
      `Arquivo anexado: ${absolutePath} (${size})`,
      "Conteudo:",
      truncateText(content, 14000)
    ].join("\n");
  }

  if (ext === ".pdf") {
    return [
      `PDF anexado: ${absolutePath} (${size})`,
      "O arquivo foi recebido pelo app. Se precisar analisar o PDF no modo local, use ferramentas de arquivo/extração disponíveis ou peça uma leitura específica do documento."
    ].join("\n");
  }

  return `Arquivo anexado localmente: ${absolutePath} (${size})`;
}

async function buildAttachmentContentParts(attachmentPaths = [], options = {}) {
  const includeImages = options.includeImages !== false;
  const parts = [];
  const notes = [];

  for (const attachmentPath of attachmentPaths) {
    const dataUrl = includeImages ? await fileToDataUrl(attachmentPath) : null;
    if (includeImages && dataUrl) {
      parts.push({
        type: "image_url",
        image_url: {
          url: dataUrl
        }
      });
      continue;
    }

    try {
      notes.push(await fileToTextNote(attachmentPath, options));
    } catch (error) {
      notes.push(`Arquivo anexado localmente: ${expandPathInput(attachmentPath)}\nFalha ao ler metadados/conteudo: ${error.message || error}`);
    }
  }

  if (notes.length) {
    parts.push({
      type: "text",
      text: notes.join("\n")
    });
  }

  return parts;
}

async function makeConversationMessages(chat, settings, userText, attachmentPaths = [], route = null, mcpState = null, projectMemory = "", attachmentOptions = {}) {
  const messages = [];
  const systemSections = [buildSystemPrompt(settings, route, mcpState)];
  const localHistory = formatRecentLocalEvents(chat);
  if (localHistory) {
    systemSections.push(`Recent local desktop results:\n${localHistory}`);
  }
  if (projectMemory) {
    systemSections.push(projectMemory);
  }

  messages.push({
    role: "system",
    content: systemSections.join("\n\n")
  });

  const chatMessages = Array.isArray(chat.messages) ? chat.messages : [];
  const latestVisibleUserIndex = (() => {
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      const message = chatMessages[index];
      if (message?.kind === "user" && !message.pending && !message.hidden) {
        return index;
      }
    }
    return -1;
  })();

  for (const [index, message] of chatMessages.entries()) {
    if (!["user", "assistant"].includes(message.kind) || message.pending || message.hidden) {
      continue;
    }
    if (
      message.kind === "user" &&
      index === latestVisibleUserIndex &&
      (attachmentPaths.length || String(message.content || "").trim() === String(userText || "").trim())
    ) {
      continue;
    }

    messages.push({
      role: message.kind === "assistant" ? "assistant" : "user",
      content: message.content
    });
  }

  const attachmentParts = await buildAttachmentContentParts(attachmentPaths, attachmentOptions);
  if (attachmentParts.length) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: userText || "Analise os anexos enviados."
        },
        ...attachmentParts
      ]
    });
  } else {
    messages.push({
      role: "user",
      content: userText
    });
  }

  return messages;
}

async function parseStreamingChatResponse(response, onTextDelta, model = "") {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let assistantText = "";
  let usage = null;
  const startedAt = Date.now();
  const toolCalls = [];
  resetLocalTokenStream(model);

  function ensureToolCall(index) {
    while (toolCalls.length <= index) {
      toolCalls.push({
        id: null,
        name: "",
        arguments: ""
      });
    }
    return toolCalls[index];
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const segments = buffer.split("\n\n");
    buffer = segments.pop() || "";

    for (const segment of segments) {
      const lines = segment
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (!line.startsWith("data:")) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed?.usage && typeof parsed.usage === "object") {
          usage = parsed.usage;
        }

        const delta = parsed?.choices?.[0]?.delta || {};
        if (typeof delta.content === "string" && delta.content) {
          assistantText += delta.content;
          recordLocalTokenDelta(delta.content, { model });
          if (typeof onTextDelta === "function") {
            onTextDelta(delta.content);
          }
        }

        if (Array.isArray(delta.tool_calls)) {
          delta.tool_calls.forEach((toolCall) => {
            const entry = ensureToolCall(toolCall.index || 0);
            if (toolCall.id) {
              entry.id = toolCall.id;
            }
            if (toolCall.function?.name) {
              entry.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              entry.arguments += toolCall.function.arguments;
            }
          });
        }
      }
    }
  }

  recordLocalTokenUsage(usage, {
    startedAt,
    endedAt: Date.now(),
    model
  });
  finalizeLocalTokenStream({
    endedAt: Date.now(),
    model
  });

  return {
    assistantText,
    nativeToolCalls: toolCalls.filter((entry) => entry.name),
    usage
  };
}

function extractAssistantTextFromLocalResponse(responseBody) {
  const message = responseBody?.choices?.[0]?.message || {};
  const content = message.content;

  if (typeof content === "string") {
    return {
      assistantText: content,
      nativeToolCalls: Array.isArray(message.tool_calls)
        ? message.tool_calls.map((entry) => ({
            id: entry.id,
            name: entry.function?.name,
            arguments: entry.function?.arguments || ""
          }))
        : []
    };
  }

  if (Array.isArray(content)) {
    return {
      assistantText: content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part?.type === "text") {
            return part.text || "";
          }
          return "";
        })
        .join("")
        .trim(),
      nativeToolCalls: Array.isArray(message.tool_calls)
        ? message.tool_calls.map((entry) => ({
            id: entry.id,
            name: entry.function?.name,
            arguments: entry.function?.arguments || ""
          }))
        : []
    };
  }

  return {
    assistantText: "",
    nativeToolCalls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map((entry) => ({
          id: entry.id,
          name: entry.function?.name,
          arguments: entry.function?.arguments || ""
        }))
      : []
  };
}

function hasImageAttachments(attachmentPaths = []) {
  return attachmentPaths.some((entry) => isImageAttachment(entry));
}

function isImageUnsupportedError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("image input is not supported") ||
    message.includes("mmproj") ||
    (message.includes("vision") && message.includes("not supported")) ||
    (message.includes("multimodal") && message.includes("not supported"))
  );
}

async function runLocalChatCompletion(settings, requestBody, signal, onTextDelta) {
  let response;
  try {
    response = await localProviderRequest(settings, "chat/completions", {
      method: "POST",
      body: requestBody,
      signal,
      expectStream: true,
      timeoutMs: DEFAULT_LOCAL_CHAT_TIMEOUT_MS
    });
  } catch (error) {
    if (!requestBody?.stream_options) {
      throw error;
    }
    response = await localProviderRequest(settings, "chat/completions", {
      method: "POST",
      body: {
        ...requestBody,
        stream_options: undefined
      },
      signal,
      expectStream: true,
      timeoutMs: DEFAULT_LOCAL_CHAT_TIMEOUT_MS
    });
  }

  const streamed = await parseStreamingChatResponse(response, onTextDelta, requestBody?.model || "");
  return extractActionsFromAssistant(streamed.assistantText, streamed.nativeToolCalls);
}

async function runLocalChatCompletionFallback(settings, requestBody, signal) {
  const startedAt = Date.now();
  const body = {
    ...requestBody,
    stream: false,
    stream_options: undefined
  };
  const fallback = await localProviderRequest(settings, "chat/completions", {
    method: "POST",
    body,
    signal,
    timeoutMs: DEFAULT_LOCAL_CHAT_TIMEOUT_MS
  });

  recordLocalTokenUsage(fallback?.usage, {
    startedAt,
    endedAt: Date.now(),
    model: fallback?.model || requestBody?.model || ""
  });

  const extracted = extractAssistantTextFromLocalResponse(fallback);
  return extractActionsFromAssistant(
    extracted.assistantText,
    extracted.nativeToolCalls
  );
}

async function sendLocalTurn(options) {
  const {
    chat,
    settings,
    userText,
    attachmentPaths = [],
    route,
    mcpState,
    projectMemory,
    signal,
    onTextDelta
  } = options;

  await ensureWorkingLocalBaseUrl(settings, { timeoutMs: 2500 });
  await ensureWorkingLocalModel(settings);
  const messages = await makeConversationMessages(chat, settings, userText, attachmentPaths, route, mcpState, projectMemory);
  const tools = getOpenAIToolSchemas(settings.fullAccessMode, {
    surface: "desktop",
    mcpState
  });
  const requestBody = {
    model: settings.localModel || DEFAULT_LOCAL_MODEL,
    messages,
    tools,
    tool_choice: tools.length ? "auto" : undefined,
    temperature: 0.2,
    max_tokens: Number(settings.localMaxTokens || 0) || DEFAULT_LOCAL_MAX_TOKENS,
    chat_template_kwargs: {
      enable_thinking: Boolean(settings.localThinkingEnabled)
    },
    stream_options: {
      include_usage: true
    },
    stream: true
  };

  try {
    const parsed = await runLocalChatCompletion(settings, requestBody, signal, onTextDelta);
    return {
      assistantText: parsed.body,
      actions: parsed.actions,
      providerMeta: {
        baseUrl: normalizeLocalBaseUrl(settings.localBaseUrl),
        model: settings.localModel || DEFAULT_LOCAL_MODEL
      }
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    if (hasImageAttachments(attachmentPaths) && isImageUnsupportedError(error)) {
      const imageFallbackReason =
        "o modelo local rejeitou entrada visual. Para analisar pixels localmente, carregue um modelo multimodal e inicie o servidor com o mmproj correspondente; enquanto isso, o arquivo fica disponivel por caminho/metadados.";
      const textOnlyMessages = await makeConversationMessages(
        chat,
        settings,
        [
          userText || "Analise os anexos enviados.",
          "",
          "Nota do runtime: o servidor local recusou image_url com a mensagem:",
          String(error.message || error),
          "Retentei sem enviar pixels da imagem para manter o chat funcionando."
        ].join("\n"),
        attachmentPaths,
        route,
        mcpState,
        projectMemory,
        {
          includeImages: false,
          imageFallbackReason
        }
      );
      const parsed = await runLocalChatCompletionFallback(
        settings,
        {
          ...requestBody,
          messages: textOnlyMessages
        },
        signal
      );
      return {
        assistantText: parsed.body || [
          "Recebi o anexo, mas o modelo local atual nao suporta entrada visual.",
          "Para analisar a imagem localmente, use um modelo multimodal e configure o servidor com o `mmproj` correspondente. Por enquanto, o arquivo ficou disponivel como caminho/metadados."
        ].join("\n"),
        actions: parsed.actions,
        providerMeta: {
          baseUrl: normalizeLocalBaseUrl(settings.localBaseUrl),
          model: settings.localModel || DEFAULT_LOCAL_MODEL,
          imageInputFallback: true
        }
      };
    }

    const parsed = await runLocalChatCompletionFallback(settings, requestBody, signal);
    return {
      assistantText: parsed.body,
      actions: parsed.actions,
      providerMeta: {
        baseUrl: normalizeLocalBaseUrl(settings.localBaseUrl),
        model: settings.localModel || DEFAULT_LOCAL_MODEL
      }
    };
  }
}

module.exports = {
  DEFAULT_LOCAL_CHAT_TIMEOUT_MS,
  DEFAULT_LOCAL_META_TIMEOUT_MS,
  ensureWorkingLocalBaseUrl,
  ensureWorkingLocalModel,
  getLocalTokenTelemetry,
  listLocalModels,
  normalizeLocalBaseUrl,
  requestBaseUrlForRuntime,
  sendLocalTurn,
  _test: {
    requestBaseUrlForRuntime
  }
};
