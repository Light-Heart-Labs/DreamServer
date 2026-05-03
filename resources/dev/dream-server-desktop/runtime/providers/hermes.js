const { HermesBackend } = require("../hermes/backend");
const { getHermesCatalog } = require("../hermes/catalog");
const os = require("os");
const path = require("path");

function toHermesHistory(chat, options = {}) {
  if (!Array.isArray(chat?.messages)) {
    return [];
  }
  const maxMessages = Math.max(0, Number(options.maxMessages || DEFAULT_HISTORY_MESSAGES));
  const maxCharsPerMessage = Math.max(200, Number(options.maxCharsPerMessage || DEFAULT_HISTORY_CHARS));
  return chat.messages
    .filter((message) => !message.pending && !message.hidden)
    .filter((message) => message.kind === "user" || message.kind === "assistant")
    // Keep the desktop bridge lean for 16K local models. Hermes keeps its own
    // session state; sending too much UI history steals context from tools.
    .slice(-maxMessages)
    .map((message) => ({
      role: message.kind === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(-maxCharsPerMessage)
    }))
    .filter((message) => message.content.trim());
}

const CHESS_BROWSER_TOOLSETS = ["browser", "dream-desktop"];
const CHESS_HERMES_MAX_ITERATIONS = 8;
const CHESS_HERMES_MAX_TOKENS = 1536;
const CHESS_HERMES_TIMEOUT_MS = 3 * 60 * 1000;
const CHESS_HISTORY_MESSAGES = 3;
const CHESS_HISTORY_CHARS = 700;
const DEFAULT_HISTORY_MESSAGES = 6;
const DEFAULT_HISTORY_CHARS = 1400;
const CONTEXT_RETRY_HISTORY_MESSAGES = 2;
const CONTEXT_RETRY_HISTORY_CHARS = 700;
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11435/v1";
const HERMES_API_MODES = new Set([
  "chat_completions",
  "codex_responses",
  "anthropic_messages",
  "bedrock_converse"
]);
const HERMES_PROVIDER_ALIASES = {
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
  kimi_cn: "kimi-coding-cn",
  "kimi-cn": "kimi-coding-cn",
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
  "minimax_cn": "minimax-cn",
  glm: "zai",
  "minimax-china": "minimax-cn",
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
const HERMES_PROVIDER_BASE_URLS = {
  custom: DEFAULT_LOCAL_BASE_URL,
  openrouter: "https://openrouter.ai/api/v1",
  nous: "https://inference-api.nousresearch.com/v1",
  openai: "https://api.openai.com/v1",
  "openai-codex": "https://chatgpt.com/backend-api/codex",
  copilot: "https://api.githubcopilot.com",
  "copilot-acp": "acp://copilot",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  "google-gemini-cli": "cloudcode-pa://google",
  "qwen-oauth": "https://portal.qwen.ai/v1",
  xai: "https://api.x.ai/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  "ollama-cloud": "https://ollama.com/v1",
  huggingface: "https://router.huggingface.co/v1",
  zai: "https://api.z.ai/api/paas/v4",
  "kimi-coding": "https://api.moonshot.ai/v1",
  "kimi-coding-cn": "https://api.moonshot.cn/v1",
  stepfun: "https://api.stepfun.ai/step_plan/v1",
  gmi: "https://api.gmi-serving.com/v1",
  minimax: "https://api.minimax.io/anthropic",
  "minimax-oauth": "https://api.minimax.io/anthropic",
  "minimax-cn": "https://api.minimaxi.com/anthropic",
  nvidia: "https://integrate.api.nvidia.com/v1",
  "ai-gateway": "https://ai-gateway.vercel.sh/v1",
  "opencode-zen": "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
  arcee: "https://api.arcee.ai/api/v1",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "alibaba-coding-plan": "https://coding-intl.dashscope.aliyuncs.com/v1",
  xiaomi: "https://api.xiaomimimo.com/v1",
  "tencent-tokenhub": "https://tokenhub.tencentmaas.com/v1",
  kilocode: "https://api.kilo.ai/api/gateway",
  "azure-foundry": "",
  bedrock: "https://bedrock-runtime.us-east-1.amazonaws.com",
  deepseek: "https://api.deepseek.com/v1"
};
const HERMES_PROVIDER_DEFAULT_MODELS = {
  nvidia: "z-ai/glm4.7"
};
const PROVIDERS_ALLOW_LOCAL_BASE_URL = new Set(["custom", "lmstudio"]);
const PROVIDERS_WITH_CHAT_TEMPLATE_THINKING = new Set([
  "custom",
  "lmstudio",
  "nvidia",
  "zai",
  "deepseek",
  "kimi-coding",
  "kimi-coding-cn"
]);

function normalizeHermesProvider(value = "custom") {
  const normalized = String(value || "custom").trim().toLowerCase();
  return HERMES_PROVIDER_ALIASES[normalized] || normalized || "custom";
}

function normalizedBaseUrlKey(value = "") {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function catalogProviderEntry(provider = "custom") {
  const normalized = normalizeHermesProvider(provider);
  try {
    const providers = getHermesCatalog().providers;
    return Array.isArray(providers)
      ? providers.find((entry) => normalizeHermesProvider(entry.id) === normalized)
      : null;
  } catch {
    return null;
  }
}

function defaultBaseUrlForProvider(provider = "custom") {
  const normalized = normalizeHermesProvider(provider);
  return String(catalogProviderEntry(normalized)?.inferenceBaseUrl || HERMES_PROVIDER_BASE_URLS[normalized] || "").trim();
}

function providerDefaultBaseUrlKeys() {
  const keys = new Set(
    Object.values(HERMES_PROVIDER_BASE_URLS)
      .map((value) => normalizedBaseUrlKey(value))
      .filter(Boolean)
  );
  try {
    const providers = getHermesCatalog().providers;
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        const key = normalizedBaseUrlKey(provider?.inferenceBaseUrl || "");
        if (key) {
          keys.add(key);
        }
      }
    }
  } catch {
    // Static defaults above are still enough for safe routing.
  }
  return keys;
}

function looksLikeProviderDefaultBaseUrl(value = "") {
  return providerDefaultBaseUrlKeys().has(normalizedBaseUrlKey(value));
}

function looksLikeOtherProviderDefaultBaseUrl(provider = "custom", value = "") {
  const key = normalizedBaseUrlKey(value);
  const providerKey = normalizedBaseUrlKey(defaultBaseUrlForProvider(provider));
  return Boolean(key && key !== providerKey && providerDefaultBaseUrlKeys().has(key));
}

function looksLikeDefaultLocalBaseUrl(value = "") {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost):11435\/v1\/?$/i.test(String(value || "").trim());
}

function looksLikeLocalBaseUrl(value = "") {
  return /^(https?:\/\/)?(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(value || "").trim());
}

function looksLikeLocalModelName(value = "") {
  const model = String(value || "").trim();
  return !model ||
    model === "default" ||
    /\.gguf$/i.test(model) ||
    /(?:^|[-_])q[2-8](?:_[a-z0-9]+)+(?:$|[-_.])/i.test(model);
}

function normalizedRoutingList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function resolveHermesRoutingSettings(settings = {}) {
  const provider = normalizeHermesProvider(settings.hermesProvider || "custom");
  const rawBaseUrl = String(settings.localBaseUrl || "").trim();
  const providerDefaultBaseUrl = defaultBaseUrlForProvider(provider);
  const allowLocalBaseUrl = PROVIDERS_ALLOW_LOCAL_BASE_URL.has(provider);
  const baseUrlLooksLocal = looksLikeLocalBaseUrl(rawBaseUrl) || looksLikeDefaultLocalBaseUrl(rawBaseUrl);
  const baseUrlLooksLikeStaleProviderDefault = looksLikeOtherProviderDefaultBaseUrl(provider, rawBaseUrl);
  const hasExplicitNonLocalBaseUrl = rawBaseUrl && !baseUrlLooksLocal && !baseUrlLooksLikeStaleProviderDefault;
  let baseUrl = rawBaseUrl || "";
  if (provider === "auto") {
    baseUrl = hasExplicitNonLocalBaseUrl ? rawBaseUrl : "";
  } else if (provider === "custom") {
    baseUrl = rawBaseUrl || DEFAULT_LOCAL_BASE_URL;
  } else if (allowLocalBaseUrl) {
    baseUrl = rawBaseUrl || providerDefaultBaseUrl;
  } else {
    baseUrl = hasExplicitNonLocalBaseUrl ? rawBaseUrl : providerDefaultBaseUrl;
  }

  const rawApiKey = String(settings.localApiKey || "").trim();
  const apiKey = rawApiKey && rawApiKey !== "not-needed"
    ? rawApiKey
    : provider === "custom"
      ? "not-needed"
      : "";
  const apiMode = String(settings.hermesApiMode || "").trim().toLowerCase();
  let resolvedApiMode = HERMES_API_MODES.has(apiMode) ? apiMode : null;
  let model = String(settings.localModel || "").trim();
  if (
    provider === "kimi-coding" &&
    rawApiKey.startsWith("sk-kimi-") &&
    (!hasExplicitNonLocalBaseUrl || baseUrl === defaultBaseUrlForProvider("kimi-coding"))
  ) {
    baseUrl = "https://api.kimi.com/coding";
    resolvedApiMode = resolvedApiMode || "anthropic_messages";
  }
  const providerDefaultModel = HERMES_PROVIDER_DEFAULT_MODELS[provider] || "";
  if (providerDefaultModel && looksLikeLocalModelName(model)) {
    model = providerDefaultModel;
  }

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    apiMode: resolvedApiMode,
    providersAllowed: normalizedRoutingList(settings.hermesProvidersAllowed),
    providersIgnored: normalizedRoutingList(settings.hermesProvidersIgnored),
    providersOrder: normalizedRoutingList(settings.hermesProvidersOrder),
    providerSort: ["price", "throughput", "latency"].includes(String(settings.hermesProviderSort || "").toLowerCase())
      ? String(settings.hermesProviderSort || "").toLowerCase()
      : "",
    providerRequireParameters: Boolean(settings.hermesProviderRequireParameters),
    providerDataCollection: String(settings.hermesProviderDataCollection || "").trim()
  };
}

function buildHermesRequestOverrides(settings = {}, routing = resolveHermesRoutingSettings(settings)) {
  if (!settings?.localThinkingEnabled || !PROVIDERS_WITH_CHAT_TEMPLATE_THINKING.has(routing.provider)) {
    return null;
  }
  return {
    extra_body: {
      chat_template_kwargs: {
        enable_thinking: true,
        clear_thinking: false
      }
    }
  };
}

function conversationTextForRouting(chat, inputText = "") {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const recentMessages = messages
    .filter((message) => !message.hidden)
    .slice(-6)
    .map((message) => String(message?.content || ""))
    .join("\n");
  const recentEvents = Array.isArray(chat?.localEvents)
    ? chat.localEvents
        .slice(-8)
        .map((event) => `${event?.summary || ""}\n${event?.content || ""}`)
        .join("\n")
    : "";
  return [
    inputText,
    chat?.title,
    chat?.activeRoute?.id,
    recentMessages,
    recentEvents
  ].map((value) => String(value || "")).join("\n").slice(-12000);
}

function looksLikeChessBrowserTask(chat, inputText = "") {
  const text = conversationTextForRouting(chat, inputText).toLowerCase();
  return /\blichess\.org\b/.test(text) ||
    /\b(browser_chess_move|browser_chess_state|chess_move|chess_state)\b/.test(text) ||
    /\b(xadrez|chess|tabuleiro)\b/.test(text);
}

function resolveHermesToolsets(settings = {}, context = {}) {
  if (Array.isArray(settings?.hermesToolsets) && settings.hermesToolsets.length) {
    return settings.hermesToolsets.map(String).filter(Boolean);
  }

  if (looksLikeChessBrowserTask(context.chat, context.inputText)) {
    return CHESS_BROWSER_TOOLSETS;
  }

  // Null means "let Hermes Agent expose every available registered toolset".
  // This keeps Hermes as the single agent brain instead of constraining it
  // through our old route-specific Dream runtime assumptions.
  return null;
}

function resolveHermesDisabledToolsets(settings = {}) {
  const disabled = Array.isArray(settings?.hermesDisabledToolsets)
    ? settings.hermesDisabledToolsets.map(String).filter(Boolean)
    : [];
  if (!settings?.hermesDesktopIntegrationEnabled) {
    disabled.push("dream-desktop");
  }
  return [...new Set(disabled)];
}

function windowsToWslPath(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return "";
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/[\\/]+/g, "/")}`;
}

function hostPlatformLabel() {
  const platform = process.platform;
  const names = {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux"
  };
  return `${names[platform] || platform} (${platform}; ${os.type()} ${os.release()})`;
}

function hermesLimitsForRoute(route, settings = {}, context = {}) {
  const routeId = String(route?.id || "").toLowerCase();
  const requestedIterations = Number(settings?.hermesMaxIterations || 0) || 16;
  const requestedMaxTokens = Number(settings?.hermesMaxTokens || 0) || 8192;
  if (looksLikeChessBrowserTask(context.chat, context.inputText)) {
    const requestedChessIterations = Number(settings?.hermesMaxIterations || 0);
    const chessIterations = Number.isFinite(requestedChessIterations) && requestedChessIterations > 0
      ? requestedChessIterations
      : CHESS_HERMES_MAX_ITERATIONS;
    return {
      maxIterations: Math.max(4, Math.min(chessIterations, CHESS_HERMES_MAX_ITERATIONS)),
      maxTokens: Math.max(512, Math.min(requestedMaxTokens, CHESS_HERMES_MAX_TOKENS))
    };
  }
  const routeCaps = {
    "desktop-quick": { iterations: 3, maxTokens: 2048 },
    "local-diagnostics": { iterations: 5, maxTokens: 4096 },
    "system-query": { iterations: 5, maxTokens: 4096 },
    "web-research": { iterations: 6, maxTokens: 6144 },
    "android-device": { iterations: 8, maxTokens: 6144 },
    "coding-project": { iterations: 12, maxTokens: 8192 }
  };
  const cap = routeCaps[routeId] || { iterations: 10, maxTokens: 8192 };

  return {
    maxIterations: Math.max(1, Math.min(requestedIterations, cap.iterations)),
    maxTokens: Math.max(512, Math.min(requestedMaxTokens, cap.maxTokens))
  };
}

function hermesTimeoutForTask(settings = {}, context = {}) {
  const configured = Number(settings?.hermesTimeoutMs || 0);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return context?.chessTask ? CHESS_HERMES_TIMEOUT_MS : undefined;
}

function isHermesTimeoutError(error) {
  const message = String(error?.message || error || "");
  return /Hermes demorou mais de|timed?\s*out|timeout|ETIMEDOUT/i.test(message);
}

function isHermesContextLengthError(error) {
  const message = String(error?.message || error || "");
  return /context length exceeded|maximum context|context window|cannot compress further|tokens.*exceed/i.test(message);
}

function buildHermesChessInstruction(context = {}) {
  const workspaceRoot = context.workspaceRoot ? path.resolve(String(context.workspaceRoot)) : "";
  return [
    "Dream Server Workbench chess mode:",
    "- Use only the live Workbench preview browser for Lichess. Do not open an external browser.",
    "- Keep each turn compact: take one needed browser action, then return.",
    "- To start a configured Lichess bot game, click the visible button label exactly: Jogar contra o computador.",
    "- For an active chess game, read browser_chess_state first. It returns algebraic squares from White's perspective even when the board is flipped.",
    "- You choose the chess move yourself from that board state. The tool does not choose moves.",
    "- Execute moves only with browser_chess_move(from_square,to_square). Never use keyboard letters, raw coordinate clicks, screenshots, or browser_vision for chess.",
    "- Do not inspect the browser console during chess. Console checks do not reveal chess turn state; use browser_chess_state instead.",
    "- Move only pieces matching controlledColor/playAs. If it is not your turn, call browser_chess_wait_turn(timeout_seconds=30).",
    "- After a successful move, continue the game by waiting for the opponent if the game is still active. Do not ask the user for moves.",
    "- If a move fails, read browser_chess_state again and choose a legal move for your side.",
    workspaceRoot ? `- Workspace root: ${workspaceRoot}` : ""
  ].filter(Boolean).join("\n");
}

function buildHermesDesktopInstruction(route, context = {}) {
  const routeId = String(route?.id || "general-purpose");
  const workspaceRoot = context.workspaceRoot ? path.resolve(String(context.workspaceRoot)) : "";
  const posixWorkspaceRoot = windowsToWslPath(workspaceRoot);
  const actualHome = os.homedir();
  const locale = String(context.locale || "").trim();
  return [
    "Dream Server Desktop host integration:",
    "- You are running inside Hermes Agent, embedded in a desktop app on the user's machine.",
    `- Host OS: ${hostPlatformLabel()}. Detect and respect this OS before choosing shell commands, path syntax, installers, browsers, and desktop automation.`,
    locale ? `- User locale/language: ${locale}. Reply and create user-facing copy in that locale unless the user asks for another language.` : "",
    process.platform === "win32"
      ? "- This Windows build runs natively. Do not assume WSL is available; use Windows paths for file tools and use the provided POSIX /mnt path only when a Bash/WSL terminal explicitly needs it."
      : "- Use this host's native POSIX paths for file tools and terminal commands unless the user explicitly targets a different environment.",
    "- Use Hermes native tools for filesystem, terminal, browser, web, code, todos and patches whenever they fit the task.",
    "- For research/search/questions about the public web, prefer Hermes web_search/web_extract or Dream web_search/web_fetch. Do not open the Workbench preview just to search or summarize pages.",
    "- Use the Dream Server Workbench browser surface only when the user asks to interact with a site/page, automate browser actions, test a local web app, capture/inspect a rendered page, or visually verify UI behavior. Do not open Chrome, Edge, Brave or the OS browser as a fallback for web pages.",
    "- dream_open_url, dream_browser_control and Hermes browser_* tools are wired to the live Workbench preview. They return text/DOM/accessibility snapshots, element refs, labels, selectors and coordinates, so image/vision support is not required for normal page interaction.",
    "- Browser navigation is stateful: use browser_navigate/dream_open_url only for the first page load or when the user explicitly wants a different URL. After the page is open, continue with browser_snapshot, browser_click, browser_type/fill, browser_press and browser_scroll on the current Workbench page. Do not reload the same URL before every click.",
    "- For dream_browser_control, omit url after the first navigation. Steps without url operate on the active Workbench WebView; adding the same url again can reload the page and lose modal/game state.",
    "- If you are already inside an interactive page on the same domain, such as a Lichess game URL, do not call browser_navigate/dream_open_url back to the domain home page. Continue from the live current URL with browser_snapshot, browser_chess_state, browser_click or browser_chess_move.",
    "- Use returned @e element refs only with the same fresh snapshot. If a label is available, pass the exact visible label as well so the bridge can reject stale refs.",
    "- If the Workbench preview is visibly open or has a URL, treat it as initialized. Take a fresh browser_snapshot/session_state before claiming the Workbench is unavailable. Do not ask the user what is visible when a DOM snapshot can be requested.",
    "- If a Workbench browser command fails, retry the Workbench browser command once with a fresh snapshot or report the exact bridge error. Do not switch to the user's desktop browser.",
    "- On low-context local models, keep browser turns compact: request live Workbench snapshots, use one or a few concrete click/fill/press/scroll steps, and do not request screenshots unless the user explicitly asks for a visual capture.",
    "- If the user manually clicks or changes the Workbench preview, treat the next live browser snapshot as the source of truth instead of relying on old screenshots.",
    "- For chess, first read the live board with browser_chess_state() or a fresh browser_snapshot. The app does not choose moves for you; you must decide the move from the returned DOM board state.",
    "- For chess, do one concrete board action per provider turn: read state, decide, then call browser_chess_move, or call browser_chess_wait_turn if it is not your turn. Return control after the tool result; the host runtime will call you again with the updated board state.",
    "- Chess state uses algebraic board coordinates from White's perspective, even when the board is visually flipped for black. Do not reinterpret pieces from the screenshot. Trust fenBoard, whitePieces, blackPieces, sideToMove, and lastMoveSquares from browser_chess_state.",
    "- When the user asks you to play chess, keep playing the actual game. After each successful browser_chess_move, if the game is still active and it is not your turn, call browser_chess_wait_turn(timeout_seconds=30). When it returns, choose and execute the next move. Do not final-answer with only 'waiting for the opponent' while the game is active.",
    "- After deciding a chess move, execute it with browser_chess_move(from_square,to_square) in the same turn. That tool targets the live cg-board DOM and verifies the board changed; it is not a move generator.",
    "- Do not use browser_press, keyboard letters, raw click sequences, browser_click on board coordinates, or browser_vision to play chess on Lichess. If browser_chess_move rejects a move, read browser_chess_state and choose a legal move for controlledColor/playAs, not the last opponent move.",
    "- Never use raw screenshot/window coordinates for chessboard squares. On Lichess, coordinate clicks outside the active cg-board are rejected; use browser_chess_move or browser_click_square with algebraic squares.",
    "- Do not click Lichess's accessibility/blind-mode button. It changes the page into a text-input interface and makes visual board operation less reliable. Use browser_chess_state/browser_chess_move on the normal board.",
    "- If the user explicitly says you are black or white, follow that. Otherwise use the board's controlled/playAs field. controlled/playAs means the side at the bottom of the Workbench board, not necessarily the side whose clock is currently running. sideToMove means whose turn it is when the app can infer it from the live clock or last-move DOM markers. Move only pieces of your side and wait if sideToMove is the opponent.",
    "- In chess, never ask the user which move to play unless the user explicitly wants to choose moves. You are the player: think internally from the returned board state, choose a legal move for playAs/sideToMove, and call browser_chess_move.",
    "- In chess, never narrate a move as completed until browser_chess_move returns success. If playAs=black and the board already shows a white move such as e2-e4, your next move must be a black move from a black piece square; do not try to move white pieces and do not stop after only describing the move.",
    "- Do not claim a tool-call limit or tell the user to continue manually during an active chess game. If a chess tool fails, read browser_chess_state again, reason from the state, and try a valid next action.",
    "- In chess against a human, do not use outside chess engines or hidden assistance. Still use browser_chess_state/browser_chess_wait_turn/browser_chess_move to operate the board and play from your own reasoning.",
    "- For board games and other DOM-exposed interactive surfaces, prefer text/DOM state and semantic browser tools over screenshots. Do not use browser_vision or screenshots for chess; use browser_chess_state, browser_snapshot and browser_chess_move. If browser_vision returns vision_disabled=true, continue from its DOM snapshot instead of retrying image capture.",
    "- Use dream_open_url for HTTP/HTTPS navigation inside Workbench. OS desktop URL opening is only for non-web app schemes such as spotify:// or mailto:.",
    "- Use set_preview_device with mode mobile when the user asks to inspect, edit or validate the mobile/iPhone version inside the Workbench. Use mode desktop for the normal desktop preview.",
    "- Use other dream_desktop tools only for desktop GUI actions such as opening apps, paths, media, volume, or revealing files.",
    "- For code generation, do not dump large complete source files into the chat. Put source code in files with file tools and keep the final answer concise.",
    "- For frontend, game, HTML/CSS/JS, page or visual prototype requests, create or edit real files in the workspace, then open or verify them in the Workbench preview. Do not satisfy these requests only by pasting a finished code block into chat.",
    "- Prefer file tools during coding so the Workbench Files and Code panels can show the files and live code progress while you work.",
    "- If a file or tool argument is large, split the work into smaller files or smaller tool calls. Never execute an incomplete/truncated tool call.",
    "- For runnable HTML/web projects, create files in the workspace, run or verify them when possible, then report the path and URL/result.",
    "- For cross-platform machine tasks, detect the OS and use portable file/terminal operations when possible; only use OS-specific commands when needed.",
    workspaceRoot ? `- Current workspace root for files and projects: ${workspaceRoot}` : "",
    actualHome ? `- Actual user home directory: ${actualHome}` : "",
    posixWorkspaceRoot ? `- If the active terminal is Bash/WSL, use this POSIX workspace path for cd/server commands: ${posixWorkspaceRoot}` : "",
    "- Never use placeholder paths like C:\\Users\\usuario, C:\\Users\\User, /home/user, ~/Desktop, or paths inside the packaged app install directory.",
    "- Prefer workspace-relative paths for file tools. For terminal commands, first use the active shell's current working directory; only convert paths when the shell syntax requires it.",
    `- Active Dream route: ${routeId}.`
  ].filter(Boolean).join("\n");
}

function emitHermesRuntimeEvent(onEvent, event) {
  if (!onEvent || !event || typeof event !== "object") {
    return;
  }

  if (event.type === "tool_start") {
    onEvent({
      type: "tool_call_started",
      tool: event.name,
      args: event.args || {},
      provider: "hermes"
    });
    return;
  }

  if (event.type === "tool_complete") {
    onEvent({
      type: "tool_call_finished",
      tool: event.name,
      ok: true,
      result: event.result,
      provider: "hermes"
    });
    return;
  }

  if (event.type === "status" || event.type === "thinking" || event.type === "step") {
    onEvent({
      type: "agent_phase_changed",
      phase: event.type,
      summary: event.message || event.kind || "",
      provider: "hermes"
    });
    return;
  }

  if (event.type === "reasoning_delta") {
    onEvent({
      type: "agent_reasoning_delta",
      delta: event.delta || "",
      provider: "hermes"
    });
    return;
  }

  if (event.type === "error") {
    onEvent({
      type: "error",
      message: event.message || "Hermes runtime error.",
      provider: "hermes"
    });
  }
}

function hermesResultErrorText(result = {}) {
  const eventText = Array.isArray(result?.events)
    ? result.events
        .map((event) => [event?.message, event?.reason, event?.error, event?.finalResponse].filter(Boolean).join(" "))
        .filter(Boolean)
        .join("\n")
    : "";
  return [result?.assistantText, result?.stderr, result?.stdout, eventText].filter(Boolean).join("\n");
}

function normalizeChessSquare(value) {
  const square = String(value || "").trim().toLowerCase();
  return /^[a-h][1-8]$/.test(square) ? square : "";
}

function extractChessMoveFromAssistantText(text) {
  const body = String(text || "");
  if (!body.trim()) {
    return null;
  }

  const hasChessToolOrContext = /browser_chess_move|chess_move|xadrez|chess|lichess/i.test(body);
  if (!hasChessToolOrContext) {
    return null;
  }

  const patterns = [
    /browser_chess_move\s*\(\s*(?:from_square\s*=\s*)?["'`]?([a-h][1-8])["'`]?\s*,\s*(?:to_square\s*=\s*)?["'`]?([a-h][1-8])["'`]?/i,
    /browser_chess_move[\s\S]{0,240}\bfrom_?square\b\s*[:=]\s*["'`]?([a-h][1-8])["'`]?[\s\S]{0,120}\bto_?square\b\s*[:=]\s*["'`]?([a-h][1-8])["'`]?/i,
    /\bfrom_?square\b\s*[:=]\s*["'`]?([a-h][1-8])["'`]?[\s\S]{0,120}\bto_?square\b\s*[:=]\s*["'`]?([a-h][1-8])["'`]?/i,
    /\bcasa\s+([a-h][1-8])\s+(?:para|to|->|=>)\s+([a-h][1-8])\b/i,
    /\b(?:mover|move|jogar|play|movimento)\b[\s\S]{0,140}\b([a-h][1-8])\b[\s\S]{0,50}\b(?:para|to|->|=>|-)\b[\s\S]{0,24}\b([a-h][1-8])\b/i,
    /\b([a-h][1-8])\s*(?:->|=>|para|to)\s*([a-h][1-8])\b/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match) {
      continue;
    }
    const fromSquare = normalizeChessSquare(match[1]);
    const toSquare = normalizeChessSquare(match[2]);
    if (fromSquare && toSquare && fromSquare !== toSquare) {
      return { fromSquare, toSquare };
    }
  }
  return null;
}

function hasHermesChessMoveEvent(events = []) {
  return (Array.isArray(events) ? events : []).some((event) => {
    if (String(event?.type || "") !== "tool_complete" && String(event?.type || "") !== "tool_start") {
      return false;
    }
    const name = String(event?.name || "").trim();
    return name === "browser_chess_move" || name === "browser_click_square";
  });
}

function hasHermesChessWaitEvent(events = []) {
  return (Array.isArray(events) ? events : []).some((event) => {
    if (String(event?.type || "") !== "tool_complete" && String(event?.type || "") !== "tool_start") {
      return false;
    }
    const name = String(event?.name || "").trim();
    return name === "browser_chess_wait_turn" || name === "browser_wait_chess_turn";
  });
}

function hasHermesBrowserClickEvent(events = []) {
  return (Array.isArray(events) ? events : []).some((event) => {
    if (String(event?.type || "") !== "tool_complete" && String(event?.type || "") !== "tool_start") {
      return false;
    }
    const name = String(event?.name || "").trim();
    return name === "browser_click" ||
      name === "dream_browser_control" ||
      name === "browser_harness" ||
      name === "browser_control";
  });
}

function recoverExplicitChessMoveAction(assistantText, events = []) {
  if (hasHermesChessMoveEvent(events)) {
    return null;
  }
  const move = extractChessMoveFromAssistantText(assistantText);
  if (!move) {
    return null;
  }
  return {
    type: "browser_harness",
    command: "chess_move",
    fromSquare: move.fromSquare,
    toSquare: move.toSquare,
    timeoutMs: 10000,
    recoveredFromAssistantText: true
  };
}

function recoverLichessSetupClickAction(assistantText, events = [], context = {}) {
  const body = String(assistantText || "");
  if (!body.trim() || !looksLikeChessBrowserTask(context.chat, context.inputText || body)) {
    return null;
  }
  if (hasHermesBrowserClickEvent(events)) {
    return null;
  }
  const mentionsComputerGame = /\b(jog(?:ar|ue)\s+contra\s+o\s+computador|play\s+against\s+(?:the\s+)?computer)\b/i.test(body);
  const saysClick = /\b(clicar|clique|click|pressionar|apertar|iniciar|come[cç]ar)\b/i.test(body);
  if (!mentionsComputerGame || !saysClick) {
    return null;
  }
  return {
    type: "browser_harness",
    command: "click",
    label: "Jogar contra o computador",
    timeoutMs: 10000,
    recoveredFromAssistantText: true,
    recoveredLichessSetup: true
  };
}

function recoverChessContinuationAction(assistantText, events = [], context = {}) {
  const body = String(assistantText || "");
  if (!body.trim() || !looksLikeChessBrowserTask(context.chat, context.inputText || body)) {
    return null;
  }
  if (hasHermesChessWaitEvent(events)) {
    return null;
  }
  const saysWaiting =
    /\b(aguardando|esperando|assim que|quando o computador|quando o oponente|waiting|wait for|opponent|next move|proximo movimento|pr[oó]ximo lance)\b/i.test(body);
  const gameEnded =
    /\b(checkmate|xeque-mate|mate|empate|stalemate|draw|resigned|abandonou|partida acabou|game over|vitoria|vit[oó]ria|derrota)\b/i.test(body);
  if (!saysWaiting || gameEnded) {
    return null;
  }
  return {
    type: "browser_harness",
    command: "chess_wait_turn",
    timeoutMs: 30000,
    recoveredFromAssistantText: true
  };
}

function recoverChessStateAction(assistantText, events = [], context = {}) {
  const body = String(assistantText || "");
  if (!body.trim() || !looksLikeChessBrowserTask(context.chat, context.inputText || body)) {
    return null;
  }
  const hasChessToolEvent = hasHermesChessMoveEvent(events) || hasHermesChessWaitEvent(events) ||
    (Array.isArray(events) ? events : []).some((event) => String(event?.name || "") === "browser_chess_state");
  if (hasChessToolEvent) {
    return null;
  }
  const abdicated =
    /\b(diga-me|me diga|qual movimento|qual lance|voce quer|você quer|continuar manualmente|manualmente|limite de chamadas|limite de ferramentas|tool calls?|nao consegui|não consegui|dificuldade para executar)\b/i.test(body);
  if (!abdicated) {
    return null;
  }
  return {
    type: "browser_harness",
    command: "chess_state",
    timeoutMs: 10000,
    recoveredFromAssistantText: true
  };
}

function recoverChessContextErrorAction(context = {}) {
  const text = conversationTextForRouting(context.chat, context.inputText || "");
  if (/\b(jog(?:ar|ue)\s+contra\s+o\s+computador|play\s+against\s+(?:the\s+)?computer)\b/i.test(text)) {
    return {
      type: "browser_harness",
      command: "click",
      label: "Jogar contra o computador",
      timeoutMs: 10000,
      recoveredFromHermesContextError: true
    };
  }
  return {
    type: "browser_harness",
    command: "chess_state",
    timeoutMs: 10000,
    recoveredFromHermesContextError: true
  };
}

async function sendHermesTurn({
  chat,
  settings,
  userText,
  attachmentPaths = [],
  route,
  signal,
  onTextDelta,
  onEvent
}) {
  const backend = new HermesBackend({
    timeoutMs: Number(settings?.hermesTimeoutMs || 0) || undefined
  });
  const inputText = [
    String(userText || ""),
    attachmentPaths.length
      ? `\n\nAttachments:\n${attachmentPaths.map((entry) => `- ${entry}`).join("\n")}`
      : ""
  ].join("");
  const chessTask = looksLikeChessBrowserTask(chat, inputText);
  const limits = hermesLimitsForRoute(route, settings, { chat, inputText });
  const timeoutMs = hermesTimeoutForTask(settings, { chessTask });
  const desktopIntegrationEnabled = Boolean(settings?.hermesDesktopIntegrationEnabled);
  const workspaceRoot = chat?.workspaceRoot;
  const hermesRouting = resolveHermesRoutingSettings(settings);

  const toolsets = resolveHermesToolsets(settings, { chat, inputText });
  const normalHistoryOptions = chessTask
    ? { maxMessages: CHESS_HISTORY_MESSAGES, maxCharsPerMessage: CHESS_HISTORY_CHARS }
    : {};
  const buildRequest = (overrides = {}) => ({
    inputText,
    workspaceRoot,
    baseUrl: hermesRouting.baseUrl,
    model: hermesRouting.model,
    apiKey: hermesRouting.apiKey || null,
    locale: settings?.locale,
    provider: hermesRouting.provider,
    apiMode: hermesRouting.apiMode,
    providersAllowed: hermesRouting.providersAllowed,
    providersIgnored: hermesRouting.providersIgnored,
    providersOrder: hermesRouting.providersOrder,
    providerSort: hermesRouting.providerSort,
    providerRequireParameters: hermesRouting.providerRequireParameters,
    providerDataCollection: hermesRouting.providerDataCollection,
    sessionId: chat?.id,
    taskId: chat?.taskId || chat?.id,
    conversationHistory: toHermesHistory(chat, overrides.historyOptions || normalHistoryOptions),
    enabledToolsets: toolsets,
    disabledToolsets: resolveHermesDisabledToolsets(settings),
    ephemeralSystemPrompt: desktopIntegrationEnabled
      ? chessTask
        ? buildHermesChessInstruction({ workspaceRoot })
        : buildHermesDesktopInstruction(route, {
            workspaceRoot,
            locale: settings?.locale
          })
      : null,
    desktopIntegrationEnabled,
    platform: desktopIntegrationEnabled ? "desktop" : "cli",
    maxIterations: limits.maxIterations,
    maxTokens: overrides.maxTokens || limits.maxTokens,
    timeoutMs,
    skipContextFiles: Boolean(overrides.skipContextFiles),
    requestOverrides: buildHermesRequestOverrides(settings, hermesRouting),
    reasoningConfig: {
      enabled: Boolean(settings?.localThinkingEnabled),
      effort: settings?.localThinkingEnabled ? "medium" : "none"
    },
    signal,
    onTextDelta,
    onEvent: (event) => emitHermesRuntimeEvent(onEvent, event)
  });
  const compactContextRetry = async () => {
    emitHermesRuntimeEvent(onEvent, {
      type: "status",
      kind: "context_retry",
      message: "Contexto do Hermes excedido; reenviando com historico compacto e sem arquivos de contexto."
    });
    return await backend.sendTurn(buildRequest({
      historyOptions: {
        maxMessages: CONTEXT_RETRY_HISTORY_MESSAGES,
        maxCharsPerMessage: CONTEXT_RETRY_HISTORY_CHARS
      },
      maxTokens: Math.min(Number(limits.maxTokens || 4096), 3072),
      skipContextFiles: true
    }));
  };
  let result;
  try {
    result = await backend.sendTurn(buildRequest());
    if (!chessTask && !result?.ok && isHermesContextLengthError(hermesResultErrorText(result))) {
      result = await compactContextRetry();
    }
  } catch (error) {
    if (!chessTask && isHermesContextLengthError(error)) {
      result = await compactContextRetry();
    } else if (!chessTask || (!isHermesTimeoutError(error) && !isHermesContextLengthError(error))) {
      throw error;
    } else {
      const contextError = isHermesContextLengthError(error);
      const message = String(error?.message || error || (contextError ? "Hermes context length exceeded" : "Hermes timeout"));
      const assistantText = contextError
        ? "Hermes excedeu o contexto deste turno de xadrez. Vou continuar por uma acao compacta no Workbench."
        : [
            "Hermes excedeu o tempo deste turno de xadrez.",
            "Vou retomar pelo estado vivo do tabuleiro em vez de encerrar a partida."
          ].join(" ");
      return {
        assistantText,
        actions: [contextError
          ? recoverChessContextErrorAction({ chat, inputText: userText })
          : {
              type: "browser_harness",
              command: "chess_state",
              timeoutMs: 10000,
              recoveredFromHermesTimeout: true
            }],
        status: "running",
        selfContained: false,
        hermes: {
          ok: false,
          error: message,
          timeout: !contextError,
          contextLengthExceeded: contextError,
          events: []
        }
      };
    }
  }

  const fallbackText = [
    "Hermes nao retornou texto final para este turno.",
    result.stderr ? `STDERR:\n${result.stderr}` : "",
    result.stdout ? `STDOUT:\n${result.stdout}` : "",
    Number.isFinite(Number(result.exitCode)) ? `Exit code: ${result.exitCode}` : ""
  ].filter(Boolean).join("\n\n");

  const assistantText = result.assistantText || fallbackText;
  const recoveredAction =
    recoverExplicitChessMoveAction(assistantText, result.events || []) ||
    recoverLichessSetupClickAction(assistantText, result.events || [], { chat, inputText: userText }) ||
    recoverChessContinuationAction(assistantText, result.events || [], { chat, inputText: userText }) ||
    recoverChessStateAction(assistantText, result.events || [], { chat, inputText: userText });
  const actions = recoveredAction ? [recoveredAction] : [];

  return {
    assistantText,
    actions,
    status: result.status || "stopped",
    selfContained: actions.length ? false : true,
    hermes: {
      ok: result.ok,
      exitCode: result.exitCode,
      events: result.events || []
    }
  };
}

async function hermesDoctor(options = {}) {
  const backend = new HermesBackend(options);
  return await backend.doctor(options);
}

module.exports = {
  hermesDoctor,
  sendHermesTurn,
  normalizeHermesProvider,
  resolveHermesRoutingSettings,
  buildHermesRequestOverrides,
  _test: {
    extractChessMoveFromAssistantText,
    recoverExplicitChessMoveAction,
    recoverLichessSetupClickAction,
    recoverChessContinuationAction,
    recoverChessStateAction,
    recoverChessContextErrorAction,
    hermesLimitsForRoute,
    hermesTimeoutForTask,
    isHermesContextLengthError,
    isHermesTimeoutError,
    buildHermesChessInstruction,
    buildHermesDesktopInstruction,
    toHermesHistory,
    defaultBaseUrlForProvider,
    looksLikeLocalBaseUrl,
    looksLikeLocalModelName,
    looksLikeProviderDefaultBaseUrl,
    resolveHermesRoutingSettings,
    buildHermesRequestOverrides,
    resolveHermesToolsets,
    looksLikeChessBrowserTask
  }
};
