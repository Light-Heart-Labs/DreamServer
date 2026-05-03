const state = {
  app: null,
  busy: false,
  stopping: false,
  panelOpen: true,
  appMode: "home",
  aperantProvider: localStorage.getItem("dream.aperantProvider") || "",
  kanbanDragTaskId: "",
  kanbanQueueActive: localStorage.getItem("dream.kanbanQueueActive") === "true",
  kanbanShowArchived: localStorage.getItem("dream.kanbanShowArchived") === "true",
  kanbanQueueProcessing: false,
  kanbanStartingTaskIds: new Set(),
  workbenchView: "preview",
  workbenchFilesView: localStorage.getItem("dream.workbench.filesView") === "list" ? "list" : "grid",
  workbenchFilesPath: "",
  selectedWorkbenchFilePath: "",
  selectedWorkbenchFileChatId: "",
  previewDeviceMode: localStorage.getItem("dream.workbench.previewDeviceMode") === "mobile" ? "mobile" : "desktop",
  attachments: [],
  slashMenu: {
    open: false,
    index: 0,
    items: [],
    query: "",
    tokenStart: 0,
    tokenEnd: 0
  },
  localModels: [],
  refreshTimer: null,
  liveRefreshTimer: null,
  autoRunKey: null,
  toastTimer: null,
  mobilePreview: {
    service: null,
    loading: false,
    error: "",
    promise: null
  },
  homeDashboard: {
    timer: null,
    terminalTimer: null,
    polling: false,
    metrics: null,
    terminalLines: [],
    terminalLineIndex: 0,
    terminalCharIndex: 0,
    peakTps: 0,
    history: {
      cpu: [],
      gpu: [],
      ram: [],
      vram: [],
      tps: [],
      latency: []
    },
    liveTokens: {
      active: false,
      chatId: "",
      messageId: "",
      model: "",
      startedAt: 0,
      updatedAt: 0,
      totalTokens: 0,
      tokensPerSecond: null,
      lastHistoryAt: 0,
      samples: []
    },
    dragReady: false,
    topZ: 4
  },
  previewHarness: {
    ownerChatId: "",
    url: "",
    updatedAt: 0,
    elements: [],
    lastSnapshot: null,
    consoleMessages: [],
    pageErrors: []
  },
  codeEditor: {
    key: "",
    value: "",
    dirty: false,
    savedAt: 0
  },
  codeTyping: {
    stableKey: "",
    target: "",
    visible: "",
    timer: null
  },
  actionRegistry: new Map(),
  runningActions: new Set(),
  runtimeActivity: [],
  renderCache: {
    sidebar: "",
    transcript: "",
    actions: "",
    route: "",
    lsp: "",
    projects: "",
    todos: "",
    tasks: "",
    agents: "",
    terminals: "",
    background: "",
    mcp: "",
    kanban: "",
    multiAgents: "",
    multiTerminals: "",
    changes: "",
    activity: "",
    files: "",
    workbench: "",
    previewSrc: "",
    mobilePreviewPayload: "",
    attachments: "",
    models: "",
    supportedApps: "",
    hermesCatalog: ""
  }
};

const elements = {
  ambientVideo: document.getElementById("ambientVideo"),
  ambientImage: document.getElementById("ambientImage"),
  homeScreen: document.getElementById("homeScreen"),
  homeDock: document.getElementById("dock-container"),
  homeOpsDashboard: document.getElementById("homeOpsDashboard"),
  opsCpuVal: document.getElementById("opsCpuVal"),
  opsRamVal: document.getElementById("opsRamVal"),
  opsRamGb: document.getElementById("opsRamGb"),
  opsCpuBars: document.getElementById("opsCpuBars"),
  opsCpuCores: document.getElementById("opsCpuCores"),
  opsCpuTemp: document.getElementById("opsCpuTemp"),
  opsTpsVal: document.getElementById("opsTpsVal"),
  opsTpsArc: document.getElementById("opsTpsArc"),
  opsTokenTotal: document.getElementById("opsTokenTotal"),
  opsTokenModel: document.getElementById("opsTokenModel"),
  opsSignalCanvas: document.getElementById("opsSignalCanvas"),
  opsLlamaPing: document.getElementById("opsLlamaPing"),
  opsLlamaStatus: document.getElementById("opsLlamaStatus"),
  opsLlamaBase: document.getElementById("opsLlamaBase"),
  opsTerminalBody: document.getElementById("opsTerminalBody"),
  opsActivityBody: document.getElementById("opsActivityBody"),
  opsVramVal: document.getElementById("opsVramVal"),
  opsGpuLoadVal: document.getElementById("opsGpuLoadVal"),
  opsVramBars: document.getElementById("opsVramBars"),
  opsGpuBars: document.getElementById("opsGpuBars"),
  opsGpuName: document.getElementById("opsGpuName"),
  opsGpuTemp: document.getElementById("opsGpuTemp"),
  opsThroughputCanvas: document.getElementById("opsThroughputCanvas"),
  opsCpuLineVal: document.getElementById("opsCpuLineVal"),
  opsGpuLineVal: document.getElementById("opsGpuLineVal"),
  appShell: document.getElementById("appShell"),
  statusBadge: document.getElementById("statusBadge"),
  providerBadge: document.getElementById("providerBadge"),
  bridgeModePill: document.getElementById("bridgeModePill"),
  accessModePill: document.getElementById("accessModePill"),
  openTaskButton: document.getElementById("openTaskButton"),
  togglePanelButton: document.getElementById("togglePanelButton"),
  closePanelButton: document.getElementById("closePanelButton"),
  appModeChatButton: document.getElementById("appModeChatButton"),
  appModeKanbanButton: document.getElementById("appModeKanbanButton"),
  appModeTerminalsButton: document.getElementById("appModeTerminalsButton"),
  headerTerminalButton: document.getElementById("headerTerminalButton"),
  headerNewChatButton: document.getElementById("headerNewChatButton"),
  headerPanelButton: document.getElementById("headerPanelButton"),
  panelScrim: document.getElementById("panelScrim"),
  newChatButton: document.getElementById("newChatButton"),
  aperantSidebar: document.getElementById("aperantSidebar"),
  aperantProjectName: document.getElementById("aperantProjectName"),
  aperantProjectPath: document.getElementById("aperantProjectPath"),
  aperantTaskCount: document.getElementById("aperantTaskCount"),
  aperantProviderState: document.getElementById("aperantProviderState"),
  aperantAgentState: document.getElementById("aperantAgentState"),
  aperantPendingState: document.getElementById("aperantPendingState"),
  chatCount: document.getElementById("chatCount"),
  chatList: document.getElementById("chatList"),
  apiKeyState: document.getElementById("apiKeyState"),
  providerSummary: document.getElementById("providerSummary"),
  threadEyebrow: document.getElementById("threadEyebrow"),
  chatTitle: document.getElementById("chatTitle"),
  chatSubtitle: document.getElementById("chatSubtitle"),
  providerMeta: document.getElementById("providerMeta"),
  profileMeta: document.getElementById("profileMeta"),
  localeMeta: document.getElementById("localeMeta"),
  interactiveMeta: document.getElementById("interactiveMeta"),
  heroState: document.getElementById("heroState"),
  transcript: document.getElementById("transcript"),
  kanbanBoard: document.getElementById("kanbanBoard"),
  kanbanTaskForm: document.getElementById("kanbanTaskForm"),
  kanbanTaskTitleInput: document.getElementById("kanbanTaskTitleInput"),
  kanbanTaskObjectiveInput: document.getElementById("kanbanTaskObjectiveInput"),
  kanbanRouteInput: document.getElementById("kanbanRouteInput"),
  kanbanProviderInput: document.getElementById("kanbanProviderInput"),
  kanbanQueueActiveInput: document.getElementById("kanbanQueueActiveInput"),
  kanbanShowArchivedInput: document.getElementById("kanbanShowArchivedInput"),
  kanbanQueueAllButton: document.getElementById("kanbanQueueAllButton"),
  kanbanRuntimeBanner: document.getElementById("kanbanRuntimeBanner"),
  kanbanColumns: document.getElementById("kanbanColumns"),
  kanbanRefreshButton: document.getElementById("kanbanRefreshButton"),
  multiAgentDeck: document.getElementById("multiAgentDeck"),
  aperantUtilityView: document.getElementById("aperantUtilityView"),
  agentSpawnForm: document.getElementById("agentSpawnForm"),
  agentNameInput: document.getElementById("agentNameInput"),
  agentObjectiveInput: document.getElementById("agentObjectiveInput"),
  agentProviderInput: document.getElementById("agentProviderInput"),
  agentRouteInput: document.getElementById("agentRouteInput"),
  agentWorktreeInput: document.getElementById("agentWorktreeInput"),
  agentBranchInput: document.getElementById("agentBranchInput"),
  multiAgentProviderSelect: document.getElementById("multiAgentProviderSelect"),
  multiAgentNewTerminalButton: document.getElementById("multiAgentNewTerminalButton"),
  multiAgentSettingsButton: document.getElementById("multiAgentSettingsButton"),
  multiAgentList: document.getElementById("multiAgentList"),
  multiTerminalList: document.getElementById("multiTerminalList"),
  multiAgentCount: document.getElementById("multiAgentCount"),
  multiTerminalCount: document.getElementById("multiTerminalCount"),
  composer: document.getElementById("composer"),
  attachmentList: document.getElementById("attachmentList"),
  attachButton: document.getElementById("attachButton"),
  promptInput: document.getElementById("promptInput"),
  slashCommandMenu: document.getElementById("slashCommandMenu"),
  stopButton: document.getElementById("stopButton"),
  sendButton: document.getElementById("sendButton"),
  composerProviderHint: document.getElementById("composerProviderHint"),
  composerAttachmentHint: document.getElementById("composerAttachmentHint"),
  utilityPanel: document.getElementById("utilityPanel"),
  settingsModal: document.getElementById("settingsModal"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsModalBody: document.getElementById("settingsModalBody"),
  settingsCloseButton: document.getElementById("settingsCloseButton"),
  providerSettingsGroup: document.getElementById("providerSettingsGroup"),
  cloudProviderButton: document.getElementById("cloudProviderButton"),
  localProviderButton: document.getElementById("localProviderButton"),
  manusProviderDetails: document.getElementById("manusProviderDetails"),
  openRouterRoutingDetails: document.getElementById("openRouterRoutingDetails"),
  cloudSettingsGroup: document.getElementById("cloudSettingsGroup"),
  localSettingsGroup: document.getElementById("localSettingsGroup"),
  settingsForm: document.getElementById("settingsForm"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  agentProfileSelect: document.getElementById("agentProfileSelect"),
  localeInput: document.getElementById("localeInput"),
  localBaseUrlInput: document.getElementById("localBaseUrlInput"),
  localModelInput: document.getElementById("localModelInput"),
  localApiKeyInput: document.getElementById("localApiKeyInput"),
  hermesProviderInput: document.getElementById("hermesProviderInput"),
  hermesApiModeInput: document.getElementById("hermesApiModeInput"),
  hermesProvidersAllowedInput: document.getElementById("hermesProvidersAllowedInput"),
  hermesProvidersIgnoredInput: document.getElementById("hermesProvidersIgnoredInput"),
  hermesProvidersOrderInput: document.getElementById("hermesProvidersOrderInput"),
  hermesProviderSortInput: document.getElementById("hermesProviderSortInput"),
  hermesProviderRequireParametersInput: document.getElementById("hermesProviderRequireParametersInput"),
  hermesProviderDataCollectionInput: document.getElementById("hermesProviderDataCollectionInput"),
  localThinkingEnabledInput: document.getElementById("localThinkingEnabledInput"),
  localLlamaEnabledInput: document.getElementById("localLlamaEnabledInput"),
  localLlamaAutoStartInput: document.getElementById("localLlamaAutoStartInput"),
  localLlamaPortInput: document.getElementById("localLlamaPortInput"),
  localLlamaContextSizeInput: document.getElementById("localLlamaContextSizeInput"),
  localLlamaGpuLayersInput: document.getElementById("localLlamaGpuLayersInput"),
  localLlamaBatchSizeInput: document.getElementById("localLlamaBatchSizeInput"),
  localLlamaModelDirInput: document.getElementById("localLlamaModelDirInput"),
  localLlamaModelPathInput: document.getElementById("localLlamaModelPathInput"),
  localLlamaStatusLabel: document.getElementById("localLlamaStatusLabel"),
  localLlamaRuntimeDescription: document.getElementById("localLlamaRuntimeDescription"),
  localLlamaManagedLabel: document.getElementById("localLlamaManagedLabel"),
  localLlamaManagedHint: document.getElementById("localLlamaManagedHint"),
  startLocalLlamaButton: document.getElementById("startLocalLlamaButton"),
  stopLocalLlamaButton: document.getElementById("stopLocalLlamaButton"),
  hermesDesktopIntegrationEnabledInput: document.getElementById("hermesDesktopIntegrationEnabledInput"),
  hermesDesktopIntegrationHint: document.getElementById("hermesDesktopIntegrationHint"),
  desktopBridgeDescription: document.getElementById("desktopBridgeDescription"),
  hostPlatformBadge: document.getElementById("hostPlatformBadge"),
  pickBackgroundButton: document.getElementById("pickBackgroundButton"),
  clearBackgroundButton: document.getElementById("clearBackgroundButton"),
  backgroundMediaLabel: document.getElementById("backgroundMediaLabel"),
  setupOverlay: document.getElementById("setupOverlay"),
  setupIcon: document.getElementById("setupIcon"),
  setupSub: document.getElementById("setupSub"),
  setupLog: document.getElementById("setupLog"),
  setupActions: document.getElementById("setupActions"),
  setupRetryBtn: document.getElementById("setupRetryBtn"),
  setupHint: document.getElementById("setupHint"),
  refreshLocalModelsButton: document.getElementById("refreshLocalModelsButton"),
  trustModeInput: document.getElementById("trustModeInput"),
  interactiveModeInput: document.getElementById("interactiveModeInput"),
  desktopBridgeEnabledInput: document.getElementById("desktopBridgeEnabledInput"),
  fullAccessModeInput: document.getElementById("fullAccessModeInput"),
  kanbanGitEnabledInput: document.getElementById("kanbanGitEnabledInput"),
  kanbanAutoSchedulerEnabledInput: document.getElementById("kanbanAutoSchedulerEnabledInput"),
  kanbanAutoRecoverEnabledInput: document.getElementById("kanbanAutoRecoverEnabledInput"),
  kanbanAutoCleanupEnabledInput: document.getElementById("kanbanAutoCleanupEnabledInput"),
  kanbanAutoPrEnabledInput: document.getElementById("kanbanAutoPrEnabledInput"),
  kanbanMultiAgentOrchestrationEnabledInput: document.getElementById("kanbanMultiAgentOrchestrationEnabledInput"),
  kanbanMaxParallelAgentsInput: document.getElementById("kanbanMaxParallelAgentsInput"),
  kanbanSchedulerIntervalMsInput: document.getElementById("kanbanSchedulerIntervalMsInput"),
  connectorIdsInput: document.getElementById("connectorIdsInput"),
  enableSkillsInput: document.getElementById("enableSkillsInput"),
  forceSkillsInput: document.getElementById("forceSkillsInput"),
  clearApiKeyButton: document.getElementById("clearApiKeyButton"),
  settingsTabs: document.getElementById("settingsTabs"),
  settingsPaneEyebrow: document.getElementById("settingsPaneEyebrow"),
  settingsDialogTitle: document.getElementById("settingsDialogTitle"),
  settingsRailStatus: document.getElementById("settingsRailStatus"),
  settingsSaveButton: document.getElementById("settingsSaveButton"),
  providerBadgeSettings: document.getElementById("providerBadgeSettings"),
  apiKeyBadge: document.getElementById("apiKeyBadge"),
  bridgeStateBadge: document.getElementById("bridgeStateBadge"),
  themeGrid: document.getElementById("themeGrid"),
  themeAccPicker: document.getElementById("themeAccPicker"),
  themeAccText: document.getElementById("themeAccText"),
  themeStopAPicker: document.getElementById("themeStopAPicker"),
  themeStopAText: document.getElementById("themeStopAText"),
  themeStopBPicker: document.getElementById("themeStopBPicker"),
  themeStopBText: document.getElementById("themeStopBText"),
  themeBasePicker: document.getElementById("themeBasePicker"),
  themeBaseText: document.getElementById("themeBaseText"),
  themeTintPicker: document.getElementById("themeTintPicker"),
  themeTintText: document.getElementById("themeTintText"),
  themeBlurSlider: document.getElementById("themeBlurSlider"),
  themeBlurValue: document.getElementById("themeBlurValue"),
  themeResetButton: document.getElementById("themeResetButton"),
  codeShaderEnabledInput: document.getElementById("codeShaderEnabledInput"),
  codeShaderPresetInput: document.getElementById("codeShaderPresetInput"),
  codeCursorShaderInput: document.getElementById("codeCursorShaderInput"),
  codeShaderIntensityInput: document.getElementById("codeShaderIntensityInput"),
  codeShaderIntensityValue: document.getElementById("codeShaderIntensityValue"),
  settingsSupportedAppsList: document.getElementById("settingsSupportedAppsList"),
  hermesSkillSummary: document.getElementById("hermesSkillSummary"),
  hermesGatewayList: document.getElementById("hermesGatewayList"),
  routeFeed: document.getElementById("routeFeed"),
  lspFeed: document.getElementById("lspFeed"),
  projectFeed: document.getElementById("projectFeed"),
  todoFeed: document.getElementById("todoFeed"),
  taskFeed: document.getElementById("taskFeed"),
  agentFeed: document.getElementById("agentFeed"),
  actionFeed: document.getElementById("actionFeed"),
  terminalFeed: document.getElementById("terminalFeed"),
  backgroundFeed: document.getElementById("backgroundFeed"),
  stopAllLocalButton: document.getElementById("stopAllLocalButton"),
  mcpFeed: document.getElementById("mcpFeed"),
  bridgeState: document.getElementById("bridgeState"),
  supportedAppsList: document.getElementById("supportedAppsList"),
  workbenchState: document.getElementById("workbenchState"),
  previewUrlLabel: document.getElementById("previewUrlLabel"),
  previewSurface: document.getElementById("previewSurface"),
  previewOpenButton: document.getElementById("previewOpenButton"),
  previewRefreshButton: document.getElementById("previewRefreshButton"),
  previewDesktopButton: document.getElementById("previewDesktopButton"),
  previewMobileButton: document.getElementById("previewMobileButton"),
  workbenchPreviewTab: document.getElementById("workbenchPreviewTab"),
  workbenchFilesTab: document.getElementById("workbenchFilesTab"),
  workbenchCodeTab: document.getElementById("workbenchCodeTab"),
  workbenchChangesTab: document.getElementById("workbenchChangesTab"),
  workbenchTerminalTab: document.getElementById("workbenchTerminalTab"),
  previewPanelSection: document.getElementById("previewPanelSection"),
  filesPanelSection: document.getElementById("filesPanelSection"),
  codePanelSection: document.getElementById("codePanelSection"),
  changesPanelSection: document.getElementById("changesPanelSection"),
  terminalPanelSection: document.getElementById("terminalPanelSection"),
  filesSummary: document.getElementById("filesSummary"),
  filesSurface: document.getElementById("filesSurface"),
  changeSummary: document.getElementById("changeSummary"),
  changeFeed: document.getElementById("changeFeed"),
  codeFileLabel: document.getElementById("codeFileLabel"),
  codeSurface: document.getElementById("codeSurface"),
  activitySummary: document.getElementById("activitySummary"),
  activityFeed: document.getElementById("activityFeed"),
  localModelsList: document.getElementById("localModelsList"),
  toast: document.getElementById("toast"),
  thinkingIndicator: document.getElementById("thinkingIndicator")
};

let thinkingAnimationFrame = null;
let lastThinkingTimestamp = 0;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currentChat() {
  const selected = state.app?.selectedChatId;
  return state.app?.chats?.find((chat) => chat.id === selected) || state.app?.chats?.[0] || null;
}

function currentChatId() {
  return currentChat()?.id || "";
}

function activeProvider(chat = currentChat()) {
  return executionProviderForSettings(state.app?.settings || {});
}

function hermesProfileLabel(profile = "") {
  const normalized = String(profile || "").toLowerCase();
  const labels = {
    "manus-1.6": "Manus Cloud 1.6",
    "manus-1.6-lite": "Manus Cloud 1.6 Lite",
    "manus-1.6-max": "Manus Cloud 1.6 Max"
  };
  return labels[normalized] || String(profile || "Manus Cloud");
}

const HERMES_PROVIDER_LABELS = {
  auto: "Auto (config Hermes)",
  custom: "Custom / local",
  manus: "Manus Cloud",
  openrouter: "OpenRouter",
  nous: "Nous Portal",
  openai: "OpenAI / ChatGPT API",
  "openai-codex": "OpenAI Codex",
  copilot: "GitHub Copilot",
  "copilot-acp": "GitHub Copilot ACP",
  anthropic: "Anthropic / Claude",
  gemini: "Google Gemini",
  "google-gemini-cli": "Google Gemini OAuth",
  "qwen-oauth": "Qwen OAuth",
  xai: "xAI",
  lmstudio: "LM Studio",
  "ollama-cloud": "Ollama Cloud",
  huggingface: "Hugging Face",
  zai: "Z.AI / GLM",
  "kimi-coding": "Kimi / Moonshot",
  "kimi-coding-cn": "Kimi / Moonshot CN",
  stepfun: "StepFun",
  gmi: "GMI Cloud",
  minimax: "MiniMax",
  "minimax-oauth": "MiniMax OAuth",
  "minimax-cn": "MiniMax CN",
  nvidia: "NVIDIA NIM",
  "ai-gateway": "Vercel AI Gateway",
  "opencode-zen": "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  arcee: "Arcee AI",
  alibaba: "Alibaba DashScope",
  "alibaba-coding-plan": "Alibaba Coding Plan",
  xiaomi: "Xiaomi MiMo",
  "tencent-tokenhub": "Tencent TokenHub",
  kilocode: "Kilo Code",
  "azure-foundry": "Azure Foundry",
  bedrock: "AWS Bedrock",
  deepseek: "DeepSeek"
};

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
  cloud: "manus",
  manuscloud: "manus",
  "manus-cloud": "manus",
  google: "gemini",
  "google-gemini": "gemini",
  "google-ai-studio": "gemini",
  claude: "anthropic",
  anthropic_claude: "anthropic",
  "claude-code": "anthropic",
  chatgpt: "openai",
  gpt: "openai",
  openai_codex: "openai-codex",
  github: "copilot",
  "github-copilot": "copilot",
  "github-models": "copilot",
  "github-model": "copilot",
  "github-copilot-acp": "copilot-acp",
  copilot_acp: "copilot-acp",
  "copilot-acp-agent": "copilot-acp",
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
const HERMES_PROVIDER_DEFAULT_BASE_URLS = {
  custom: "http://127.0.0.1:11435/v1",
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
  bedrock: "https://bedrock-runtime.us-east-1.amazonaws.com",
  deepseek: "https://api.deepseek.com/v1"
};
const HERMES_PROVIDER_DEFAULT_MODELS = {
  nvidia: "z-ai/glm4.7"
};
const HERMES_PROVIDERS_ALLOW_LOCAL_BASE_URL = new Set(["custom", "lmstudio"]);

function providerUsesLocalEndpoint(provider = "custom") {
  return HERMES_PROVIDERS_ALLOW_LOCAL_BASE_URL.has(normalizeHermesProvider(provider));
}

function normalizeHermesProvider(value = "custom") {
  const normalized = String(value || "custom").trim().toLowerCase();
  return HERMES_PROVIDER_ALIASES[normalized] || normalized || "custom";
}

function normalizedBaseUrlKey(value = "") {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function hermesCatalogProviders() {
  const providers = state.app?.hermesCatalog?.providers;
  return Array.isArray(providers) ? providers : [];
}

function hermesCatalogProvider(provider = "custom") {
  const normalized = normalizeHermesProvider(provider);
  return hermesCatalogProviders().find((entry) => normalizeHermesProvider(entry.id) === normalized) || null;
}

function providerDefaultBaseUrlKeys() {
  const keys = new Set(
    Object.values(HERMES_PROVIDER_DEFAULT_BASE_URLS)
      .map((value) => normalizedBaseUrlKey(value))
      .filter(Boolean)
  );
  for (const provider of hermesCatalogProviders()) {
    const key = normalizedBaseUrlKey(provider?.inferenceBaseUrl || "");
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function looksLikeOtherProviderDefaultBaseUrl(provider = "custom", value = "") {
  const key = normalizedBaseUrlKey(value);
  const providerKey = normalizedBaseUrlKey(defaultBaseUrlForProvider(provider));
  return Boolean(key && key !== providerKey && providerDefaultBaseUrlKeys().has(key));
}

function hermesProviderLabel(provider = "custom") {
  const normalized = normalizeHermesProvider(provider);
  return HERMES_PROVIDER_LABELS[normalized] || hermesCatalogProvider(normalized)?.label || normalized;
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

function defaultBaseUrlForProvider(provider = "custom") {
  const normalized = normalizeHermesProvider(provider);
  return String(hermesCatalogProvider(normalized)?.inferenceBaseUrl || HERMES_PROVIDER_DEFAULT_BASE_URLS[normalized] || "").trim();
}

function effectiveBaseUrlForProvider(provider = "custom", value = "") {
  const normalized = normalizeHermesProvider(provider);
  const raw = String(value || "").trim();
  const staleProviderDefault = looksLikeOtherProviderDefaultBaseUrl(normalized, raw);
  if (normalized === "manus") {
    return "";
  }
  if (normalized === "auto") {
    return raw && !looksLikeLocalBaseUrl(raw) && !staleProviderDefault ? raw : "";
  }
  if (HERMES_PROVIDERS_ALLOW_LOCAL_BASE_URL.has(normalized)) {
    return raw || defaultBaseUrlForProvider(normalized);
  }
  return raw && !looksLikeLocalBaseUrl(raw) && !staleProviderDefault
    ? raw
    : defaultBaseUrlForProvider(normalized);
}

function effectiveModelForProvider(provider = "custom", value = "") {
  const normalized = normalizeHermesProvider(provider);
  const model = String(value || "").trim();
  const defaultModel = HERMES_PROVIDER_DEFAULT_MODELS[normalized] || "";
  return defaultModel && looksLikeLocalModelName(model) ? defaultModel : model;
}

function currentHermesRoute(settings = state.app?.settings || {}) {
  const provider = normalizeHermesProvider(settings.hermesProvider || "custom");
  const model = provider === "manus"
    ? hermesProfileLabel(settings.agentProfile || "manus-1.6")
    : effectiveModelForProvider(provider, settings.localModel || "");
  const baseUrl = effectiveBaseUrlForProvider(provider, settings.localBaseUrl || "");
  return {
    provider,
    label: hermesProviderLabel(provider),
    model,
    baseUrl
  };
}

function hermesProviderOptionEntries() {
  const fixed = [
    { id: "custom", label: HERMES_PROVIDER_LABELS.custom },
    { id: "auto", label: HERMES_PROVIDER_LABELS.auto },
    { id: "manus", label: HERMES_PROVIDER_LABELS.manus }
  ];
  const entries = [];
  const seen = new Set();
  const push = (id, label) => {
    const normalized = normalizeHermesProvider(id);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    entries.push({
      id: normalized,
      label: label || hermesProviderLabel(normalized)
    });
  };
  fixed.forEach((entry) => push(entry.id, entry.label));
  for (const provider of hermesCatalogProviders()) {
    push(provider.id, provider.label);
  }
  for (const [id, label] of Object.entries(HERMES_PROVIDER_LABELS)) {
    push(id, label);
  }
  return entries;
}

function syncHermesProviderOptions(settings = state.app?.settings || {}) {
  const select = elements.hermesProviderInput;
  if (!select) {
    return;
  }
  const current = normalizeHermesProvider(select.value || settings.hermesProvider || "custom");
  const html = hermesProviderOptionEntries()
    .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label || entry.id)}</option>`)
    .join("");
  if (select.dataset.optionsSignature !== html) {
    select.innerHTML = html;
    select.dataset.optionsSignature = html;
  }
  const hasCurrent = Array.from(select.options).some((option) => option.value === current);
  select.value = hasCurrent ? current : "custom";
}

function routeUsesLocalEndpoint(settings = state.app?.settings || {}) {
  const route = currentHermesRoute(settings);
  return providerUsesLocalEndpoint(route.provider) || (route.provider === "auto" && looksLikeLocalBaseUrl(route.baseUrl));
}

function executionProviderForSettings(settings = state.app?.settings || {}) {
  return normalizeHermesProvider(settings.hermesProvider || "custom") === "manus" ? "cloud" : "local";
}

function isManusProviderSelected(settings = state.app?.settings || {}) {
  return normalizeHermesProvider(settings.hermesProvider || "custom") === "manus";
}

function isDefaultHermesLocalBaseUrl(value = "") {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost):11435\/v1\/?$/i.test(String(value || "").trim());
}

function terminalHermesRouting(settings = state.app?.settings || {}) {
  const route = currentHermesRoute(settings);
  return {
    provider: route.provider,
    baseUrl: route.provider === "auto" && isDefaultHermesLocalBaseUrl(route.baseUrl) ? "" : route.baseUrl,
    model: route.model,
    apiKey: settings.localApiKey && settings.localApiKey !== "not-needed" ? settings.localApiKey : ""
  };
}

const APERANT_TERMINAL_SLOTS = ["agent-01", "agent-02", "agent-03", "agent-04", "agent-05", "agent-06"];
const APERANT_MAX_PARALLEL_TASKS = 3;
const APERANT_APP_MODES = ["kanban", "terminals", "insights", "roadmap", "ideation", "changelog", "context", "github", "worktrees"];

function kanbanMaxParallelAgents() {
  const value = Number(state.app?.settings?.kanbanMaxParallelAgents || APERANT_MAX_PARALLEL_TASKS);
  return Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : APERANT_MAX_PARALLEL_TASKS;
}

function kanbanGitEnabled() {
  return Boolean(state.app?.settings?.kanbanGitEnabled);
}

function aperantProviderHealth(provider = selectedAperantProvider()) {
  const settings = state.app?.settings || {};
  const normalized = normalizeAperantProvider(provider);
  if (normalized === "cloud") {
    return state.app?.hasCloudApiKey
      ? { ok: true, label: "Manus ok", detail: hermesProfileLabel(settings.agentProfile || "manus-1.6") }
      : { ok: false, label: "Manus sem chave", detail: "Configure a API key em Settings > Hermes Agent > Manus provider." };
  }
  const route = currentHermesRoute(settings);
  const llama = state.app?.localLlamaState || {};
  if (settings.localLlamaEnabled) {
    const status = String(llama.status || "idle").toLowerCase();
    if (["running", "starting"].includes(status) || settings.localLlamaAutoStart) {
      return {
        ok: true,
        label: status === "running" ? "Hermes ok" : "Hermes autostart",
        detail: `${route.label}${route.baseUrl ? ` · ${route.baseUrl}` : ""}`
      };
    }
    return {
      ok: false,
      label: "Local parado",
      detail: "Inicie o llama.cpp local ou habilite autostart."
    };
  }
  return {
    ok: route.provider === "auto" || Boolean(route.baseUrl),
    label: route.provider === "auto" ? "Hermes config" : "Hermes routing",
    detail: route.baseUrl || "Usando config.yaml/env do Hermes Agent."
  };
}

function ensureAperantProviderReady(provider = selectedAperantProvider()) {
  const health = aperantProviderHealth(provider);
  if (health.ok) {
    return true;
  }
  showToast(`${health.label}: ${health.detail}`);
  openSettingsModal();
  return false;
}

function normalizeAperantProvider(provider) {
  return String(provider || "").toLowerCase() === "cloud" ? "cloud" : "local";
}

function setAperantProvider(provider) {
  const normalized = normalizeAperantProvider(provider || state.aperantProvider || activeProvider());
  state.aperantProvider = normalized;
  localStorage.setItem("dream.aperantProvider", normalized);
  for (const select of [elements.kanbanProviderInput, elements.multiAgentProviderSelect, elements.agentProviderInput]) {
    if (select && select.value !== normalized) {
      select.value = normalized;
    }
  }
  return normalized;
}

function selectedAperantProvider() {
  return normalizeAperantProvider(
    elements.multiAgentProviderSelect?.value ||
      elements.kanbanProviderInput?.value ||
      elements.agentProviderInput?.value ||
      state.aperantProvider ||
      activeProvider()
  );
}

function setKanbanQueueActive(active) {
  state.kanbanQueueActive = Boolean(active);
  localStorage.setItem("dream.kanbanQueueActive", state.kanbanQueueActive ? "true" : "false");
  if (elements.kanbanQueueActiveInput) {
    elements.kanbanQueueActiveInput.checked = state.kanbanQueueActive;
  }
  if (elements.kanbanShowArchivedInput) {
    elements.kanbanShowArchivedInput.checked = state.kanbanShowArchived;
  }
  return state.kanbanQueueActive;
}

function setKanbanShowArchived(active) {
  state.kanbanShowArchived = Boolean(active);
  localStorage.setItem("dream.kanbanShowArchived", state.kanbanShowArchived ? "true" : "false");
  if (elements.kanbanShowArchivedInput) {
    elements.kanbanShowArchivedInput.checked = state.kanbanShowArchived;
  }
  return state.kanbanShowArchived;
}

function agentsByTaskId() {
  const map = new Map();
  for (const agent of state.app?.agents || []) {
    if (!agent.taskId) continue;
    const current = map.get(agent.taskId);
    if (!current || Number(agent.updatedAt || 0) > Number(current.updatedAt || 0)) {
      map.set(agent.taskId, agent);
    }
  }
  return map;
}

function runningKanbanTaskCount() {
  let count = 0;
  const taskIdsWithActiveAgents = new Set();
  for (const agent of state.app?.agents || []) {
    if (agent.taskId && ["pending", "running"].includes(String(agent.status || "pending"))) {
      count += 1;
      taskIdsWithActiveAgents.add(agent.taskId);
    }
  }
  for (const task of state.app?.tasks || []) {
    if (visualTaskStatus(task.status) === "in_progress" && !taskIdsWithActiveAgents.has(task.id)) {
      count += 1;
    }
  }
  return count + state.kanbanStartingTaskIds.size;
}

function pendingKanbanTasks() {
  return (state.app?.tasks || [])
    .filter((task) => visualTaskStatus(task.status) === "planning" && !state.kanbanStartingTaskIds.has(task.id))
    .sort((left, right) => {
      const leftRank = String(left.status || "").toLowerCase() === "queue" ? 0 : 1;
      const rightRank = String(right.status || "").toLowerCase() === "queue" ? 0 : 1;
      return leftRank - rightRank || Number(left.createdAt || 0) - Number(right.createdAt || 0);
    });
}

function hasAperantLiveActivity() {
  if (APERANT_APP_MODES.includes(state.appMode) || state.kanbanQueueActive || state.kanbanQueueProcessing) {
    return true;
  }
  return (state.app?.agents || []).some((agent) => ["pending", "running"].includes(String(agent.status || "pending"))) ||
    (state.app?.tasks || []).some((task) => visualTaskStatus(task.status) === "in_progress") ||
    (state.app?.terminalSessions || []).some((terminal) => ["running", "open"].includes(String(terminal.status || "").toLowerCase()));
}

function showKanbanAccessRequired() {
  showToast("Ative acesso total em Settings para o Hermes iniciar agentes.");
  openSettingsModal();
}

function terminalSlotName(index) {
  return APERANT_TERMINAL_SLOTS[index] || `agent-${String(index + 1).padStart(2, "0")}`;
}

function sortedTerminalSessions() {
  const rank = new Map(APERANT_TERMINAL_SLOTS.map((slot, index) => [slot, index]));
  return [...(state.app?.terminalSessions || [])].sort((left, right) => {
    const leftRank = rank.has(left.id) ? rank.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(right.id) ? rank.get(right.id) : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function nextTerminalSlot() {
  const sessions = state.app?.terminalSessions || [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  for (const slot of APERANT_TERMINAL_SLOTS) {
    const session = sessionById.get(slot);
    if (!session || !session.alive) {
      return slot;
    }
  }
  return terminalSlotName(sessions.length);
}

function normalizeAppMode(mode) {
  return ["home", "chat", ...APERANT_APP_MODES].includes(String(mode || "").toLowerCase())
    ? String(mode || "").toLowerCase()
    : "home";
}

function setAppMode(mode) {
  state.appMode = normalizeAppMode(mode);
  if (state.appMode !== "chat") {
    state.panelOpen = false;
  }
  renderAll();
}

function updateHomeDockMagnification(activeIndex = -1) {
  const dockApps = Array.from(elements.homeDock?.querySelectorAll(".home-dock-app") || []);
  dockApps.forEach((app, index) => {
    const distance = activeIndex < 0 ? Number.POSITIVE_INFINITY : Math.abs(index - activeIndex);
    app.classList.toggle("is-hovered", distance === 0);
    app.classList.toggle("is-neighbor", distance === 1);
    app.classList.toggle("is-outer-neighbor", distance === 2);
  });
}

function openHomeTarget(target = "") {
  const normalized = String(target || "").toLowerCase();
  if (normalized === "settings") {
    setAppMode("home");
    openSettingsModal();
    return;
  }
  if (normalized === "kanban") {
    setAppMode("kanban");
    return;
  }
  setAppMode("chat");
}

const HOME_DASHBOARD_HISTORY_LIMIT = 42;
const HOME_DASHBOARD_POLL_MS = 1500;
const HOME_TOKEN_STREAM_WINDOW_MS = 2500;
const HOME_TOKEN_STREAM_STALE_MS = 60000;
const HOME_TOKEN_HISTORY_INTERVAL_MS = 300;
const HOME_DASHBOARD_LAYOUT = {
  vitals: { anchor: "tl", x: 36, y: 46 },
  tokens: { anchor: "tr", x: 36, y: 46 },
  signal: { anchor: "tc", x: 0, y: 40 },
  metrics: { anchor: "ml", x: 36, y: 0 },
  throughput: { anchor: "mr", x: 36, y: 0 },
  terminal: { anchor: "bl", x: 42, y: 34 },
  activity: { anchor: "br", x: 42, y: 34 }
};

function finiteMetric(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFiniteMetric(...values) {
  for (const value of values) {
    const numeric = finiteMetric(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function clampMetric(value, min = 0, max = 100) {
  const numeric = finiteMetric(value);
  return numeric === null ? null : Math.max(min, Math.min(max, numeric));
}

function pushDashboardHistory(key, value) {
  const numeric = finiteMetric(value);
  if (numeric === null) {
    return;
  }
  const history = state.homeDashboard.history[key];
  if (!Array.isArray(history)) {
    return;
  }
  history.push(numeric);
  if (history.length > HOME_DASHBOARD_HISTORY_LIMIT) {
    history.splice(0, history.length - HOME_DASHBOARD_HISTORY_LIMIT);
  }
}

function updateHomePeakTps(value) {
  const numeric = finiteMetric(value);
  if (numeric === null || numeric <= 0) {
    return finiteMetric(state.homeDashboard.peakTps);
  }
  state.homeDashboard.peakTps = Math.max(finiteMetric(state.homeDashboard.peakTps) || 0, numeric);
  return state.homeDashboard.peakTps;
}

function formatMetricPercent(value) {
  const numeric = finiteMetric(value);
  return numeric === null ? "--" : `${Math.round(numeric)}%`;
}

function formatMetricBytes(bytes, precision = 1) {
  const numeric = finiteMetric(bytes);
  if (numeric === null) {
    return "--";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, numeric);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : precision;
  return `${amount.toFixed(decimals)}${units[unitIndex]}`;
}

function formatMetricNumber(value, suffix = "", precision = 1) {
  const numeric = finiteMetric(value);
  return numeric === null ? "--" : `${numeric.toFixed(precision)}${suffix}`;
}

function setText(node, value) {
  if (node) {
    node.textContent = String(value);
  }
}

function ensureDashboardBars(container, count = 14) {
  if (!container) {
    return [];
  }
  while (container.children.length < count) {
    container.appendChild(document.createElement("span"));
  }
  while (container.children.length > count) {
    container.removeChild(container.lastChild);
  }
  return Array.from(container.children);
}

function renderDashboardBars(container, values, count = 14) {
  const bars = ensureDashboardBars(container, count);
  const slice = Array.isArray(values) ? values.slice(-count) : [];
  const padded = Array.from({ length: count }, (_, index) => slice[index - (count - slice.length)]);
  bars.forEach((bar, index) => {
    const value = clampMetric(padded[index]);
    bar.style.height = value === null ? "4%" : `${Math.max(6, value)}%`;
    bar.style.opacity = value === null ? "0.22" : "0.78";
  });
}

function setupDashboardCanvas(canvas) {
  if (!canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round((rect.width || canvas.width || 240) * dpr));
  const height = Math.max(1, Math.round((rect.height || canvas.height || 72) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    ctx,
    width: width / dpr,
    height: height / dpr
  };
}

function cssThemeValue(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function cssColorWithAlpha(color, alpha, fallback) {
  const value = String(color || "").trim();
  const hex = hexToRgba(value, alpha);
  if (hex) {
    return hex;
  }
  const rgb = value.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (rgb) {
    return `rgba(${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])},${alpha})`;
  }
  return fallback;
}

function homeCanvasAccent() {
  return cssThemeValue("--acc-hi", "#ff4d5f");
}

function homeCanvasAccentFill(alpha = 0.16) {
  return cssColorWithAlpha(cssThemeValue("--acc", "#ff3045"), alpha, `rgba(255,48,69,${alpha})`);
}

function drawChartGrid(ctx, width, height) {
  ctx.strokeStyle = homeCanvasAccentFill(0.085);
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = 1; i < 5; i += 1) {
    const x = (width / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawDashboardSeries(ctx, data, width, height, color, fillColor, maxValue = 100) {
  const values = (Array.isArray(data) ? data : []).filter((value) => finiteMetric(value) !== null);
  if (values.length < 2) {
    return false;
  }
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: height - (clampMetric(value, 0, maxValue) / maxValue) * (height - 8) - 4
  }));

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.lineTo(points[0].x, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  return true;
}

function dashboardChartData(data, fallback, minPoints = 6, minRange = 2) {
  const values = (Array.isArray(data) ? data : [])
    .map((value) => finiteMetric(value))
    .filter((value) => value !== null);
  if (values.length < minPoints) {
    return fallback;
  }
  const range = Math.max(...values) - Math.min(...values);
  return range < minRange ? fallback : data;
}

function drawThroughputChart() {
  const setup = setupDashboardCanvas(elements.opsThroughputCanvas);
  if (!setup) {
    return;
  }
  const { ctx, width, height } = setup;
  const { cpu, gpu } = state.homeDashboard.history;
  const cpuData = dashboardChartData(cpu, [42, 34, 36, 48, 39, 44, 43, 46, 41, 53, 47, 50, 48]);
  const gpuData = dashboardChartData(gpu, [18, 20, 22, 28, 30, 31, 29, 33, 35, 74, 96, 96, 96]);
  const accent = homeCanvasAccent();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(12,0,3,0.30)";
  ctx.fillRect(0, 0, width, height);
  drawChartGrid(ctx, width, height);
  drawDashboardSeries(ctx, gpuData, width, height, "#ffb13b", "rgba(255,177,59,0.14)");
  drawDashboardSeries(ctx, cpuData, width, height, accent, homeCanvasAccentFill(0.18));
}

function drawSignalChart() {
  const setup = setupDashboardCanvas(elements.opsSignalCanvas);
  if (!setup) {
    return;
  }
  const { ctx, width, height } = setup;
  const latency = state.homeDashboard.history.latency;
  const fallbackLatency = [26, 18, 22, 15, 31, 19, 17, 21, 14, 16, 12, 11, 9, 8];
  const signalData = dashboardChartData(latency, fallbackLatency, 5, 1);
  const maxValue = Math.max(40, ...signalData.filter((value) => finiteMetric(value) !== null));
  const accent = homeCanvasAccent();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(12,0,3,0.30)";
  ctx.fillRect(0, 0, width, height);
  drawChartGrid(ctx, width, height);
  drawDashboardSeries(ctx, signalData, width, height, accent, homeCanvasAccentFill(0.16), maxValue);
}

function parseTokenTelemetryText(text = "") {
  const source = String(text || "");
  if (!source) {
    return null;
  }
  const tpsPatterns = [
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:tok\/s|tokens?\/s)/i,
    /(?:tokens?\s+per\s+second|tps|eval\s+rate)\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)/i
  ];
  const totalPatterns = [
    /(?:total_tokens|total\s+tokens|eval\s+count|completion\s+tokens)\s*[:=]\s*([0-9]+)/i,
    /([0-9]+)\s+tokens?\s+(?:generated|processed|evaluated)/i
  ];
  const telemetry = {};
  for (const pattern of tpsPatterns) {
    const match = source.match(pattern);
    if (match) {
      telemetry.tokensPerSecond = Number(match[1].replace(",", "."));
      break;
    }
  }
  for (const pattern of totalPatterns) {
    const match = source.match(pattern);
    if (match) {
      telemetry.totalTokens = Number(match[1]);
      break;
    }
  }
  return finiteMetric(telemetry.tokensPerSecond) !== null || finiteMetric(telemetry.totalTokens) !== null
    ? telemetry
    : null;
}

function tokenTelemetryFromLogs() {
  const chunks = [
    ...(state.app?.localLlamaState?.logs || []),
    ...(state.app?.terminalSessions || []).flatMap((session) => [session.stdoutTail, session.stderrTail]),
    ...(state.app?.backgroundProcesses || []).flatMap((job) => [job.stdoutTail, job.stderrTail])
  ].filter(Boolean);
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const parsed = parseTokenTelemetryText(chunks[index]);
    if (parsed) {
      return {
        ...parsed,
        source: "runtime_logs"
      };
    }
  }
  return null;
}

function dashboardTokenModelFallback() {
  const settings = state.app?.settings || {};
  const route = currentHermesRoute(settings);
  if (!routeUsesLocalEndpoint(settings)) {
    return String(route.model || route.label || "").trim();
  }
  return String(state.app?.localLlamaState?.model || route.model || settings.localModel || "").trim();
}

function estimateDashboardTokenCount(text = "") {
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

function roundDashboardMetric(value, precision = 1) {
  const numeric = finiteMetric(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function resetHomeTokenStream(meta = {}) {
  const now = Date.now();
  state.homeDashboard.liveTokens = {
    active: true,
    chatId: String(meta.chatId || "").trim(),
    messageId: String(meta.messageId || "").trim(),
    model: String(meta.model || dashboardTokenModelFallback() || "").trim(),
    startedAt: now,
    updatedAt: now,
    totalTokens: 0,
    tokensPerSecond: 0,
    lastHistoryAt: 0,
    samples: [{ sampledAt: now, tokens: 0 }]
  };
}

function recordHomeTokenDelta(delta = "", meta = {}) {
  const tokenCount = estimateDashboardTokenCount(delta);
  if (!tokenCount) {
    return;
  }
  const now = Date.now();
  const chatId = String(meta.chatId || "").trim();
  const messageId = String(meta.messageId || "").trim();
  const live = state.homeDashboard.liveTokens || {};
  const isNewChat = chatId && live.chatId && live.chatId !== chatId;
  const isNewMessage = messageId && live.messageId && live.messageId !== messageId;
  const isStale = live.updatedAt && now - live.updatedAt > HOME_TOKEN_STREAM_STALE_MS;
  if (!live.active || isNewChat || isNewMessage || isStale || !Array.isArray(live.samples)) {
    resetHomeTokenStream(meta);
  }

  const next = state.homeDashboard.liveTokens;
  if (chatId) {
    next.chatId = chatId;
  }
  if (messageId) {
    next.messageId = messageId;
  }
  if (meta.model && !next.model) {
    next.model = String(meta.model).trim();
  }

  next.active = true;
  next.updatedAt = now;
  next.totalTokens += tokenCount;
  next.samples.push({
    sampledAt: now,
    tokens: next.totalTokens
  });
  while (next.samples.length > 1 && now - next.samples[0].sampledAt > HOME_TOKEN_STREAM_WINDOW_MS) {
    next.samples.shift();
  }

  const firstSample = next.samples[0] || { sampledAt: next.startedAt, tokens: 0 };
  const windowSeconds = Math.max(0.001, (now - firstSample.sampledAt) / 1000);
  const windowTokens = Math.max(0, next.totalTokens - firstSample.tokens);
  const averageSeconds = Math.max(0.001, (now - next.startedAt) / 1000);
  const averageTps = next.totalTokens / averageSeconds;
  const tps = windowTokens > 0 ? windowTokens / windowSeconds : averageTps;
  next.tokensPerSecond = roundDashboardMetric(tps, 1);
  updateHomePeakTps(next.tokensPerSecond);

  if (now - (next.lastHistoryAt || 0) >= HOME_TOKEN_HISTORY_INTERVAL_MS) {
    pushDashboardHistory("tps", next.tokensPerSecond);
    next.lastHistoryAt = now;
  }
  if (state.appMode === "home" && now - (next.lastRenderAt || 0) >= 80) {
    renderHomeDashboard();
    next.lastRenderAt = now;
  }
}

function finishHomeTokenStream(meta = {}) {
  const live = state.homeDashboard.liveTokens || {};
  const chatId = String(meta.chatId || "").trim();
  if (!live.updatedAt || (chatId && live.chatId && live.chatId !== chatId)) {
    return;
  }
  live.active = false;
  live.updatedAt = Date.now();
  if (state.appMode === "home") {
    renderHomeDashboard();
  }
}

function updateHomeTokenTelemetryFromRuntimeEvent(payload = {}) {
  const event = payload?.event || {};
  const type = String(event.type || "").toLowerCase();
  const chatId = String(payload?.chatId || "").trim();
  if (type === "text_delta") {
    recordHomeTokenDelta(event.delta || event.content || "", {
      chatId,
      messageId: event.messageId,
      model: event.model
    });
    return;
  }
  if (
    type === "message_final" ||
    type === "stopped" ||
    type === "error" ||
    (type === "task_state_changed" && String(event.status || "").toLowerCase() !== "running")
  ) {
    finishHomeTokenStream({ chatId });
  }
}

function currentLiveTokenTelemetry() {
  const live = state.homeDashboard.liveTokens || {};
  const sampledAt = finiteMetric(live.updatedAt);
  if (!sampledAt || Date.now() - sampledAt > HOME_TOKEN_STREAM_STALE_MS) {
    return null;
  }
  return {
    sampledAt,
    tokensPerSecond: finiteMetric(live.tokensPerSecond),
    totalTokens: finiteMetric(live.totalTokens),
    model: String(live.model || dashboardTokenModelFallback() || "").trim(),
    source: "runtime_text_delta",
    serverStatus: live.active ? "running" : "stopped",
    active: Boolean(live.active)
  };
}

function currentTokenTelemetry() {
  const settings = state.app?.settings || {};
  const localRoute = routeUsesLocalEndpoint(settings);
  const route = currentHermesRoute(settings);
  const direct = localRoute ? state.homeDashboard.metrics?.tokens || {} : {};
  const live = currentLiveTokenTelemetry() || {};
  const fromLogs = localRoute ? tokenTelemetryFromLogs() || {} : {};
  const sampledAt = finiteMetric(direct.sampledAt);
  const hasDirect = sampledAt !== null && sampledAt > 0;
  const liveSampledAt = finiteMetric(live.sampledAt);
  const hasLive = liveSampledAt !== null && liveSampledAt > 0;
  const liveTps = finiteMetric(live.tokensPerSecond);
  const directTps = finiteMetric(direct.tokensPerSecond);
  const preferLive =
    hasLive &&
    (live.active ||
      !hasDirect ||
      liveSampledAt >= sampledAt ||
      directTps === null ||
      (liveTps !== null && liveTps > 0 && directTps === 0));
  const tokensPerSecond = preferLive
    ? firstFiniteMetric(live.tokensPerSecond, direct.tokensPerSecond, fromLogs.tokensPerSecond)
    : hasDirect
    ? firstFiniteMetric(direct.tokensPerSecond, live.tokensPerSecond, fromLogs.tokensPerSecond)
    : firstFiniteMetric(live.tokensPerSecond, fromLogs.tokensPerSecond, direct.tokensPerSecond);
  const totalTokens = preferLive
    ? firstFiniteMetric(live.totalTokens, direct.totalTokens, fromLogs.totalTokens)
    : hasDirect
    ? firstFiniteMetric(direct.totalTokens, live.totalTokens, fromLogs.totalTokens)
    : firstFiniteMetric(live.totalTokens, fromLogs.totalTokens, direct.totalTokens);
  const model = localRoute
    ? (preferLive ? String(live.model || "").trim() : "") ||
      String(direct.model || "").trim() ||
      String(live.model || "").trim() ||
      dashboardTokenModelFallback()
    : String(live.model || route.model || route.label || "").trim();
  const directStatus = localRoute ? String(direct.serverStatus || "").trim() : "";
  const runtimeStatus = localRoute ? String(state.app?.localLlamaState?.status || "").trim() : "";
  const serverStatus = localRoute
    ? [directStatus, runtimeStatus, live.serverStatus].some(isLlamaRunningStatus)
      ? "running"
      : (preferLive && live.serverStatus) || directStatus || runtimeStatus || "idle"
    : live.active
      ? "running"
      : "cloud";
  return {
    tokensPerSecond,
    totalTokens,
    model,
    source: preferLive ? live.source : hasDirect ? direct.source || "openai_usage" : live.source || fromLogs.source || "",
    serverStatus,
    serverLatencyMs: firstFiniteMetric(direct.serverLatencyMs)
  };
}

function homeActivityTime(timestamp) {
  const numeric = finiteMetric(timestamp);
  if (!numeric) {
    return "--";
  }
  const date = new Date(numeric);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function collectHomeActivityItems() {
  const items = [];
  const add = (title, detail, timestamp, tone = "ok") => {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) {
      return;
    }
    items.push({
      title: cleanTitle,
      detail: String(detail || "").trim(),
      timestamp: finiteMetric(timestamp) || Date.now(),
      tone
    });
  };

  for (const event of (currentChat()?.localEvents || []).slice(-14)) {
    const action = event?.action || {};
    add(
      actionDisplayName(action) || String(action.type || "local"),
      artifactSummaryForEvent(event) || event.result || event.content || "",
      event.timestamp,
      event.ok === false ? "error" : "ok"
    );
  }

  for (const session of (state.app?.terminalSessions || []).slice(0, 6)) {
    const lastLine = String(session.stderrTail || session.stdoutTail || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    add(
      `terminal ${session.id || "session"}`,
      session.currentCommand || lastLine || session.promptState || "",
      session.updatedAt || session.lastOutputAt || session.startedAt,
      session.alive ? "running" : "muted"
    );
  }

  for (const job of (state.app?.backgroundProcesses || []).slice(0, 6)) {
    const lastLine = String(job.stderrTail || job.stdoutTail || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    add(
      `job ${job.id || job.name || "background"}`,
      job.command || lastLine || job.status || "",
      job.updatedAt || job.startedAt,
      String(job.status || "").toLowerCase().includes("error") ? "error" : "running"
    );
  }

  for (const task of (state.app?.tasks || []).slice(0, 8)) {
    add(
      `task ${task.title || task.id || ""}`,
      statusLabel(task.status),
      task.updatedAt || task.createdAt,
      String(task.status || "").toLowerCase() === "error" ? "error" : "muted"
    );
  }

  const previewErrors = state.previewHarness.pageErrors || [];
  for (const error of previewErrors.slice(-4)) {
    add("preview error", error.message || error.text || String(error), error.timestamp || Date.now(), "error");
  }

  return items
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 8);
}

function renderHomeActivity() {
  if (!elements.opsActivityBody) {
    return;
  }
  const items = collectHomeActivityItems();
  elements.opsActivityBody.innerHTML = items.length
    ? items.map((item) => {
        const color = item.tone === "error" ? "#ff5f57" : item.tone === "running" ? "#ffb020" : "#ff4b4b";
        return `
          <div class="ops-feed-item">
            <i class="ops-feed-dot" style="background:${color};box-shadow:0 0 8px ${color}"></i>
            <div>
              <div class="ops-feed-title">${escapeHtml(item.title)}</div>
              <div class="ops-feed-detail">${escapeHtml(shortText(item.detail || "atividade registrada", 120))}</div>
            </div>
            <time class="ops-feed-time">${escapeHtml(homeActivityTime(item.timestamp))}</time>
          </div>
        `;
      }).join("")
    : `
      <div class="ops-feed-item">
        <i class="ops-feed-dot"></i>
        <div>
          <div class="ops-feed-title">sem atividade recente</div>
          <div class="ops-feed-detail">aguardando logs reais do runtime</div>
        </div>
        <time class="ops-feed-time">--</time>
      </div>
    `;
}

function homeTerminalLines() {
  const settings = state.app?.settings || {};
  const llama = state.app?.localLlamaState || {};
  const route = currentHermesRoute(settings);
  const localRoute = routeUsesLocalEndpoint(settings);
  const provider = String(route.label || route.provider || "Hermes").toUpperCase();
  const llamaStatus = localRoute
    ? String(llama.status || (settings.localLlamaEnabled ? "idle" : "disabled")).toUpperCase()
    : "CLOUD";
  const metricsStatus = state.homeDashboard.metrics ? "LIVE METRICS ONLINE" : "WAITING METRICS";
  return [
    "> SIGNAL ACQUIRED",
    "> DREAM SERVER status ON",
    `> PROVIDER ${provider}`,
    `> LLAMA ${llamaStatus}`,
    `> ${metricsStatus}`
  ];
}

function isLlamaRunningStatus(status = "") {
  return String(status || "").toLowerCase() === "running";
}

function displayTokenTps(tokenTelemetry = currentTokenTelemetry()) {
  const measured = finiteMetric(tokenTelemetry.tokensPerSecond);
  if (measured !== null) {
    return measured;
  }
  return isLlamaRunningStatus(tokenTelemetry.serverStatus) ? 0 : null;
}

function homeTerminalHeartbeatLine() {
  const now = new Date();
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  const metrics = state.homeDashboard.metrics || {};
  const memory = metrics.memory || {};
  const ramUsed = formatMetricBytes(memory.usedBytes, 1);
  return [
    `> HEARTBEAT ${clock}`,
    `CPU ${formatMetricPercent(metrics.cpu?.percent)}`,
    `RAM ${ramUsed === "--" ? formatMetricPercent(memory.percent) : ramUsed}`
  ].join(" ");
}

function renderHomeTerminalTick() {
  if (!elements.opsTerminalBody) {
    return;
  }
  const dash = state.homeDashboard;
  const lines = homeTerminalLines();
  const signature = lines.join("\n");
  if (dash.terminalLines.join("\n") !== signature) {
    dash.terminalLines = lines;
    dash.terminalLineIndex = Math.min(dash.terminalLineIndex, Math.max(0, lines.length - 1));
    dash.terminalCharIndex = Math.min(dash.terminalCharIndex, String(lines[dash.terminalLineIndex] || "").length);
  }

  const lineIndex = dash.terminalLineIndex;
  const charIndex = dash.terminalCharIndex;
  const visible = [
    ...lines.slice(0, lineIndex),
    String(lines[lineIndex] || "").slice(0, charIndex)
  ].join("\n");

  if (lineIndex >= lines.length - 1 && charIndex >= String(lines[lineIndex] || "").length) {
    elements.opsTerminalBody.innerHTML = `${escapeHtml(visible)}\n${escapeHtml(homeTerminalHeartbeatLine())}<span class="ops-terminal-caret"></span>`;
    return;
  }
  elements.opsTerminalBody.innerHTML = `${escapeHtml(visible)}<span class="ops-terminal-caret"></span>`;
  const current = String(lines[lineIndex] || "");
  if (charIndex < current.length) {
    dash.terminalCharIndex += 1;
  } else {
    dash.terminalLineIndex += 1;
    dash.terminalCharIndex = 0;
  }
}

function updateHomeDashboardHistories(metrics) {
  const tokenTelemetry = currentTokenTelemetry();
  pushDashboardHistory("cpu", metrics?.cpu?.percent);
  pushDashboardHistory("gpu", metrics?.gpu?.percent);
  pushDashboardHistory("ram", metrics?.memory?.percent);
  if (finiteMetric(metrics?.gpu?.memoryUsedBytes) !== null && finiteMetric(metrics?.gpu?.memoryTotalBytes) > 0) {
    pushDashboardHistory("vram", (metrics.gpu.memoryUsedBytes / metrics.gpu.memoryTotalBytes) * 100);
  }
  pushDashboardHistory("tps", displayTokenTps(tokenTelemetry));
  pushDashboardHistory("latency", tokenTelemetry.serverLatencyMs);
}

function renderHomeDashboard() {
  if (!elements.homeOpsDashboard) {
    return;
  }
  const metrics = state.homeDashboard.metrics || {};
  const settings = state.app?.settings || {};
  const route = currentHermesRoute(settings);
  const localRoute = routeUsesLocalEndpoint(settings);
  const cpu = metrics.cpu || {};
  const memory = metrics.memory || {};
  const gpu = metrics.gpu || {};
  const tokenTelemetry = currentTokenTelemetry();
  const shownTps = displayTokenTps(tokenTelemetry);
  const peakTps = updateHomePeakTps(shownTps);
  const ramUsed = formatMetricBytes(memory.usedBytes, 1);
  const ramTotal = formatMetricBytes(memory.totalBytes, 1);
  const vramPercent =
    finiteMetric(gpu.memoryUsedBytes) !== null && finiteMetric(gpu.memoryTotalBytes) > 0
      ? (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100
      : null;

  setText(elements.opsCpuVal, formatMetricPercent(cpu.percent));
  setText(elements.opsRamVal, formatMetricPercent(memory.percent));
  setText(elements.opsRamGb, ramUsed !== "--" && ramTotal !== "--" ? `${ramUsed} / ${ramTotal}` : "RAM");
  setText(elements.opsCpuCores, cpu.cores || "--");
  setText(elements.opsCpuTemp, finiteMetric(cpu.temperatureC) === null ? "INDISP." : formatMetricNumber(cpu.temperatureC, "C", 1));
  setText(elements.opsTpsVal, formatMetricNumber(shownTps, "", 1));
  setText(elements.opsTokenTotal, finiteMetric(peakTps) === null || peakTps <= 0 ? "--" : `${formatMetricNumber(peakTps, "", 1)} TOK/S`);
  setText(elements.opsTokenModel, tokenTelemetry.model || "--");
  setText(elements.opsLlamaPing, finiteMetric(tokenTelemetry.serverLatencyMs) === null ? "--" : `${Math.round(tokenTelemetry.serverLatencyMs)}ms`);
  setText(elements.opsLlamaStatus, localRoute
    ? String(tokenTelemetry.serverStatus || state.app?.localLlamaState?.status || "idle").toUpperCase()
    : String(tokenTelemetry.serverStatus || "cloud").toUpperCase());
  setText(elements.opsLlamaBase, localRoute
    ? state.app?.localLlamaState?.baseUrl || route.baseUrl || "--"
    : route.baseUrl || route.label || "--");
  setText(elements.opsVramVal, formatMetricPercent(vramPercent));
  setText(elements.opsGpuLoadVal, formatMetricPercent(gpu.percent));
  setText(elements.opsGpuName, gpu.name || "INDISP.");
  setText(elements.opsGpuTemp, finiteMetric(gpu.temperatureC) === null ? "INDISP." : formatMetricNumber(gpu.temperatureC, "C", 1));
  setText(elements.opsCpuLineVal, formatMetricPercent(cpu.percent));
  setText(elements.opsGpuLineVal, finiteMetric(gpu.percent) === null ? "INDISP." : formatMetricPercent(gpu.percent));

  const circumference = 263.89;
  const tpsValue = clampMetric(shownTps, 0, 120);
  if (elements.opsTpsArc) {
    elements.opsTpsArc.style.strokeDashoffset =
      tpsValue === null ? String(circumference) : String(circumference * (1 - tpsValue / 120));
  }

  renderDashboardBars(elements.opsCpuBars, state.homeDashboard.history.cpu);
  renderDashboardBars(elements.opsVramBars, state.homeDashboard.history.vram);
  renderDashboardBars(elements.opsGpuBars, state.homeDashboard.history.gpu);
  drawThroughputChart();
  drawSignalChart();
  renderHomeActivity();
}

async function pollHomeDashboard() {
  if (state.homeDashboard.polling || state.appMode !== "home") {
    return;
  }
  state.homeDashboard.polling = true;
  try {
    const metrics = await window.manusDesktop.getSystemDashboard?.();
    if (metrics) {
      state.homeDashboard.metrics = metrics;
      updateHomeDashboardHistories(metrics);
      renderHomeDashboard();
    }
  } catch (error) {
    state.homeDashboard.metrics = null;
    renderHomeDashboard();
  } finally {
    state.homeDashboard.polling = false;
  }
}

function homeWindowStorageKey(win) {
  const id = String(win?.dataset?.opsId || win?.id || "").trim();
  return id ? `dream.home.opsWindow.${id}` : "";
}

function currentHomeCardScale() {
  return finiteMetric(elements.homeOpsDashboard?.style.getPropertyValue("--ops-card-scale")) || 1;
}

function scaledHomeWindowSize(win) {
  const scale = currentHomeCardScale();
  return {
    width: win.offsetWidth * scale,
    height: win.offsetHeight * scale
  };
}

function clampHomeWindowPosition(win, x, y) {
  const size = scaledHomeWindowSize(win);
  const maxX = Math.max(0, window.innerWidth - size.width);
  const maxY = Math.max(0, window.innerHeight - size.height);
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y))
  };
}

function applyHomeWindowPosition(win, x, y, options = {}) {
  const clamped = clampHomeWindowPosition(win, x, y);
  win.style.left = `${Math.round(clamped.x)}px`;
  win.style.top = `${Math.round(clamped.y)}px`;
  win.style.right = "auto";
  win.style.bottom = "auto";
  win.style.marginLeft = "0";
  win.classList.toggle("is-user-positioned", options.user !== false);
}

function saveHomeWindowPosition(win) {
  const key = homeWindowStorageKey(win);
  if (!key) {
    return;
  }
  const rect = win.getBoundingClientRect();
  const clamped = clampHomeWindowPosition(win, rect.left, rect.top);
  localStorage.setItem(key, JSON.stringify(clamped));
}

function restoreHomeWindowPositions() {
  const windows = Array.from(elements.homeOpsDashboard?.querySelectorAll(".ops-window") || []);
  for (const win of windows) {
    const key = homeWindowStorageKey(win);
    if (!key) {
      continue;
    }
    const raw = localStorage.getItem(key);
    if (!raw) {
      continue;
    }
    try {
      const saved = JSON.parse(raw);
      const x = finiteMetric(saved?.x);
      const y = finiteMetric(saved?.y);
      if (x !== null && y !== null) {
        applyHomeWindowPosition(win, x, y);
      }
    } catch {}
  }
}

function homeDashboardScale() {
  const widthFit = Math.max(0.62, (window.innerWidth - 52) / 1680);
  const heightFit = Math.max(0.62, (window.innerHeight - 28) / 940);
  return Math.min(1, Math.max(0.62, Math.min(widthFit, heightFit)));
}

function shouldUseSavedHomeWindowPositions(scale) {
  return scale >= 0.92 && window.innerWidth >= 1080 && window.innerHeight >= 660;
}

function readHomeWindowPosition(win) {
  const key = homeWindowStorageKey(win);
  if (!key) {
    return null;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    const x = finiteMetric(saved?.x);
    const y = finiteMetric(saved?.y);
    return x !== null && y !== null ? { x, y } : null;
  } catch {
    return null;
  }
}

function autoHomeWindowPosition(win, layout, scale) {
  const size = scaledHomeWindowSize(win);
  const pad = Math.max(10, Math.round(34 * scale));
  const top = Math.max(8, Math.round(layout.y * scale));
  const side = Math.max(10, Math.round(layout.x * scale));
  const midY = Math.round((window.innerHeight - size.height) / 2);
  const positions = {
    tl: { x: pad + side, y: pad + top },
    tr: { x: window.innerWidth - size.width - pad - side, y: pad + top },
    tc: { x: (window.innerWidth - size.width) / 2, y: pad + top },
    ml: { x: pad + side, y: midY },
    mr: { x: window.innerWidth - size.width - pad - side, y: midY },
    bl: { x: pad + side, y: window.innerHeight - size.height - pad - top },
    br: { x: window.innerWidth - size.width - pad - side, y: window.innerHeight - size.height - pad - top }
  };
  return positions[layout.anchor] || positions.tl;
}

function layoutHomeDashboardWindows() {
  if (!elements.homeOpsDashboard) {
    return;
  }
  const scale = homeDashboardScale();
  const dockScale = Math.min(1, Math.max(0.66, scale + 0.02));
  elements.homeOpsDashboard.style.setProperty("--home-stage-scale", String(scale));
  elements.homeOpsDashboard.style.setProperty("--ops-card-scale", String(scale));
  elements.homeOpsDashboard.classList.toggle("is-compact", scale < 0.92);
  elements.homeDock?.style.setProperty("--home-dock-scale", String(dockScale));

  const windows = Array.from(elements.homeOpsDashboard.querySelectorAll(".ops-window"));
  for (const win of windows) {
    win.style.left = "";
    win.style.top = "";
    win.style.right = "";
    win.style.bottom = "";
    win.style.marginLeft = "";
    win.classList.remove("is-user-positioned", "is-dragging");
  }
}

function bringHomeWindowToFront(win) {
  const windows = Array.from(elements.homeOpsDashboard?.querySelectorAll(".ops-window") || []);
  const currentMaxZ = windows.reduce((max, entry) => Math.max(max, Number(entry.style.zIndex) || 0), state.homeDashboard.topZ);
  state.homeDashboard.topZ = Math.min(24, Math.max(4, currentMaxZ + 1, state.homeDashboard.topZ + 1));
  if (state.homeDashboard.topZ >= 24) {
    windows.forEach((entry, index) => {
      entry.style.zIndex = String(4 + index);
    });
    state.homeDashboard.topZ = 4 + windows.length;
  }
  win.style.zIndex = String(state.homeDashboard.topZ);
}

function initHomeDashboardDragging() {
  if (state.homeDashboard.dragReady || !elements.homeOpsDashboard) {
    return;
  }
  state.homeDashboard.dragReady = true;
  const windows = Array.from(elements.homeOpsDashboard.querySelectorAll(".ops-window"));
  windows.forEach((win, index) => {
    win.style.zIndex = String(4 + index);
    const titlebar = win.querySelector(".ops-titlebar");
    if (!titlebar) {
      return;
    }
    titlebar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const rect = win.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      bringHomeWindowToFront(win);
      applyHomeWindowPosition(win, rect.left, rect.top);
      win.classList.add("is-dragging");
      titlebar.setPointerCapture?.(event.pointerId);
      event.preventDefault();

      const onMove = (moveEvent) => {
        applyHomeWindowPosition(win, moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
      };
      const onUp = () => {
        win.classList.remove("is-dragging");
        saveHomeWindowPosition(win);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  });
  state.homeDashboard.topZ = Math.max(state.homeDashboard.topZ, 4 + windows.length);

  window.addEventListener("resize", () => {
    layoutHomeDashboardWindows();
    drawThroughputChart();
    drawSignalChart();
  });
}

function startHomeDashboard() {
  if (!elements.homeOpsDashboard) {
    return;
  }
  initHomeDashboardDragging();
  layoutHomeDashboardWindows();
  renderHomeDashboard();
  if (!state.homeDashboard.timer) {
    void pollHomeDashboard();
    state.homeDashboard.timer = setInterval(() => {
      void pollHomeDashboard();
    }, HOME_DASHBOARD_POLL_MS);
  }
  if (!state.homeDashboard.terminalTimer) {
    renderHomeTerminalTick();
    state.homeDashboard.terminalTimer = setInterval(renderHomeTerminalTick, 42);
  }
}

function stopHomeDashboard() {
  if (state.homeDashboard.timer) {
    clearInterval(state.homeDashboard.timer);
    state.homeDashboard.timer = null;
  }
  if (state.homeDashboard.terminalTimer) {
    clearInterval(state.homeDashboard.terminalTimer);
    state.homeDashboard.terminalTimer = null;
  }
}

function statusLabel(status = "") {
  return {
    planning: "Planning",
    backlog: "Planning",
    pending: "Planning",
    queue: "Queue",
    in_progress: "In Progress",
    running: "In Progress",
    ai_review: "AI Review",
    human_review: "Human Review",
    creating_pr: "Creating PR",
    blocked: "Human Review",
    done: "Complete",
    pr_created: "PR Created",
    archived: "Archived",
    stopped: "Human Review",
    error: "Error",
    idle: "Idle",
    coding: "Coding",
    validation: "Validation",
    plan_review: "Plan Review",
    qa_review: "QA Review",
    qa_fixing: "QA Fixing",
    failed: "Failed",
    complete: "Complete"
  }[String(status || "").toLowerCase()] || String(status || "idle");
}

function effectiveLocale(fallback = "en-US") {
  const locale = String(state.app?.settings?.locale || state.app?.hostInfo?.locale || navigator.language || fallback)
    .trim()
    .replace("_", "-");
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : fallback;
}

function visualTaskStatus(status = "") {
  const normalized = String(status || "backlog").toLowerCase();
  return {
    pending: "planning",
    backlog: "planning",
    queue: "planning",
    planning: "planning",
    running: "in_progress",
    in_progress: "in_progress",
    coding: "in_progress",
    ai_review: "ai_review",
    qa_review: "ai_review",
    qa_fixing: "ai_review",
    plan_review: "human_review",
    blocked: "human_review",
    stopped: "human_review",
    error: "human_review",
    creating_pr: "in_progress",
    human_review: "human_review",
    pr_created: "done",
    archived: "archived",
    done: "done"
  }[normalized] || "planning";
}

function kanbanColumnLabel(status = "") {
  return {
    planning: "Planning",
    in_progress: "In Progress",
    ai_review: "AI Review",
    human_review: "Human Review",
    done: "Done",
    archived: "Archived"
  }[status] || statusLabel(status);
}

function kanbanProgress(status = "") {
  return {
    planning: 0,
    backlog: 0,
    pending: 0,
    queue: 12,
    in_progress: 45,
    running: 45,
    ai_review: 72,
    human_review: 88,
    blocked: 88,
    creating_pr: 96,
    error: 88,
    done: 100,
    pr_created: 100,
    archived: 100,
    stopped: 100
  }[String(status || "").toLowerCase()] ?? 0;
}

function formatRelativeTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return "now";
  const diffMs = value - Date.now();
  const abs = Math.abs(diffMs);
  const units = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000]
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (abs >= size) {
      return formatter.format(Math.round(diffMs / size), unit);
    }
  }
  return "now";
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat(effectiveLocale(), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp || Date.now()));
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function shortText(value, limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function compactKanbanId(value, limit = 22) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  const [head, ...rest] = text.split("-");
  if (head && rest.length) {
    return shortText(`${head}-${rest.join("-")}`, limit);
  }
  return shortText(text, limit);
}

function kanbanMetaPill(value, limit = 28) {
  const text = String(value || "").trim();
  return text
    ? `<span title="${escapeHtml(text)}">${escapeHtml(compactKanbanId(text, limit))}</span>`
    : "";
}

function pathBaseName(value) {
  const text = String(value || "").replace(/[\\/]+$/g, "");
  if (!text) return "";
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || text;
}

function fileUrl(filePath) {
  return encodeURI(`file:///${String(filePath || "").replace(/\\/g, "/")}`);
}

function isWebUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function projectForChat(chat = currentChat()) {
  const projects = state.app?.projects || [];
  if (!projects.length) {
    return null;
  }
  return projects.find((project) => chat?.id && project.chatId === chat.id) || null;
}

function urlFromText(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>`]+/i);
  return match ? match[0].replace(/[),.;]+$/, "") : "";
}

function isImagePath(value) {
  return /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(String(value || "").trim());
}

function isVideoPath(value) {
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(value || "").trim());
}

function videoContentType(value) {
  const ext = String(value || "").trim().split(".").pop()?.toLowerCase();
  return ({
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    ogv: "video/ogg"
  })[ext] || "video/mp4";
}

function applyAmbientBackground(filePath = "") {
  const rawPath = String(filePath || "").trim();
  const hasCustom = Boolean(rawPath);
  const useImage = hasCustom && isImagePath(rawPath);
  const useVideo = hasCustom && isVideoPath(rawPath);

  if (elements.backgroundMediaLabel) {
    elements.backgroundMediaLabel.textContent = hasCustom
      ? rawPath
      : "Padrao: dream-ambient.mp4";
    elements.backgroundMediaLabel.title = hasCustom ? rawPath : "";
  }

  if (useImage && elements.ambientImage) {
    elements.ambientImage.src = fileUrlFromPath(rawPath);
    elements.ambientImage.hidden = false;
    if (elements.ambientVideo) {
      elements.ambientVideo.pause();
      elements.ambientVideo.hidden = true;
    }
    return;
  }

  if (elements.ambientImage) {
    elements.ambientImage.hidden = true;
    elements.ambientImage.removeAttribute("src");
  }

  if (!elements.ambientVideo) {
    return;
  }

  elements.ambientVideo.hidden = false;
  const nextSrc = useVideo ? fileUrlFromPath(rawPath) : "./assets/dream-ambient.mp4";
  if (elements.ambientVideo.dataset.src !== nextSrc) {
    elements.ambientVideo.dataset.src = nextSrc;
    elements.ambientVideo.innerHTML = `<source src="${escapeHtml(nextSrc)}" type="${useVideo ? videoContentType(rawPath) : "video/mp4"}"/>`;
    elements.ambientVideo.load();
  }
  elements.ambientVideo.play?.().catch(() => {});
}

function fileUrlFromPath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^file:\/\//i.test(raw)) {
    return raw;
  }
  const normalized = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    const [drive, ...parts] = normalized.split("/");
    return `file:///${drive}/${parts.map(encodeURIComponent).join("/")}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized.split("/").map((part, index) => index === 0 ? "" : encodeURIComponent(part)).join("/")}`;
  }
  return `file:///${normalized.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

function previewUrlWithVersion(url = "", version = 0) {
  const raw = String(url || "").trim();
  const numericVersion = Number(version || 0);
  if (!raw || !numericVersion || !/^file:\/\//i.test(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("dreamPreview", String(numericVersion));
    return parsed.toString();
  } catch {
    return raw;
  }
}

function imagePathFromEvent(event = {}) {
  const action = event.action || {};
  const candidates = [
    action.screenshotPath,
    action.imagePath,
    action.path,
    action.outputPath,
    action.artifactPath,
    String(event.result || "").match(/[A-Za-z]:\\[^\r\n"'<>`|]+\.(?:png|jpe?g|webp|gif|bmp|svg)|\/[^\r\n"'<>`|]+\.(?:png|jpe?g|webp|gif|bmp|svg)/i)?.[0]
  ];
  return candidates.find((candidate) => isImagePath(candidate)) || "";
}

function previewTargetForChat(chat = currentChat()) {
  const events = (chat?.localEvents || []).slice().reverse();
  const previewEventTypes = new Set([
    "open_url",
    "browser_check",
    "browser_control",
    "browser_harness",
    "verify_browser_console",
    "verify_url",
    "verify_site",
    "project_prepare_vite",
    "set_preview_device"
  ]);
  for (const event of events) {
    const eventType = String(event?.action?.type || event?.type || "").trim();
    const actionUrl = event?.action?.url;
    const foundUrl = isWebUrl(actionUrl) ? actionUrl : urlFromText(`${event?.result || ""}\n${event?.content || ""}`);
    if (isWebUrl(foundUrl) && previewEventTypes.has(eventType)) {
      return {
        url: foundUrl,
        title: "Preview local",
        status: event.ok === false ? "falhou" : ["browser_control", "browser_harness"].includes(eventType) ? "live" : "detectado",
        timestamp: event.timestamp || 0,
        source: eventType || "event"
      };
    }

    const imagePath = imagePathFromEvent(event);
    if (imagePath) {
      return {
        kind: "image",
        imagePath,
        title: "Screenshot",
        status: event.ok === false ? "falhou" : "capturado",
        timestamp: event.timestamp || 0,
        source: "event"
      };
    }
  }

  const project = projectForChat(chat);
  if (isWebUrl(project?.url)) {
    return {
      url: project.url,
      title: project.name || project.slug || "Preview local",
      status: project.status || "projeto",
      timestamp: project.updatedAt || project.verifiedAt || 0,
      source: "project"
    };
  }

  return null;
}

function setPreviewDeviceMode(mode) {
  state.previewDeviceMode = mode === "mobile" ? "mobile" : "desktop";
  localStorage.setItem("dream.workbench.previewDeviceMode", state.previewDeviceMode);
}

function syncPreviewDeviceModeFromApp() {
  const appMode = String(state.app?.previewDeviceMode || "").trim().toLowerCase();
  if (appMode === "mobile" || appMode === "desktop") {
    setPreviewDeviceMode(appMode);
  }
}

function canUseMobilePreview(target, inlinePreviewHtml) {
  return Boolean(inlinePreviewHtml || target?.url);
}

function buildMobilePreviewPayload(target, inlinePreviewHtml) {
  if (inlinePreviewHtml) {
    return {
      type: "dream-workbench-preview",
      previewKind: "inline-html",
      html: inlinePreviewHtml,
      title: "Preview inline"
    };
  }

  if (target?.url) {
    return {
      type: "dream-workbench-preview",
      previewKind: "url",
      url: target.url,
      title: target.title || "Preview local"
    };
  }

  return null;
}

function makeEmptyPreviewHarness(ownerChatId = currentChatId()) {
  return {
    ownerChatId,
    url: "",
    updatedAt: 0,
    elements: [],
    lastSnapshot: null,
    consoleMessages: [],
    pageErrors: []
  };
}

function previewHarnessBelongsToCurrentChat() {
  const chatId = currentChatId();
  return Boolean(chatId && state.previewHarness.ownerChatId === chatId);
}

function markPreviewWebviewOwner(webview, ownerChatId = state.previewHarness.ownerChatId || currentChatId()) {
  if (webview && ownerChatId) {
    webview.dataset.previewHarnessOwnerChatId = ownerChatId;
  }
}

function previewWebviewBelongsToCurrentChat(webview) {
  const chatId = currentChatId();
  const ownerChatId = webview?.dataset?.previewHarnessOwnerChatId || state.previewHarness.ownerChatId || "";
  return Boolean(chatId && ownerChatId && ownerChatId === chatId);
}

function resetPreviewHarnessForCurrentChat({ blankWebview = true } = {}) {
  state.previewHarness = makeEmptyPreviewHarness(currentChatId());
  state.renderCache.workbench = "";
  state.renderCache.previewSrc = "";
  state.renderCache.mobilePreviewPayload = "";
  if (blankWebview) {
    const webview = activePreviewWebview();
    if (webview) {
      try {
        delete webview.dataset.previewDomReady;
        webview.loadURL("about:blank");
      } catch {}
    }
  }
}

function ensurePreviewHarnessChatScope({ blankOnSwitch = true } = {}) {
  const chatId = currentChatId();
  if (!chatId) {
    return "";
  }
  if (!state.previewHarness.ownerChatId) {
    state.previewHarness.ownerChatId = chatId;
    return chatId;
  }
  if (state.previewHarness.ownerChatId !== chatId) {
    resetPreviewHarnessForCurrentChat({ blankWebview: blankOnSwitch });
  }
  return chatId;
}

async function ensureMobilePreviewService(forceRestart = false) {
  if (state.mobilePreview.service && !forceRestart) {
    return state.mobilePreview.service;
  }
  if (state.mobilePreview.promise) {
    return state.mobilePreview.promise;
  }

  state.mobilePreview.loading = true;
  state.mobilePreview.error = "";
  state.mobilePreview.promise = window.manusDesktop.ensureMobilePreviewService({ forceRestart })
    .then((service) => {
      state.mobilePreview.service = service;
      state.mobilePreview.error = "";
      return service;
    })
    .catch((error) => {
      state.mobilePreview.error = String(error?.message || error || "Falha ao iniciar preview mobile.");
      throw error;
    })
    .finally(() => {
      state.mobilePreview.loading = false;
      state.mobilePreview.promise = null;
      state.renderCache.workbench = "";
      renderWorkbenchPanel();
    });

  return state.mobilePreview.promise;
}

function syncMobilePreviewFrame(frame, payload, service) {
  if (!frame || !payload || !service?.origin) {
    return;
  }

  const dispatch = () => {
    try {
      frame.contentWindow?.postMessage(payload, service.origin);
    } catch {}
  };

  if (!frame.dataset.mobileBound) {
    frame.addEventListener("load", dispatch);
    frame.dataset.mobileBound = "1";
  }

  window.setTimeout(dispatch, 60);
  window.setTimeout(dispatch, 220);
}

function activePreviewWebview() {
  return elements.previewSurface?.querySelector("webview.preview-webview") || null;
}

function pushPreviewHarnessTelemetry(kind, value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return;
  }
  const target = kind === "error" ? state.previewHarness.pageErrors : state.previewHarness.consoleMessages;
  target.push(text.slice(0, 1000));
  while (target.length > 40) {
    target.shift();
  }
}

async function waitForActivePreviewWebview(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const webview = activePreviewWebview();
    if (webview) {
      bindPreviewWebviewTelemetry(webview);
      return webview;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const webview = activePreviewWebview();
  if (webview) {
    bindPreviewWebviewTelemetry(webview);
  }
  return webview;
}

function bindPreviewWebviewTelemetry(webview) {
  markPreviewWebviewOwner(webview);
  if (!webview || webview.dataset.previewHarnessBound) {
    return;
  }
  const update = () => {
    try {
      if (!previewWebviewBelongsToCurrentChat(webview)) {
        return;
      }
      webview.dataset.previewDomReady = "1";
      const currentUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
      if (isWebUrl(currentUrl)) {
        state.previewHarness.url = currentUrl;
        state.previewHarness.updatedAt = Date.now();
      }
    } catch {}
  };
  const resetReady = () => {
    delete webview.dataset.previewDomReady;
  };
  const rememberFailure = (event) => {
    if (!previewWebviewBelongsToCurrentChat(webview)) {
      return;
    }
    if (event?.errorCode && Number(event.errorCode) === -3) {
      return;
    }
    pushPreviewHarnessTelemetry("error", event?.errorDescription || event?.reason || "Falha de carregamento no preview.");
  };
  webview.addEventListener("did-start-loading", resetReady);
  webview.addEventListener("did-navigate", update);
  webview.addEventListener("did-navigate-in-page", update);
  webview.addEventListener("page-title-updated", update);
  webview.addEventListener("dom-ready", update);
  webview.addEventListener("did-fail-load", rememberFailure);
  webview.addEventListener("render-process-gone", rememberFailure);
  webview.addEventListener("console-message", (event) => {
    if (!previewWebviewBelongsToCurrentChat(webview)) {
      return;
    }
    const level = Number(event?.level || 0);
    if (level >= 2) {
      pushPreviewHarnessTelemetry("console", `${event.level}: ${event.message || ""}`);
    }
  });
  webview.dataset.previewHarnessBound = "1";
}

async function probePreviewWebviewScriptReady(webview) {
  if (!webview || typeof webview.executeJavaScript !== "function") {
    return false;
  }
  try {
    await webview.executeJavaScript("Boolean(document && document.readyState)", true);
    webview.dataset.previewDomReady = "1";
    return true;
  } catch {
    return false;
  }
}

function previewUrlsMatch(currentUrl, expectedUrl) {
  const current = String(currentUrl || "").trim();
  const expected = String(expectedUrl || "").trim();
  if (!expected) {
    return true;
  }
  if (!current) {
    return false;
  }
  if (current === expected || current.startsWith(expected) || current.replace(/\/$/, "") === expected.replace(/\/$/, "")) {
    return true;
  }
  try {
    const currentParsed = new URL(current);
    const expectedParsed = new URL(expected);
    return currentParsed.origin === expectedParsed.origin && currentParsed.pathname === expectedParsed.pathname;
  } catch {
    return false;
  }
}

function currentPreviewWebviewUrl(webview) {
  try {
    return typeof webview?.getURL === "function" ? webview.getURL() : "";
  } catch {
    return "";
  }
}

async function waitForPreviewWebviewReady(webview, timeoutMs = 15000, expectedUrl = "") {
  if (!webview) {
    throw new Error("Preview desktop nao esta montado no Workbench.");
  }
  bindPreviewWebviewTelemetry(webview);
  const started = Date.now();
  const waitMs = Math.max(800, timeoutMs);

  while (Date.now() - started < waitMs) {
    const urlMatches = previewUrlsMatch(currentPreviewWebviewUrl(webview), expectedUrl);
    if (urlMatches && (webview.dataset.previewDomReady === "1" || await probePreviewWebviewScriptReady(webview))) {
      return webview;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return webview;
}

function previewSnapshotScript() {
  return `(() => {
    const attrValue = (value) => String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\\"");
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const isUnique = (selector) => {
      try { return selector && document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const selectorFor = (element) => {
      const tag = String(element.tagName || "").toLowerCase();
      if (!tag) return "";
      const id = element.getAttribute("id");
      if (id && window.CSS?.escape) {
        const selector = "#" + window.CSS.escape(id);
        if (isUnique(selector)) return selector;
      }
      for (const name of ["data-testid", "data-test-id", "aria-label", "name", "title", "href"]) {
        const value = element.getAttribute(name);
        if (value) {
          const selector = tag + "[" + name + "=\\"" + attrValue(value) + "\\"]";
          if (isUnique(selector)) return selector;
        }
      }
      const parts = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 6) {
        const nodeTag = String(node.tagName || "").toLowerCase();
        const parent = node.parentElement;
        if (!nodeTag || !parent) break;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        parts.unshift(siblings.length > 1 ? nodeTag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")" : nodeTag);
        node = parent;
      }
      return parts.join(" > ");
    };
    const labelFor = (element, tag) => (
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("value") ||
      element.innerText ||
      element.getAttribute("href") ||
      tag
    ).replace(/\\s+/g, " ").trim().slice(0, 180);
    const interactiveSelector = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "summary",
      "video",
      "canvas",
      "svg",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const landmarkSelector = [
      "canvas",
      "svg",
      "video",
      "iframe",
      "cg-board",
      "chess-board",
      ".cg-wrap",
      ".board",
      "[role='application']",
      "[data-board]",
      "[data-testid*='board']"
    ].join(",");
    const elements = Array.from(document.body?.querySelectorAll(interactiveSelector) || [])
      .filter(isVisible)
      .slice(0, 220)
      .map((element, index) => {
        const tag = String(element.tagName || "").toLowerCase();
        const rect = element.getBoundingClientRect();
        return {
          ref: "@e" + (index + 1),
          tag,
          role: element.getAttribute("role") || "",
          type: element.getAttribute("type") || "",
          href: element.getAttribute("href") || "",
          accessibleName: element.getAttribute("aria-label") || element.getAttribute("title") || "",
          selector: selectorFor(element),
          label: labelFor(element, tag),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      })
      .filter((entry) => entry.label || entry.selector);
    const landmarks = Array.from(document.body?.querySelectorAll(landmarkSelector) || [])
      .filter(isVisible)
      .slice(0, 18)
      .map((element, index) => {
        const tag = String(element.tagName || "").toLowerCase();
        const rect = element.getBoundingClientRect();
        const label = labelFor(element, tag);
        return {
          ref: "@r" + (index + 1),
          tag,
          selector: selectorFor(element),
          label,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      })
      .filter((entry) => entry.rect?.width > 16 && entry.rect?.height > 16);
    const chessRoleFromClass = (className) => {
      const text = String(className || "").toLowerCase();
      for (const role of ["king", "queen", "rook", "bishop", "knight", "pawn"]) {
        if (new RegExp("(^|\\\\s)" + role + "(\\\\s|$)").test(text)) return role;
      }
      return "";
    };
    const chessColorFromClass = (className) => {
      const text = String(className || "").toLowerCase();
      if (/(^|\\s)white(\\s|$)/.test(text)) return "white";
      if (/(^|\\s)black(\\s|$)/.test(text)) return "black";
      return "";
    };
    const chessSquareFromPoint = (x, y, orientation, width, height) => {
      const files = "abcdefgh";
      const size = Math.max(1, Math.min(width, height) / 8);
      const fileIndex = Math.max(0, Math.min(7, Math.floor(x / size)));
      const rankIndex = Math.max(0, Math.min(7, Math.floor(y / size)));
      if (orientation === "black") {
        return files[7 - fileIndex] + String(rankIndex + 1);
      }
      return files[fileIndex] + String(8 - rankIndex);
    };
    const dominantChessColor = (pieces) => {
      const counts = { white: 0, black: 0 };
      for (const piece of pieces || []) {
        if (piece.color === "white" || piece.color === "black") counts[piece.color] += 1;
      }
      if (counts.white === counts.black) return "";
      return counts.white > counts.black ? "white" : "black";
    };
    const chessCoordText = (root, selectors) => {
      const scope = root || document;
      return Array.from(scope.querySelectorAll(selectors))
        .filter(isVisible)
        .map((item) => String(item.textContent || "").replace(/\\s+/g, "").trim())
        .filter(Boolean)
        .join("");
    };
    const inferChessOrientation = (board, wrap, rawPieces, rect) => {
      const classText = [board.className, wrap?.className, document.body?.className].join(" ").toLowerCase();
      if (/orientation-black/.test(classText)) return { orientation: "black", source: "class" };
      if (/orientation-white/.test(classText)) return { orientation: "white", source: "class" };

      const root = wrap || board.parentElement || board;
      const filesText = chessCoordText(root, "coords.files coord, coords.files > *, .coords.files coord, .coords.files > *, .files coord, .files > *").toLowerCase();
      const ranksText = chessCoordText(root, "coords.ranks coord, coords.ranks > *, .coords.ranks coord, .coords.ranks > *, .ranks coord, .ranks > *");
      if (/^h/.test(filesText) || /^1/.test(ranksText)) return { orientation: "black", source: "coords" };
      if (/^a/.test(filesText) || /^8/.test(ranksText)) return { orientation: "white", source: "coords" };

      const topPieces = (rawPieces || []).filter((piece) => piece.centerY <= rect.height * 0.34);
      const bottomPieces = (rawPieces || []).filter((piece) => piece.centerY >= rect.height * 0.66);
      const topColor = dominantChessColor(topPieces);
      const bottomColor = dominantChessColor(bottomPieces);
      if (bottomColor === "black" || topColor === "white") return { orientation: "black", source: "piece-layout", topColor, bottomColor };
      if (bottomColor === "white" || topColor === "black") return { orientation: "white", source: "piece-layout", topColor, bottomColor };
      return { orientation: "white", source: "default", topColor, bottomColor };
    };
    const sideToMoveFromMoveHistory = (moves) => {
      const moveCount = Array.isArray(moves) ? moves.filter(Boolean).length : 0;
      if (!moveCount) return "";
      return moveCount % 2 === 0 ? "white" : "black";
    };
    const inferChessSideToMove = (board, wrap, boardRect, orientation, opponentColor, pieces, lastMoveSquares) => {
      const classText = [board, wrap, board?.parentElement]
        .map((element) => {
          if (!element) return "";
          const value = typeof element.className === "object" && element.className?.baseVal
            ? element.className.baseVal
            : element.className;
          return String(value || "");
        })
        .join(" ")
        .toLowerCase();
      if (/\b(?:manipulable|movable)\b/.test(classText) && !/\b(?:view-only|disabled)\b/.test(classText)) {
        return {
          sideToMove: orientation,
          sideToMoveSource: "chessground-manipulable",
          turnText: "your-turn"
        };
      }
      const pageText = String((document.title || "") + " " + (document.body?.innerText || "")).replace(/\s+/g, " ").trim();
      const lowerText = pageText.toLowerCase();
      if (/\b(pretas\s+jogam|black\s+(?:to\s+move|plays?))\b/i.test(pageText)) {
        return {
          sideToMove: "black",
          sideToMoveSource: "lichess-status-color-to-move",
          turnText: "black-to-move"
        };
      }
      if (/\b(brancas\s+jogam|white\s+(?:to\s+move|plays?))\b/i.test(pageText)) {
        return {
          sideToMove: "white",
          sideToMoveSource: "lichess-status-color-to-move",
          turnText: "white-to-move"
        };
      }
      const yourTurnMatch = /\b(sua vez|your turn|your move|your game to move|a sua vez)\b/i.test(pageText);
      if (yourTurnMatch) {
        return {
          sideToMove: orientation,
          sideToMoveSource: "lichess-status-your-turn",
          turnText: "your-turn"
        };
      }
      const opponentTurnMatch = /\b(aguardando|waiting for|opponent to move|vez do advers[aá]rio|oponente)\b/i.test(pageText) &&
        !/\b(sua vez|your turn|your move)\b/i.test(pageText);
      if (opponentTurnMatch) {
        return {
          sideToMove: opponentColor,
          sideToMoveSource: "lichess-status-opponent-turn",
          turnText: "opponent-turn"
        };
      }

      const clocks = Array.from(document.querySelectorAll(".rclock, .clock, [class*='clock']"))
        .filter(isVisible)
        .map((clock) => ({ clock, rect: clock.getBoundingClientRect(), className: String(clock.className || "").toLowerCase() }));
      const running = clocks.find((item) => /(^|\\s)running(\\s|$)/.test(item.className) || item.clock.getAttribute("data-state") === "running");
      if (running) {
        const clockCenterY = running.rect.top + running.rect.height / 2;
        const boardCenterY = boardRect.top + boardRect.height / 2;
        return clockCenterY > boardCenterY
          ? { sideToMove: orientation, sideToMoveSource: "running-clock-bottom" }
          : { sideToMove: opponentColor, sideToMoveSource: "running-clock-top" };
      }

      const destination = Array.isArray(lastMoveSquares) ? lastMoveSquares[lastMoveSquares.length - 1] : "";
      const movedPiece = destination
        ? (pieces || []).find((piece) => piece.square === destination)
        : null;
      if (movedPiece?.color === "white") {
        return { sideToMove: "black", sideToMoveSource: "last-move-destination", lastMoveColor: "white" };
      }
      if (movedPiece?.color === "black") {
        return { sideToMove: "white", sideToMoveSource: "last-move-destination", lastMoveColor: "black" };
      }

      return { sideToMove: "", sideToMoveSource: "" };
    };
    const extractLichessMoveHistorySan = () => {
      const selectors = [
        "main.bot-play kwdb san",
        "main.bot-play l4x san",
        "main.round kwdb san",
        "main.round l4x san",
        ".round__app kwdb san",
        ".round__app l4x san",
        ".moves san",
        ".tview2 san",
        "kwdb san",
        "l4x san"
      ];
      const moves = Array.from(document.querySelectorAll(selectors.join(",")))
        .filter(isVisible)
        .map((node) => String(node.textContent || "").replace(/\s+/g, "").trim())
        .filter((move) => move && !/^\d+\.{0,3}$/.test(move));
      return moves.slice(-80);
    };
    const readLichessBotGame = () => {
      try {
        const raw = window.localStorage?.getItem("bot.current-game");
        if (!raw || raw === "null") return null;
        const game = JSON.parse(raw);
        return game && typeof game === "object" ? game : null;
      } catch {
        return null;
      }
    };
    const inferLichessBotGameState = (game) => {
      if (!game || typeof game !== "object") return null;
      const moves = Array.isArray(game.moves) ? game.moves : [];
      const initialFen = String(game.initialFen || "");
      const initialSide = /\\sb\\s/.test(initialFen) ? "black" : "white";
      const sideToMove = moves.length % 2 === 0 ? initialSide : (initialSide === "white" ? "black" : "white");
      return {
        id: String(game.id || ""),
        botKey: String(game.botKey || ""),
        pov: /^(white|black)$/.test(String(game.pov || "")) ? String(game.pov) : "",
        initialFen,
        sideToMove,
        moves: moves.map((move) => String(move?.san || "")).filter(Boolean),
        moveCount: moves.length,
        end: game.end && typeof game.end === "object"
          ? {
              status: String(game.end.status || ""),
              winner: String(game.end.winner || ""),
              fen: String(game.end.fen || "")
            }
          : null
      };
    };
    const isLikelyLichessGamePath = () => {
      const host = String(location.hostname || "").toLowerCase();
      const pathPart = String(location.pathname || "").split("/").filter(Boolean)[0] || "";
      return (host === "lichess.org" || host.endsWith(".lichess.org")) && /^[A-Za-z0-9]{8,12}$/.test(pathPart);
    };
    const extractChessBoards = () => {
      const seenBoards = new Set();
      const lichessBotGame = inferLichessBotGameState(readLichessBotGame());
      const lichessDomMoves = extractLichessMoveHistorySan();
      const preferredSelectors = [
        "main.bot-play cg-board",
        "main.round cg-board",
        ".round__app cg-board",
        ".main-board cg-board",
        ".analyse__board cg-board",
        ".puzzle__board cg-board",
        ".cg-wrap.orientation-white cg-board",
        ".cg-wrap.orientation-black cg-board",
        "cg-board"
      ];
      const boardEntries = [];
      for (const selector of preferredSelectors) {
        const group = Array.from(document.querySelectorAll(selector))
          .filter((board) => !seenBoards.has(board))
          .filter(isVisible)
          .map((board) => ({ board, rect: board.getBoundingClientRect() }))
          .filter((entry) => entry.rect.width >= 160 && entry.rect.height >= 160)
          .filter((entry) => !entry.board.closest("header,nav,.site-buttons,.dasher,.dropdown,.menu,.mini-board,.mini-game,.game-row,.tv-channels,.lobby__tv,.study__chapters"))
          .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
        for (const entry of group) {
          seenBoards.add(entry.board);
          boardEntries.push(entry);
        }
      }
      const boards = boardEntries
        .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))
        .map((entry) => entry.board)
        .slice(0, 4);
      return boards.map((board, index) => {
        const rect = board.getBoundingClientRect();
        const wrap = board.closest(".cg-wrap, [class*='orientation-'], .main-board, .round__app, .analyse__board, .puzzle__board") || board.parentElement;
        const rawPieces = Array.from(board.querySelectorAll("piece, .piece"))
          .filter(isVisible)
          .slice(0, 40)
          .map((piece) => {
            const pieceRect = piece.getBoundingClientRect();
            const className = String(piece.className || "");
            return {
              centerX: pieceRect.left - rect.left + pieceRect.width / 2,
              centerY: pieceRect.top - rect.top + pieceRect.height / 2,
              color: chessColorFromClass(className),
              piece: chessRoleFromClass(className),
              className
            };
          })
          .filter((piece) => piece.color && piece.piece);
        const orientationInfo = inferChessOrientation(board, wrap, rawPieces, rect);
        const orientation = orientationInfo.orientation;
        const opponentColor = orientation === "black" ? "white" : "black";
        const pieces = rawPieces
          .map((piece) => ({
            square: chessSquareFromPoint(piece.centerX, piece.centerY, orientation, rect.width, rect.height),
            color: piece.color,
            piece: piece.piece,
            className: piece.className
          }))
          .filter((piece) => piece.square && piece.color && piece.piece);
        const lastMoveSquares = Array.from(board.querySelectorAll("square.last-move, .last-move"))
          .filter(isVisible)
          .map((square) => {
            const squareRect = square.getBoundingClientRect();
            const centerX = squareRect.left - rect.left + squareRect.width / 2;
            const centerY = squareRect.top - rect.top + squareRect.height / 2;
            return chessSquareFromPoint(centerX, centerY, orientation, rect.width, rect.height);
          })
          .filter(Boolean);
        const turnInfo = inferChessSideToMove(board, wrap, rect, orientation, opponentColor, pieces, lastMoveSquares);
        const isBotPlayBoard = Boolean(board.closest("main.bot-play")) || Boolean(lichessBotGame && document.querySelector("main.bot-play"));
        const botSideToMove = isBotPlayBoard && lichessBotGame?.sideToMove ? lichessBotGame.sideToMove : "";
        const moveHistorySan = lichessBotGame?.moves?.length ? lichessBotGame.moves : lichessDomMoves;
        const historySideToMove = sideToMoveFromMoveHistory(moveHistorySan);
        const liveTurnSource = String(turnInfo.sideToMoveSource || "");
        const liveSideToMove = turnInfo.sideToMove && liveTurnSource && liveTurnSource !== "last-move-destination"
          ? turnInfo.sideToMove
          : "";
        const finalSideToMove = liveSideToMove || botSideToMove || historySideToMove || turnInfo.sideToMove || "";
        const finalSideToMoveSource = liveSideToMove
          ? liveTurnSource
          : botSideToMove
          ? "lichess-bot-localStorage"
          : historySideToMove
          ? "lichess-move-history"
          : liveTurnSource;
        const playAs = isBotPlayBoard && lichessBotGame?.pov ? lichessBotGame.pov : orientation;
        const botOpponentColor = playAs === "black" ? "white" : playAs === "white" ? "black" : opponentColor;
        const whitePieces = pieces
          .filter((piece) => piece.color === "white")
          .map((piece) => piece.piece + "@" + piece.square)
          .join(" ");
        const blackPieces = pieces
          .filter((piece) => piece.color === "black")
          .map((piece) => piece.piece + "@" + piece.square)
          .join(" ");
        return {
          ref: "@board" + (index + 1),
          kind: "chess",
          engine: "dom-board",
          selector: selectorFor(board) || "cg-board",
          activeGame: Boolean(
            board.closest("main.bot-play, main.round, .round__app") ||
            isBotPlayBoard ||
            isLikelyLichessGamePath()
          ),
          orientation,
          orientationSource: orientationInfo.source,
          controlledColor: playAs,
          playAs,
          opponentColor: botOpponentColor,
          bottomColor: orientationInfo.bottomColor || "",
          topColor: orientationInfo.topColor || "",
          sideToMove: finalSideToMove,
          sideToMoveSource: finalSideToMoveSource,
          turnText: lichessBotGame?.end ? "game-ended" : (turnInfo.turnText || ""),
          lastMoveSquares,
          lastMoveColor: turnInfo.lastMoveColor || "",
          gameOver: Boolean(lichessBotGame?.end),
          gameEnd: lichessBotGame?.end || null,
          moveHistorySan,
          lichessBotGame: isBotPlayBoard && lichessBotGame
            ? {
                id: lichessBotGame.id,
                botKey: lichessBotGame.botKey,
                pov: lichessBotGame.pov,
                moveCount: lichessBotGame.moveCount,
                initialFen: lichessBotGame.initialFen,
                end: lichessBotGame.end
              }
            : null,
          orientationMeaning: "playAs/controlledColor is the side visually at the bottom of the Workbench board",
          squareSize: Math.round(Math.min(rect.width, rect.height) / 8),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          pieces,
          position: {
            white: whitePieces,
            black: blackPieces
          },
          moveTool: "browser_chess_move(from_square, to_square)"
        };
      }).filter((board) => board.rect?.width > 120 && board.rect?.height > 120);
    };
    const text = document.body?.innerText?.trim() || "";
    return {
      url: location.href,
      title: document.title || "",
      textLength: text.length,
      textPreview: text.replace(/\\s+/g, " ").trim().slice(0, 1200),
      visibleElements: Array.from(document.body?.querySelectorAll("*") || []).filter(isVisible).length,
      interactiveElements: elements,
      landmarks,
      chessBoards: extractChessBoards(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY }
    };
  })()`;
}

async function snapshotPreviewWebview(webview) {
  ensurePreviewHarnessChatScope();
  if (!previewWebviewBelongsToCurrentChat(webview)) {
    throw new Error("Este webview pertence a outro chat; abra um novo Preview para este topico.");
  }
  let snapshot;
  try {
    await waitForPreviewWebviewReady(webview, 5000);
    snapshot = await webview.executeJavaScript(previewSnapshotScript(), true);
  } catch (error) {
    let url = previewHarnessBelongsToCurrentChat() ? state.previewHarness.url || "" : "";
    try {
      url = typeof webview?.getURL === "function" ? webview.getURL() || url : url;
    } catch {}
    snapshot = {
      url,
      title: "",
      textLength: 0,
      textPreview: "",
      visibleElements: 0,
      interactiveElements: [],
      landmarks: [],
      viewport: null,
      scroll: null,
      warning: error?.message || String(error || "Preview ainda nao esta pronto.")
    };
    pushPreviewHarnessTelemetry("error", snapshot.warning);
  }
  if (previewWebviewBelongsToCurrentChat(webview)) {
    state.previewHarness.elements = Array.isArray(snapshot?.interactiveElements) ? snapshot.interactiveElements : [];
    state.previewHarness.lastSnapshot = snapshot || null;
  }
  return snapshot || {};
}

function resolvePreviewElement(rawStep = {}) {
  const ref = String(rawStep.ref || "").trim();
  const elements = state.previewHarness.elements || [];
  const landmarks = state.previewHarness.lastSnapshot?.landmarks || [];
  const candidates = [...elements, ...landmarks].filter(Boolean);
  const requestedLabel = normalizePreviewElementLabel(
    rawStep.label || rawStep.accessibleName || rawStep.name || rawStep.ariaLabel || rawStep.title
  );

  if (ref) {
    const byRef = candidates.find((entry) => entry.ref === ref);
    if (byRef) {
      const byRefLabel = normalizePreviewElementLabel(byRef.label || byRef.accessibleName || byRef.name || byRef.ariaLabel);
      if (!requestedLabel || byRefLabel === requestedLabel || byRefLabel.includes(requestedLabel) || requestedLabel.includes(byRefLabel)) {
        return byRef;
      }
    }
  }

  if (!requestedLabel) {
    return null;
  }

  const exact = candidates.find((entry) => normalizePreviewElementLabel(entry.label) === requestedLabel);
  if (exact) return exact;

  const contains = candidates.find((entry) => {
    const label = normalizePreviewElementLabel(entry.label);
    return label && (label.includes(requestedLabel) || requestedLabel.includes(label));
  });
  return contains || null;
}

function normalizePreviewElementLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isLichessBlindModeToggleLabel(value) {
  const label = normalizePreviewElementLabel(value);
  return /acessibilidade.*habilitar.*modo.*ceg/.test(label) || /accessibility.*enable.*blind/.test(label);
}

async function resolvePreviewElementFresh(webview, rawStep = {}) {
  let element = resolvePreviewElement(rawStep);
  const hasLogicalTarget = Boolean(
    String(rawStep.ref || rawStep.label || rawStep.accessibleName || rawStep.name || rawStep.ariaLabel || rawStep.title || "").trim()
  );
  const hasNamedTarget = Boolean(
    String(rawStep.label || rawStep.accessibleName || rawStep.name || rawStep.ariaLabel || rawStep.title || "").trim()
  );
  if ((hasNamedTarget || (!element && hasLogicalTarget)) && webview) {
    await capturePreviewWebviewInfo(webview).catch(() => null);
    const refreshed = resolvePreviewElement(rawStep);
    if (refreshed) {
      element = refreshed;
    }
  }
  return element;
}

async function previewElementPoint(webview, rawStep = {}) {
  const refElement = await resolvePreviewElementFresh(webview, rawStep);
  if (refElement) {
    return {
      x: refElement.x,
      y: refElement.y,
      selector: refElement.selector,
      label: refElement.label,
      ref: refElement.ref,
      tag: refElement.tag,
      role: refElement.role,
      type: refElement.type
    };
  }
  const selector = String(rawStep.selector || "").trim();
  if (selector) {
    const point = await webview.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: rect.width,
        height: rect.height,
        tag: element.tagName || "",
        role: element.getAttribute("role") || "",
        type: element.getAttribute("type") || ""
      };
    })()`, true).catch(() => null);
    if (point) {
      return { x: point.x, y: point.y, selector, label: selector, ref: "", tag: point.tag, role: point.role, type: point.type };
    }
  }
  if (Number.isFinite(Number(rawStep.x)) && Number.isFinite(Number(rawStep.y))) {
    return { x: Number(rawStep.x), y: Number(rawStep.y), selector: "", label: "coordinate", ref: "" };
  }
  return null;
}

async function refinePreviewClickPoint(webview, point) {
  const selector = String(point?.selector || "").trim();
  const requestedLabel = String(point?.label || "").trim();
  if (!selector || !webview) {
    return point;
  }

  const refined = await webview.executeJavaScript(`(() => {
    const normalize = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
    const labelFor = (element) => (
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      element?.getAttribute?.("placeholder") ||
      element?.getAttribute?.("value") ||
      element?.innerText ||
      element?.getAttribute?.("href") ||
      element?.tagName ||
      ""
    ).replace(/\\s+/g, " ").trim();
    let element = null;
    try {
      element = document.querySelector(${JSON.stringify(selector)});
    } catch {}
    if (!element) return null;
    if (${JSON.stringify(Boolean(requestedLabel))}) {
      const currentLabel = normalize(labelFor(element));
      const wanted = normalize(${JSON.stringify(requestedLabel)});
      if (wanted && currentLabel && !currentLabel.includes(wanted) && !wanted.includes(currentLabel)) {
        return { mismatch: true, label: labelFor(element), wanted: ${JSON.stringify(requestedLabel)} };
      }
    }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const x = Math.round(Math.min(Math.max(rect.left + width / 2, 1), window.innerWidth - 2));
    const y = Math.round(Math.min(Math.max(rect.top + height / 2, 1), window.innerHeight - 2));
    const hit = document.elementFromPoint(x, y);
    const clickable = hit?.closest?.("a[href],button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[tabindex]:not([tabindex='-1'])");
    const hitOk = hit === element || (hit && element.contains(hit)) || clickable === element || (clickable && element.contains(clickable));
    return {
      x,
      y,
      hitOk,
      label: labelFor(element),
      hitLabel: labelFor(clickable || hit),
      selector: ${JSON.stringify(selector)},
      tag: element.tagName || "",
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || ""
    };
  })()`, true).catch(() => null);

  if (refined?.mismatch) {
    throw new Error(`Elemento mudou antes do clique: esperado "${refined.wanted}", encontrado "${refined.label}". Atualize o snapshot e tente novamente.`);
  }
  if (!refined || !Number.isFinite(Number(refined.x)) || !Number.isFinite(Number(refined.y))) {
    return point;
  }
  return {
    ...point,
    x: refined.x,
    y: refined.y,
    label: refined.label || point.label,
    hitLabel: refined.hitLabel || "",
    hitOk: Boolean(refined.hitOk),
    tag: refined.tag || point.tag || "",
    role: refined.role || point.role || "",
    type: refined.type || point.type || ""
  };
}

function shouldUseDomClickForPreviewPoint(point = {}) {
  if (!String(point?.selector || "").trim()) return false;
  const tag = String(point.tag || "").toLowerCase();
  const role = String(point.role || "").toLowerCase();
  const type = String(point.type || "").toLowerCase();
  if (["button", "a", "input", "select", "textarea", "summary", "option"].includes(tag)) return true;
  if (["button", "link", "menuitem", "tab", "option"].includes(role)) return true;
  if (tag === "tr" && role === "button") return true;
  if (tag === "input" && ["button", "submit", "checkbox", "radio"].includes(type)) return true;
  return false;
}

async function clickPreviewDomElement(webview, point) {
  const selector = String(point?.selector || "").trim();
  const requestedLabel = String(point?.label || "").trim();
  if (!selector) return null;
  return webview.executeJavaScript(`(() => {
    const normalize = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
    const labelFor = (element) => (
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      element?.getAttribute?.("placeholder") ||
      element?.getAttribute?.("value") ||
      element?.innerText ||
      element?.getAttribute?.("href") ||
      element?.tagName ||
      ""
    ).replace(/\\s+/g, " ").trim();
    let element = null;
    try {
      element = document.querySelector(${JSON.stringify(selector)});
    } catch {}
    if (!element) return { ok: false, error: "selector not found" };
    if (${JSON.stringify(Boolean(requestedLabel))}) {
      const currentLabel = normalize(labelFor(element));
      const wanted = normalize(${JSON.stringify(requestedLabel)});
      if (wanted && currentLabel && !currentLabel.includes(wanted) && !wanted.includes(currentLabel)) {
        return { ok: false, mismatch: true, label: labelFor(element), wanted: ${JSON.stringify(requestedLabel)} };
      }
    }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }
    if (typeof element.click === "function") {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    return {
      ok: true,
      label: labelFor(element),
      tag: element.tagName || "",
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || ""
    };
  })()`, true);
}

async function guardPreviewCoordinateClick(webview, point = {}) {
  if (!webview || String(point.selector || point.ref || "").trim()) {
    return;
  }
  const x = Math.round(Number(point.x));
  const y = Math.round(Number(point.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const guard = await webview.executeJavaScript(`(() => {
    const x = ${JSON.stringify(x)};
    const y = ${JSON.stringify(y)};
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const boards = Array.from(document.querySelectorAll("cg-board"))
      .filter(isVisible)
      .map((board) => ({ board, rect: board.getBoundingClientRect() }))
      .filter((entry) => entry.rect.width >= 160 && entry.rect.height >= 160)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    if (!boards.length) {
      return { hasChessBoard: false };
    }
    const hit = document.elementFromPoint(x, y);
    const boardHit = boards.find(({ board }) => hit === board || (hit && board.contains(hit)));
    if (boardHit) {
      return { hasChessBoard: true, ok: true };
    }
    const board = boards[0].board;
    const rect = board.getBoundingClientRect();
    return {
      hasChessBoard: true,
      ok: false,
      hitTag: hit?.tagName || "",
      hitClass: String(hit?.className || ""),
      boardRect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  })()`, true).catch(() => null);
  if (guard?.hasChessBoard && guard.ok === false) {
    const rect = guard.boardRect || {};
    throw new Error(
      "Clique por coordenada rejeitado: ha um tabuleiro de xadrez ativo, mas o ponto " +
      `${x},${y} cairia em ${guard.hitTag || "outro elemento"}.${guard.hitClass || ""}, fora do cg-board ` +
      `(board=${rect.left},${rect.top},${rect.width}x${rect.height}). Use browser_chess_state e browser_chess_move(from_square,to_square).`
    );
  }
}

async function clickPreviewPoint(webview, point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    throw new Error("click exige ref, selector ou coordenadas x/y.");
  }
  if (isLichessBlindModeToggleLabel(point.label || point.accessibleName || point.name || point.ariaLabel || point.title)) {
    throw new Error("Clique bloqueado: nao habilite o modo as cegas do Lichess para jogar no Workbench. Use browser_chess_state/browser_chess_move no tabuleiro visual.");
  }
  const refined = await refinePreviewClickPoint(webview, point);
  if (isLichessBlindModeToggleLabel(refined.label || refined.accessibleName || refined.name || refined.ariaLabel || refined.title)) {
    throw new Error("Clique bloqueado: nao habilite o modo as cegas do Lichess para jogar no Workbench. Use browser_chess_state/browser_chess_move no tabuleiro visual.");
  }
  await guardPreviewCoordinateClick(webview, refined);
  if (shouldUseDomClickForPreviewPoint(refined)) {
    const domClick = await clickPreviewDomElement(webview, refined).catch((error) => ({
      ok: false,
      error: String(error?.message || error)
    }));
    if (domClick?.mismatch) {
      throw new Error(`Elemento mudou antes do clique: esperado "${domClick.wanted}", encontrado "${domClick.label}". Atualize o snapshot e tente novamente.`);
    }
    if (domClick?.ok) {
      await new Promise((resolve) => setTimeout(resolve, 360));
      return {
        ...refined,
        label: domClick.label || refined.label,
        tag: domClick.tag || refined.tag,
        role: domClick.role || refined.role,
        type: domClick.type || refined.type,
        domClick: true
      };
    }
  }
  const x = Math.round(Number(refined.x));
  const y = Math.round(Number(refined.y));
  if (typeof webview.focus === "function") {
    try {
      webview.focus();
    } catch {}
  }
  webview.sendInputEvent({ type: "mouseMove", x, y });
  webview.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  webview.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 260));
  return refined;
}

async function sendPreviewMouseClick(webview, point, delayMs = 260) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    throw new Error("click exige coordenadas validas.");
  }
  const x = Math.round(Number(point.x));
  const y = Math.round(Number(point.y));
  if (typeof webview.focus === "function") {
    try {
      webview.focus();
    } catch {}
  }
  webview.sendInputEvent({ type: "mouseMove", x, y });
  webview.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 45));
  webview.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { ...point, x, y };
}

async function dragPreviewMouse(webview, fromPoint, toPoint, delayMs = 260) {
  if (!fromPoint || !toPoint) {
    throw new Error("drag exige origem e destino.");
  }
  const fromX = Math.round(Number(fromPoint.x));
  const fromY = Math.round(Number(fromPoint.y));
  const toX = Math.round(Number(toPoint.x));
  const toY = Math.round(Number(toPoint.y));
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
    throw new Error("drag exige coordenadas validas.");
  }
  if (typeof webview.focus === "function") {
    try {
      webview.focus();
    } catch {}
  }
  webview.sendInputEvent({ type: "mouseMove", x: fromX, y: fromY });
  webview.sendInputEvent({ type: "mouseDown", x: fromX, y: fromY, button: "left", clickCount: 1 });
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const ratio = i / steps;
    const x = Math.round(fromX + (toX - fromX) * ratio);
    const y = Math.round(fromY + (toY - fromY) * ratio);
    webview.sendInputEvent({ type: "mouseMove", x, y, movementX: x - fromX, movementY: y - fromY });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
  webview.sendInputEvent({ type: "mouseUp", x: toX, y: toY, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { from: { ...fromPoint, x: fromX, y: fromY }, to: { ...toPoint, x: toX, y: toY } };
}

async function dispatchPreviewChessDomMove(webview, fromPoint, toPoint) {
  const from = normalizeChessSquare(fromPoint?.chessSquare || fromPoint?.square);
  const to = normalizeChessSquare(toPoint?.chessSquare || toPoint?.square);
  const result = await webview.executeJavaScript(previewChessDomInteractionScript({
    action: "move",
    from,
    to
  }), true);
  if (!result?.ok) {
    throw new Error(result?.error || `Nao foi possivel mover no cg-board: ${from}-${to}.`);
  }
  return result;
}

async function dispatchPreviewChessDomDrag(webview, fromPoint, toPoint) {
  const from = normalizeChessSquare(fromPoint?.chessSquare || fromPoint?.square);
  const to = normalizeChessSquare(toPoint?.chessSquare || toPoint?.square);
  const result = await webview.executeJavaScript(previewChessDomInteractionScript({
    action: "drag",
    from,
    to
  }), true);
  if (!result?.ok) {
    throw new Error(result?.error || `Nao foi possivel arrastar no cg-board: ${from}-${to}.`);
  }
  return result;
}

function normalizeChessSquare(square) {
  const value = String(square || "").trim().toLowerCase();
  const match = value.match(/^[a-h][1-8]$/);
  if (!match) {
    throw new Error(`Casa de xadrez invalida: ${square || "(vazio)"}. Use formato como e2 ou g8.`);
  }
  return value;
}

function previewChessDomInteractionScript(payload = {}) {
  return `(async () => {
    const payload = ${JSON.stringify(payload)};
    const files = "abcdefgh";
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const visibleBoards = (selector) => Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .map((board) => ({ board, rect: board.getBoundingClientRect() }))
      .filter((entry) => entry.rect.width >= 160 && entry.rect.height >= 160)
      .filter((entry) => !entry.board.closest("header,nav,.site-buttons,.dasher,.dropdown,.menu,.mini-board,.mini-game,.game-row,.tv-channels,.lobby__tv,.study__chapters"));
    const findBoard = () => {
      const selectors = [
        "main.round cg-board",
        ".round__app cg-board",
        ".main-board cg-board",
        ".analyse__board cg-board",
        ".puzzle__board cg-board",
        ".cg-wrap.orientation-white cg-board",
        ".cg-wrap.orientation-black cg-board",
        "cg-board"
      ];
      for (const selector of selectors) {
        const group = visibleBoards(selector)
          .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
        if (group.length) return group[0].board;
      }
      return null;
    };
    const board = findBoard();
    if (!board) {
      return { ok: false, error: "Nenhum cg-board ativo e visivel foi encontrado." };
    }
    const wrap = board.closest(".cg-wrap, [class*='orientation-'], .main-board, .round__app, .analyse__board, .puzzle__board") || board.parentElement;
    const classText = [board.className, wrap?.className, document.body?.className].join(" ").toLowerCase();
    const pieceColor = (className) => {
      const text = String(className || "").toLowerCase();
      if (/(^|\\s)white(\\s|$)/.test(text)) return "white";
      if (/(^|\\s)black(\\s|$)/.test(text)) return "black";
      return "";
    };
    const dominantColor = (items) => {
      const counts = { white: 0, black: 0 };
      for (const item of items || []) {
        if (item.color === "white" || item.color === "black") counts[item.color] += 1;
      }
      if (counts.white === counts.black) return "";
      return counts.white > counts.black ? "white" : "black";
    };
    const coordText = (root, selectors) => Array.from((root || document).querySelectorAll(selectors))
      .filter(isVisible)
      .map((item) => String(item.textContent || "").replace(/\\s+/g, "").trim())
      .filter(Boolean)
      .join("");
    const inferOrientation = () => {
      if (/orientation-black/.test(classText)) return { orientation: "black", source: "class" };
      if (/orientation-white/.test(classText)) return { orientation: "white", source: "class" };
      const root = wrap || board.parentElement || board;
      const filesText = coordText(root, "coords.files coord, coords.files > *, .coords.files coord, .coords.files > *, .files coord, .files > *").toLowerCase();
      const ranksText = coordText(root, "coords.ranks coord, coords.ranks > *, .coords.ranks coord, .coords.ranks > *, .ranks coord, .ranks > *");
      if (/^h/.test(filesText) || /^1/.test(ranksText)) return { orientation: "black", source: "coords" };
      if (/^a/.test(filesText) || /^8/.test(ranksText)) return { orientation: "white", source: "coords" };
      const boardRect = board.getBoundingClientRect();
      const rawPieces = Array.from(board.querySelectorAll("piece, .piece"))
        .filter(isVisible)
        .slice(0, 40)
        .map((piece) => {
          const pieceRect = piece.getBoundingClientRect();
          return {
            centerY: pieceRect.top - boardRect.top + pieceRect.height / 2,
            color: pieceColor(piece.className)
          };
        })
        .filter((piece) => piece.color);
      const topColor = dominantColor(rawPieces.filter((piece) => piece.centerY <= boardRect.height * 0.34));
      const bottomColor = dominantColor(rawPieces.filter((piece) => piece.centerY >= boardRect.height * 0.66));
      if (bottomColor === "black" || topColor === "white") return { orientation: "black", source: "piece-layout" };
      if (bottomColor === "white" || topColor === "black") return { orientation: "white", source: "piece-layout" };
      return { orientation: "white", source: "default" };
    };
    const orientationInfo = inferOrientation();
    const orientation = orientationInfo.orientation;
    const acceptsHit = (hit) => {
      const hitBoard = hit === board || (hit && board.contains(hit)) || hit?.closest?.("cg-board") === board;
      const hitWrap = wrap && (hit === wrap || (hit && wrap.contains(hit)));
      return Boolean(hitBoard || hitWrap);
    };
    const pointForSquare = (square) => {
      const value = String(square || "").trim().toLowerCase();
      if (!/^[a-h][1-8]$/.test(value)) {
        return { ok: false, error: "Casa de xadrez invalida: " + (square || "(vazio)") };
      }
      const fileIndex = files.indexOf(value[0]);
      const rank = Number(value[1]);
      const visualFile = orientation === "black" ? 7 - fileIndex : fileIndex;
      const visualRank = orientation === "black" ? rank - 1 : 8 - rank;
      const firstRect = board.getBoundingClientRect();
      const firstSize = Math.max(1, Math.min(firstRect.width, firstRect.height));
      const firstOriginX = firstRect.left + (firstRect.width - firstSize) / 2;
      const firstOriginY = firstRect.top + (firstRect.height - firstSize) / 2;
      const firstX = firstOriginX + (visualFile + 0.5) * (firstSize / 8);
      const firstY = firstOriginY + (visualRank + 0.5) * (firstSize / 8);
      const margin = Math.max(24, Math.min(80, (firstSize / 8) * 0.45));
      if (
        firstY < margin ||
        firstY > window.innerHeight - margin ||
        firstX < margin ||
        firstX > window.innerWidth - margin
      ) {
        window.scrollBy({
          left: firstX - (window.innerWidth / 2),
          top: firstY - (window.innerHeight / 2),
          behavior: "instant"
        });
      }
      const rect = board.getBoundingClientRect();
      const boardSize = Math.max(1, Math.min(rect.width, rect.height));
      const originX = rect.left + (rect.width - boardSize) / 2;
      const originY = rect.top + (rect.height - boardSize) / 2;
      const squareSize = boardSize / 8;
      const x = Math.round(originX + (visualFile + 0.5) * squareSize);
      const y = Math.round(originY + (visualRank + 0.5) * squareSize);
      const insideViewport = x >= 2 && y >= 2 && x <= window.innerWidth - 3 && y <= window.innerHeight - 3;
      const hit = insideViewport ? document.elementFromPoint(x, y) : null;
      if (!insideViewport || !acceptsHit(hit)) {
        return {
          ok: false,
          error: "Casa " + value + " calculada fora do tabuleiro ativo. viewport=" +
            window.innerWidth + "x" + window.innerHeight + " point=" + x + "," + y +
            " hit=" + (hit?.tagName || "") + "." + String(hit?.className || ""),
          square: value,
          orientation,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      }
      return {
        ok: true,
        square: value,
        orientation,
        orientationSource: orientationInfo.source,
        x,
        y,
        hitTag: hit?.tagName || "",
        hitClass: String(hit?.className || ""),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    };
    const dispatchAt = (point, type, options = {}) => {
      const target = document.elementFromPoint(point.x, point.y) || board;
      const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        screenX: window.screenX + point.x,
        screenY: window.screenY + point.y,
        button: 0,
        buttons: options.buttons ?? 0,
        detail: options.detail ?? 1
      };
      try {
        if (type.startsWith("pointer") && typeof PointerEvent === "function") {
          target.dispatchEvent(new PointerEvent(type, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
          return;
        }
      } catch {}
      try {
        target.dispatchEvent(new MouseEvent(type.replace(/^pointer/, "mouse"), base));
      } catch {}
    };
    const clickAt = async (point) => {
      dispatchAt(point, "pointerover");
      dispatchAt(point, "mouseover");
      dispatchAt(point, "pointermove");
      dispatchAt(point, "mousemove");
      dispatchAt(point, "pointerdown", { buttons: 1 });
      dispatchAt(point, "mousedown", { buttons: 1 });
      await sleep(40);
      dispatchAt(point, "pointerup");
      dispatchAt(point, "mouseup");
      dispatchAt(point, "click");
    };
    const dragBetween = async (fromPoint, toPoint) => {
      dispatchAt(fromPoint, "pointermove");
      dispatchAt(fromPoint, "mousemove");
      dispatchAt(fromPoint, "pointerdown", { buttons: 1 });
      dispatchAt(fromPoint, "mousedown", { buttons: 1 });
      const steps = 10;
      for (let i = 1; i <= steps; i += 1) {
        const ratio = i / steps;
        const point = {
          x: Math.round(fromPoint.x + (toPoint.x - fromPoint.x) * ratio),
          y: Math.round(fromPoint.y + (toPoint.y - fromPoint.y) * ratio)
        };
        dispatchAt(point, "pointermove", { buttons: 1 });
        dispatchAt(point, "mousemove", { buttons: 1 });
        await sleep(14);
      }
      dispatchAt(toPoint, "pointerup");
      dispatchAt(toPoint, "mouseup");
      dispatchAt(toPoint, "click");
    };

    if (payload.action === "point") {
      return pointForSquare(payload.square);
    }
    if (payload.action === "click") {
      const point = pointForSquare(payload.square);
      if (!point.ok) return point;
      await clickAt(point);
      return { ok: true, method: "dom-click-square", point };
    }
    if (payload.action === "drag") {
      const fromPoint = pointForSquare(payload.from);
      if (!fromPoint.ok) return fromPoint;
      const toPoint = pointForSquare(payload.to);
      if (!toPoint.ok) return toPoint;
      await dragBetween(fromPoint, toPoint);
      return { ok: true, method: "dom-drag", from: fromPoint, to: toPoint };
    }
    if (payload.action === "move") {
      const fromPoint = pointForSquare(payload.from);
      if (!fromPoint.ok) return fromPoint;
      const toPoint = pointForSquare(payload.to);
      if (!toPoint.ok) return toPoint;
      await clickAt(fromPoint);
      await sleep(90);
      await clickAt(toPoint);
      return { ok: true, method: "dom-click-click", from: fromPoint, to: toPoint };
    }
    return { ok: false, error: "Acao de xadrez desconhecida: " + String(payload.action || "") };
  })()`;
}

async function previewChessSquarePoint(webview, square) {
  const normalizedSquare = normalizeChessSquare(square);
  const point = await webview.executeJavaScript(previewChessDomInteractionScript({
    action: "point",
    square: normalizedSquare
  }), true);
  if (!point?.ok) {
    throw new Error(point?.error || "Nao foi possivel calcular a casa no tabuleiro ativo.");
  }
  return {
    x: point.x,
    y: point.y,
    label: `chess square ${normalizedSquare}`,
    chessSquare: normalizedSquare,
    orientation: point.orientation,
    orientationSource: point.orientationSource || "",
    rect: point.rect || null,
    hitTag: point.hitTag || "",
    hitClass: point.hitClass || ""
  };
}

async function clickPreviewChessSquare(webview, square) {
  const normalizedSquare = normalizeChessSquare(square);
  const result = await webview.executeJavaScript(previewChessDomInteractionScript({
    action: "click",
    square: normalizedSquare
  }), true);
  if (!result?.ok) {
    throw new Error(result?.error || `Nao foi possivel clicar a casa ${normalizedSquare} no tabuleiro ativo.`);
  }
  await new Promise((resolve) => setTimeout(resolve, 220));
  const point = result.point || {};
  return {
    x: point.x,
    y: point.y,
    label: `chess square ${normalizedSquare}`,
    chessSquare: normalizedSquare,
    orientation: point.orientation || "",
    orientationSource: point.orientationSource || "",
    method: result.method || "dom-click-square"
  };
}

function chessPieceAtSnapshot(snapshot = {}, square = "") {
  const normalizedSquare = normalizeChessSquare(square);
  const board = Array.isArray(snapshot.chessBoards) ? snapshot.chessBoards[0] : null;
  const pieces = Array.isArray(board?.pieces) ? board.pieces : [];
  return pieces.find((piece) => String(piece.square || "").toLowerCase() === normalizedSquare) || null;
}

function chessBoardFromSnapshot(snapshot = {}) {
  return Array.isArray(snapshot.chessBoards) ? snapshot.chessBoards[0] || null : null;
}

function chessPieceMap(board = {}) {
  const map = new Map();
  for (const piece of Array.isArray(board?.pieces) ? board.pieces : []) {
    const square = String(piece.square || "").toLowerCase();
    if (/^[a-h][1-8]$/.test(square)) {
      map.set(square, {
        square,
        color: String(piece.color || "").toLowerCase(),
        piece: String(piece.piece || "").toLowerCase()
      });
    }
  }
  return map;
}

function chessSquareOffset(square, fileDelta, rankDelta) {
  const files = "abcdefgh";
  const file = files.indexOf(String(square || "")[0]);
  const rank = Number(String(square || "")[1]);
  const nextFile = file + fileDelta;
  const nextRank = rank + rankDelta;
  if (nextFile < 0 || nextFile > 7 || nextRank < 1 || nextRank > 8) {
    return "";
  }
  return `${files[nextFile]}${nextRank}`;
}

function chessPiecePlacementFromBoard(board = {}) {
  const files = "abcdefgh";
  const pieceLetters = {
    king: "k",
    queen: "q",
    rook: "r",
    bishop: "b",
    knight: "n",
    pawn: "p"
  };
  const grid = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const piece of Array.isArray(board?.pieces) ? board.pieces : []) {
    const square = String(piece.square || "").toLowerCase();
    if (!/^[a-h][1-8]$/.test(square)) continue;
    const file = files.indexOf(square[0]);
    const rank = Number(square[1]);
    const row = 8 - rank;
    const letter = pieceLetters[String(piece.piece || "").toLowerCase()] || "";
    if (!letter || file < 0 || row < 0 || row > 7) continue;
    grid[row][file] = String(piece.color || "").toLowerCase() === "white"
      ? letter.toUpperCase()
      : letter;
  }
  return grid.map((row) => {
    let output = "";
    let empty = 0;
    for (const cell of row) {
      if (!cell) {
        empty += 1;
        continue;
      }
      if (empty) {
        output += String(empty);
        empty = 0;
      }
      output += cell;
    }
    return output + (empty ? String(empty) : "");
  }).join("/");
}

function chessSideToMoveFromHistory(moves = []) {
  const moveCount = Array.isArray(moves)
    ? moves.map((move) => String(move || "").trim()).filter(Boolean).length
    : 0;
  if (!moveCount) return "";
  return moveCount % 2 === 0 ? "white" : "black";
}

function chessBoardStateFromSnapshot(snapshot = {}) {
  const board = chessBoardFromSnapshot(snapshot);
  if (!board) {
    throw new Error("Nenhum tabuleiro de xadrez ativo foi encontrado no snapshot do Workbench.");
  }
  const pieces = Array.from(chessPieceMap(board).values()).sort((a, b) => a.square.localeCompare(b.square));
  const playAs = String(board.playAs || board.controlledColor || board.orientation || "");
  const opponentColor = String(board.opponentColor || (playAs === "black" ? "white" : playAs === "white" ? "black" : ""));
  const lastMoveSquares = Array.isArray(board.lastMoveSquares) ? board.lastMoveSquares.map(normalizeChessSquare).filter(Boolean) : [];
  const lastMoveDestination = lastMoveSquares[lastMoveSquares.length - 1] || "";
  const lastMovePiece = lastMoveDestination ? pieces.find((piece) => piece.square === lastMoveDestination) : null;
  const inferredSideToMove = lastMovePiece?.color === "white" ? "black" : lastMovePiece?.color === "black" ? "white" : "";
  const gameOver = Boolean(board.gameOver || board.gameEnd);
  const boardRows = String(chessPiecePlacementFromBoard(board) || "")
    .split("/")
    .map((row, index) => `${8 - index}: ${row}`)
    .join(" | ");
  const moveHistorySan = Array.isArray(board.moveHistorySan) ? board.moveHistorySan.map((move) => String(move || "")).filter(Boolean) : [];
  const historySideToMove = chessSideToMoveFromHistory(moveHistorySan);
  const sideToMove = String(board.sideToMove || historySideToMove || inferredSideToMove || "");
  const isAgentTurn = Boolean(sideToMove && playAs && sideToMove === playAs);
  const turnInstruction = gameOver
    ? "The game is over. Report the result and stop chess tool calls."
    : sideToMove
    ? isAgentTurn
      ? `It is your turn as ${playAs}. Choose a ${playAs} move and call browser_chess_move(from_square,to_square) now.`
      : `It is not your turn. You are ${playAs}; sideToMove is ${sideToMove}. Call browser_chess_wait_turn(), then choose and play your next move when it returns.`
    : `Turn is unknown. If the last move was by ${opponentColor || "the opponent"}, choose a ${playAs || "your-side"} move and call browser_chess_move.`;
  return {
    ref: String(board.ref || "@board1"),
    orientation: String(board.orientation || "white"),
    orientationSource: String(board.orientationSource || ""),
    controlledColor: playAs,
    playAs,
    opponentColor,
    bottomColor: String(board.bottomColor || ""),
    topColor: String(board.topColor || ""),
    sideToMove,
    sideToMoveSource: String(board.sideToMoveSource || (historySideToMove ? "lichess-move-history" : inferredSideToMove ? "last-move-destination" : "")),
    turnText: String(board.turnText || ""),
    lastMoveSquares,
    lastMoveColor: String(board.lastMoveColor || lastMovePiece?.color || ""),
    isAgentTurn: gameOver ? false : isAgentTurn,
    gameOver,
    gameEnd: board.gameEnd || null,
    moveHistorySan,
    lichessBotGame: board.lichessBotGame || null,
    turnInstruction,
    piecePlacement: chessPiecePlacementFromBoard(board),
    fenBoard: chessPiecePlacementFromBoard(board),
    boardRows,
    pieces,
    whitePieces: pieces.filter((piece) => piece.color === "white").map((piece) => `${piece.piece}@${piece.square}`),
    blackPieces: pieces.filter((piece) => piece.color === "black").map((piece) => `${piece.piece}@${piece.square}`),
    moveTool: "browser_chess_move(from_square, to_square)",
    waitTool: "browser_chess_wait_turn(timeout_seconds)",
    note: "The model must choose the move. Squares in pieces/whitePieces/blackPieces/FEN are algebraic board coordinates from White's perspective, not screen coordinates. playAs/controlledColor is the side at the bottom of the Workbench board. sideToMove is inferred from live clock or last-move DOM markers when available. Move only your side, and only claim a move after browser_chess_move succeeds. If the game continues after a move, wait with browser_chess_wait_turn and keep playing until the game ends or the user stops."
  };
}

function validateChessMoveRequest(beforeSnapshot, fromSquare, movingPiece) {
  const boardState = chessBoardStateFromSnapshot(beforeSnapshot);
  if (boardState.playAs && movingPiece?.color && movingPiece.color !== boardState.playAs) {
    throw new Error(
      `Movimento de xadrez invalido: voce controla ${boardState.playAs}, mas ${fromSquare} contem uma peca ${movingPiece.color}. ` +
      `Leia browser_chess_state e escolha uma peca ${boardState.playAs}.`
    );
  }
  if (boardState.sideToMove && boardState.playAs && boardState.sideToMove !== boardState.playAs) {
    throw new Error(
      `Ainda nao e sua vez: voce controla ${boardState.playAs}, mas sideToMove=${boardState.sideToMove}. ` +
      "Aguarde a resposta do oponente e leia browser_chess_state novamente."
    );
  }
  return boardState;
}

async function waitForChessMoveApplied(webview, fromSquare, toSquare, beforeSnapshot = {}, timeoutMs = 2600) {
  const from = normalizeChessSquare(fromSquare);
  const to = normalizeChessSquare(toSquare);
  const movingPiece = chessPieceAtSnapshot(beforeSnapshot, from);
  const started = Date.now();
  let lastSnapshot = beforeSnapshot;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    lastSnapshot = await capturePreviewWebviewInfo(webview).catch(() => lastSnapshot);
    const fromPiece = chessPieceAtSnapshot(lastSnapshot, from);
    const toPiece = chessPieceAtSnapshot(lastSnapshot, to);
    const fromChanged = !fromPiece || (
      movingPiece &&
      (fromPiece.color !== movingPiece.color || fromPiece.piece !== movingPiece.piece)
    );
    const toReceivedPiece = Boolean(toPiece && movingPiece && toPiece.color === movingPiece.color && toPiece.piece === movingPiece.piece);
    if (fromChanged && (toReceivedPiece || !movingPiece)) {
      return { ok: true, snapshot: lastSnapshot, piece: movingPiece };
    }
  }
  const fromPiece = chessPieceAtSnapshot(lastSnapshot, from);
  const toPiece = chessPieceAtSnapshot(lastSnapshot, to);
  throw new Error(
    `Movimento de xadrez nao foi aplicado: ${from}-${to}. ` +
    `Origem=${fromPiece ? `${fromPiece.color} ${fromPiece.piece}` : "vazia"}, ` +
    `destino=${toPiece ? `${toPiece.color} ${toPiece.piece}` : "vazio"}.`
  );
}

async function performPreviewChessMove(webview, fromSquare, toSquare, beforeSnapshot = {}) {
  const from = normalizeChessSquare(fromSquare);
  const to = normalizeChessSquare(toSquare);
  const attempts = [];

  const sourcePoint = await previewChessSquarePoint(webview, from);
  const targetPoint = await previewChessSquarePoint(webview, to);

  try {
    await sendPreviewMouseClick(webview, sourcePoint, 90);
    await sendPreviewMouseClick(webview, targetPoint, 260);
    const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 4200);
    return { ...applied, method: "native-click-click", sourcePoint, targetPoint, attempts };
  } catch (error) {
    attempts.push({ method: "native-click-click", error: String(error?.message || error) });
  }

  try {
    await sendPreviewMouseClick(webview, targetPoint, 260);
    const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 2600);
    return { ...applied, method: "native-selected-target-click", sourcePoint, targetPoint, attempts };
  } catch (error) {
    attempts.push({ method: "native-selected-target-click", error: String(error?.message || error) });
  }

  try {
    await dragPreviewMouse(webview, sourcePoint, targetPoint, 360);
    const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 4200);
    return { ...applied, method: "native-drag", sourcePoint, targetPoint, attempts };
  } catch (error) {
    attempts.push({ method: "native-drag", error: String(error?.message || error) });
  }

  try {
    const domMove = await dispatchPreviewChessDomMove(webview, sourcePoint, targetPoint);
    const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 1800);
    return { ...applied, method: domMove.method || "dom-click-click", sourcePoint, targetPoint, attempts };
  } catch (error) {
    attempts.push({ method: "dom-click-click", error: String(error?.message || error) });
  }

  try {
    const domDrag = await dispatchPreviewChessDomDrag(webview, sourcePoint, targetPoint);
    const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 1800);
    return { ...applied, method: domDrag.method || "dom-drag", sourcePoint, targetPoint, attempts };
  } catch (error) {
    attempts.push({ method: "dom-drag", error: String(error?.message || error) });
  }

  try {
    const inputMove = await submitPreviewChessInputMove(webview, from, to, beforeSnapshot);
    return { ...inputMove, attempts };
  } catch (error) {
    attempts.push({ method: "accessibility-input", error: String(error?.message || error) });
  }

  const details = attempts.map((attempt) => `${attempt.method}: ${attempt.error}`).join(" | ");
  throw new Error(`Movimento de xadrez nao foi aplicado no cg-board ativo: ${from}-${to}. ${details}`);
}

async function submitPreviewChessInputMove(webview, fromSquare, toSquare, beforeSnapshot = {}) {
  const from = normalizeChessSquare(fromSquare);
  const to = normalizeChessSquare(toSquare);
  const movingPiece = chessPieceAtSnapshot(beforeSnapshot, from);
  const notations = Array.from(new Set([
    `${from}${to}`,
    `${from}-${to}`,
    movingPiece?.piece === "pawn" ? to : ""
  ].filter(Boolean)));
  const attempts = [];

  for (const notation of notations) {
    let target = null;
    try {
      target = await previewChessInputTarget(webview);
      await sendPreviewMouseClick(webview, target, 90);
      await clearPreviewChessInput(webview, target.selector);
      if (typeof webview.insertText === "function") {
        await webview.insertText(notation);
      } else {
        for (const char of notation) {
          webview.sendInputEvent({ type: "char", keyCode: char });
        }
      }
      webview.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      webview.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await dispatchPreviewChessInputSubmit(webview, target.selector, notation);
      const applied = await waitForChessMoveApplied(webview, from, to, beforeSnapshot, 2600);
      return {
        ...applied,
        method: `accessibility-input:${notation}`,
        inputPoint: target
      };
    } catch (error) {
      attempts.push(`${notation}: ${error?.message || error}`);
      if (target?.selector) {
        await clearPreviewChessInput(webview, target.selector).catch(() => {});
      }
    }
  }

  throw new Error(`input oficial do Lichess nao aceitou ${from}-${to}. ${attempts.join(" | ") || "Nenhum input visivel."}`);
}

async function previewChessInputTarget(webview) {
  const result = await webview.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 10 && rect.height > 10;
    };
    const selectorFor = (element) => {
      if (element.id && window.CSS?.escape) return "#" + CSS.escape(element.id);
      const name = element.getAttribute("name");
      if (name && window.CSS?.escape) return element.tagName.toLowerCase() + "[name='" + CSS.escape(name) + "']";
      const inputs = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, [contenteditable='true']"));
      const index = inputs.indexOf(element);
      return index >= 0 ? "__chess_input_index__:" + index : "";
    };
    const pageText = String(document.body?.innerText || "").toLowerCase();
    const candidates = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, [contenteditable='true']"))
      .filter(visible)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const attrs = [
          element.getAttribute("aria-label"),
          element.getAttribute("placeholder"),
          element.getAttribute("name"),
          element.getAttribute("title"),
          element.id
        ].map((value) => String(value || "").toLowerCase()).join(" ");
        let score = 0;
        if (/sua vez|your turn|formul[aá]rio de entrada|input form/.test(pageText)) score += 80;
        if (/move|lance|jogada|chess|san|uci|entrada|input/.test(attrs)) score += 60;
        if (rect.top > 0 && rect.top < window.innerHeight) score += 30;
        if (rect.left > 0 && rect.left < window.innerWidth) score += 20;
        return { element, index, rect, attrs, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < 40) {
      return { ok: false, error: "Nenhum formulario/input de lance do Lichess visivel." };
    }
    return {
      ok: true,
      selector: selectorFor(best.element),
      x: Math.round(best.rect.left + best.rect.width / 2),
      y: Math.round(best.rect.top + best.rect.height / 2),
      rect: {
        left: Math.round(best.rect.left),
        top: Math.round(best.rect.top),
        width: Math.round(best.rect.width),
        height: Math.round(best.rect.height)
      },
      attrs: best.attrs,
      score: best.score
    };
  })()`, true);
  if (!result?.ok) {
    throw new Error(result?.error || "Nenhum input de lance visivel.");
  }
  return {
    x: result.x,
    y: result.y,
    selector: result.selector,
    label: "Lichess move input",
    rect: result.rect
  };
}

async function clearPreviewChessInput(webview, selector = "") {
  await webview.executeJavaScript(`(() => {
    const selector = ${JSON.stringify(selector)};
    const resolve = () => {
      if (selector.startsWith("__chess_input_index__:")) {
        const index = Number(selector.split(":")[1]);
        return Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, [contenteditable='true']"))[index] || null;
      }
      try { return selector ? document.querySelector(selector) : document.activeElement; } catch { return document.activeElement; }
    };
    const element = resolve();
    if (!element) return false;
    element.focus();
    if ("value" in element) {
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      element.textContent = "";
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
    return true;
  })()`, true);
}

async function dispatchPreviewChessInputSubmit(webview, selector = "", notation = "") {
  await webview.executeJavaScript(`(() => {
    const selector = ${JSON.stringify(selector)};
    const notation = ${JSON.stringify(notation)};
    const resolve = () => {
      if (selector.startsWith("__chess_input_index__:")) {
        const index = Number(selector.split(":")[1]);
        return Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, [contenteditable='true']"))[index] || null;
      }
      try { return selector ? document.querySelector(selector) : document.activeElement; } catch { return document.activeElement; }
    };
    const element = resolve();
    if (!element) return false;
    element.focus();
    if ("value" in element && !element.value) element.value = notation;
    for (const type of ["keydown", "keypress", "keyup"]) {
      element.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
    }
    if (element.form?.requestSubmit) {
      try { element.form.requestSubmit(); } catch {}
    }
    return true;
  })()`, true).catch(() => false);
}

async function waitForPreviewChessTurn(webview, timeoutMs = 30000) {
  const started = Date.now();
  let lastState = null;
  let lastError = null;
  const cappedTimeout = Math.max(800, Math.min(Number(timeoutMs || 30000), 120000));
  while (Date.now() - started < cappedTimeout) {
    try {
      const snapshot = await capturePreviewWebviewInfo(webview);
      lastState = chessBoardStateFromSnapshot(snapshot);
      if (lastState.gameOver) {
        return {
          ok: true,
          waitedMs: Date.now() - started,
          chessState: lastState,
          gameOver: true
        };
      }
      if (lastState.isAgentTurn === true) {
        return {
          ok: true,
          waitedMs: Date.now() - started,
          chessState: lastState
        };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  const stateText = lastState
    ? formatChessStateSummary("ultimo estado", lastState)
    : String(lastError?.message || "sem estado de tabuleiro");
  throw new Error(`Ainda nao voltou sua vez apos ${cappedTimeout}ms. ${stateText}`);
}

async function runPreviewHarnessStep(webview, rawStep = {}, index = 0) {
  const type = String(rawStep.type || "snapshot").trim();
  const maxTimeoutMs = type === "chess_move" || type === "move_chess_piece" || type === "chess_wait_turn" || type === "wait_chess_turn"
    ? 120000
    : 60000;
  const timeoutMs = Math.max(500, Math.min(Number(rawStep.timeoutMs || 8000), maxTimeoutMs));
  if (type === "snapshot" || type === "screenshot") {
    await snapshotPreviewWebview(webview);
    return `${index + 1}. ${type} ok`;
  }
  if (type === "chess_state" || type === "board_state") {
    const snapshot = await capturePreviewWebviewInfo(webview);
    const boardState = chessBoardStateFromSnapshot(snapshot);
    return formatChessStateSummary(`${index + 1}. chess_state ok`, boardState);
  }
  if (type === "chess_wait_turn" || type === "wait_chess_turn") {
    const waited = await waitForPreviewChessTurn(webview, Math.max(800, timeoutMs - 3000));
    return formatChessStateSummary(`${index + 1}. chess_wait_turn ok waitedMs=${waited.waitedMs}`, waited.chessState);
  }
  if (type === "wait_for_selector") {
    const selector = String(rawStep.selector || "").trim();
    if (!selector) throw new Error("wait_for_selector exige selector.");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = await webview.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true).catch(() => false);
      if (found) return `${index + 1}. wait_for_selector ok: ${selector}`;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`selector nao encontrado: ${selector}`);
  }
  if (type === "wait_for_text") {
    const text = String(rawStep.text || "").trim();
    if (!text) throw new Error("wait_for_text exige text.");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = await webview.executeJavaScript(`Boolean(document.body?.innerText?.includes(${JSON.stringify(text)}))`, true).catch(() => false);
      if (found) return `${index + 1}. wait_for_text ok: ${text}`;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`texto nao encontrado: ${text}`);
  }
  if (type === "click") {
    const point = await previewElementPoint(webview, rawStep);
    await clickPreviewPoint(webview, point);
    return `${index + 1}. click ok: ${point.ref || point.selector || `${point.x},${point.y}`}`;
  }
  if (type === "chess_move" || type === "move_chess_piece") {
    const fromSquare = normalizeChessSquare(rawStep.fromSquare || rawStep.from_square || rawStep.from);
    const toSquare = normalizeChessSquare(rawStep.toSquare || rawStep.to_square || rawStep.to);
    const beforeSnapshot = await capturePreviewWebviewInfo(webview);
    const movingPiece = chessPieceAtSnapshot(beforeSnapshot, fromSquare);
    if (!movingPiece) {
      throw new Error(`Movimento de xadrez invalido: nenhuma peca encontrada em ${fromSquare}. Use chess_state/browser_snapshot e escolha uma casa ocupada.`);
    }
    validateChessMoveRequest(beforeSnapshot, fromSquare, movingPiece);
    const applied = await performPreviewChessMove(webview, fromSquare, toSquare, beforeSnapshot);
    return `${index + 1}. chess_move ok: ${fromSquare}-${toSquare} (${applied.method})`;
  }
  if (type === "click_square" || type === "chess_click_square") {
    const square = normalizeChessSquare(rawStep.square || rawStep.chessSquare || rawStep.chess_square);
    await clickPreviewChessSquare(webview, square);
    return `${index + 1}. click_square ok: ${square}`;
  }
  if (type === "fill") {
    const text = String(rawStep.text || "");
    const point = await previewElementPoint(webview, rawStep);
    if (point) {
      await clickPreviewPoint(webview, point);
    }
    const selector = String(rawStep.selector || point?.selector || "").trim();
    if (selector) {
      await webview.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.focus();
        element.value = ${JSON.stringify(text)};
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`, true);
    } else if (typeof webview.insertText === "function") {
      await webview.insertText(text);
    } else {
      for (const char of text) {
        webview.sendInputEvent({ type: "char", keyCode: char });
      }
    }
    return `${index + 1}. fill ok: ${selector || point?.ref || "focused"}`;
  }
  if (type === "press") {
    const key = String(rawStep.key || "").trim();
    if (!key) throw new Error("press exige key.");
    const snapshot = await capturePreviewWebviewInfo(webview).catch(() => null);
    if (String(snapshot?.url || "").includes("lichess.org") && Array.isArray(snapshot?.chessBoards) && snapshot.chessBoards.length) {
      throw new Error(
        "press bloqueado no Lichess com tabuleiro ativo. Para jogar xadrez, use chess_state e chess_move; " +
        "teclas soltas como letras/numeros nao sao movimentos confiaveis."
      );
    }
    webview.sendInputEvent({ type: "keyDown", keyCode: key });
    webview.sendInputEvent({ type: "keyUp", keyCode: key });
    return `${index + 1}. press ok: ${key}`;
  }
  if (type === "scroll") {
    const direction = String(rawStep.direction || "down").toLowerCase() === "up" ? "up" : "down";
    const pixels = Math.max(80, Math.min(Number(rawStep.pixels || Math.abs(Number(rawStep.deltaY || 700))), 4000));
    const deltaY = Number.isFinite(Number(rawStep.deltaY)) ? Number(rawStep.deltaY) : direction === "up" ? -pixels : pixels;
    const deltaX = Number.isFinite(Number(rawStep.deltaX)) ? Number(rawStep.deltaX) : 0;
    webview.sendInputEvent({ type: "mouseWheel", x: 20, y: 20, deltaX, deltaY });
    await webview.executeJavaScript(`window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})`, true).catch(() => {});
    return `${index + 1}. scroll ok: ${deltaX},${deltaY}`;
  }
  throw new Error(`Tipo de passo nao suportado: ${type}`);
}

function browserControlStepsFromCommand(command = {}) {
  const explicitSteps = Array.isArray(command.steps) ? command.steps : [];
  if (explicitSteps.length) {
    return explicitSteps;
  }
  const operation = String(command.command || command.operation || "").trim().toLowerCase();
  if (![
    "wait_for_selector",
    "wait_for_text",
    "click",
    "fill",
    "press",
    "scroll",
    "screenshot",
    "chess_state",
    "board_state",
    "chess_wait_turn",
    "wait_chess_turn",
    "chess_move",
    "click_square"
  ].includes(operation)) {
    return [];
  }
  const step = {
    type: operation,
    ref: command.ref || undefined,
    selector: command.selector || undefined,
    text: typeof command.text === "string" ? command.text : undefined,
    key: command.key || undefined,
    x: Number.isFinite(Number(command.x)) ? Number(command.x) : undefined,
    y: Number.isFinite(Number(command.y)) ? Number(command.y) : undefined,
    direction: command.direction || undefined,
    deltaX: Number.isFinite(Number(command.deltaX)) ? Number(command.deltaX) : undefined,
    deltaY: Number.isFinite(Number(command.deltaY)) ? Number(command.deltaY) : undefined,
    pixels: Number.isFinite(Number(command.pixels)) ? Number(command.pixels) : undefined,
    timeoutMs: Number.isFinite(Number(command.timeoutMs)) ? Number(command.timeoutMs) : undefined,
    fromSquare: command.fromSquare || command.from_square || undefined,
    toSquare: command.toSquare || command.to_square || undefined,
    square: command.square || undefined,
    promotion: command.promotion || undefined
  };
  return [Object.fromEntries(Object.entries(step).filter(([, value]) => typeof value !== "undefined"))];
}

function normalizePreviewHarnessCommand(command = {}) {
  const type = String(command.type || "browser_control").trim().toLowerCase();
  if (type === "browser_session_state") {
    return { ...command, type: "browser_harness", command: "session_state" };
  }
  if (type === "browser_control") {
    const steps = browserControlStepsFromCommand(command);
    const operation = String(command.command || command.operation || "").trim().toLowerCase();
    return {
      ...command,
      steps,
      type: "browser_harness",
      command: steps.length
        ? "sequence"
        : String(command.url || "").trim()
          ? "goto"
          : ["page_info", "snapshot", "session_state"].includes(operation)
            ? operation
            : "page_info"
    };
  }
  return {
    ...command,
    type: "browser_harness",
    command: String(command.command || command.operation || "page_info").trim().toLowerCase()
  };
}

function isPreviewNavigationCommand(command = {}) {
  const name = String(command.command || command.operation || command.type || "").trim().toLowerCase();
  return name === "goto" || name === "navigate" || name === "open";
}

function isLichessHomeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const pathName = url.pathname.replace(/\/+$/, "") || "/";
    return (host === "lichess.org" || host.endsWith(".lichess.org")) && pathName === "/";
  } catch {
    return false;
  }
}

function isLichessUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return host === "lichess.org" || host.endsWith(".lichess.org");
  } catch {
    return false;
  }
}

function isLichessGameUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const gameId = String(url.pathname || "").split("/").filter(Boolean)[0] || "";
    return (host === "lichess.org" || host.endsWith(".lichess.org")) && /^[A-Za-z0-9]{8,12}$/.test(gameId);
  } catch {
    return false;
  }
}

function snapshotHasActiveChessGame(snapshot = {}) {
  return (Array.isArray(snapshot?.chessBoards) ? snapshot.chessBoards : [])
    .some((board) => board?.activeGame === true);
}

function snapshotHasLichessSetupFlow(snapshot = {}) {
  const labels = [
    snapshot?.title,
    snapshot?.textPreview,
    ...(Array.isArray(snapshot?.interactiveElements)
      ? snapshot.interactiveElements.map((entry) =>
          [entry?.label, entry?.accessibleName, entry?.name, entry?.ariaLabel, entry?.selector].filter(Boolean).join(" ")
        )
      : [])
  ].join("\n");
  return /\b(Jogar contra o computador|Play with the computer|Play against the computer|Tempo real|Correspond[eê]ncia|Ilimitado|N[ií]vel|Brancas|Pretas|Cor aleat[oó]ria)\b/i.test(labels);
}

function shouldPreserveActiveLichessGame(webview, targetUrl) {
  if (!isLichessHomeUrl(targetUrl)) {
    return false;
  }
  if (!previewHarnessBelongsToCurrentChat() || !previewWebviewBelongsToCurrentChat(webview)) {
    return false;
  }
  const cached = state.previewHarness.lastSnapshot || {};
  if (
    snapshotHasActiveChessGame(cached) ||
    snapshotHasLichessSetupFlow(cached) ||
    isLichessGameUrl(cached.url || state.previewHarness.url)
  ) {
    return true;
  }
  const current = currentPreviewWebviewUrl(webview);
  return isLichessGameUrl(current) || (isLichessUrl(current) && snapshotHasLichessSetupFlow(cached));
}

function shouldNavigatePreviewTo(webview, targetUrl) {
  const url = String(targetUrl || "").trim();
  if (!url) return false;
  if (shouldPreserveActiveLichessGame(webview, url)) return false;
  const current = currentPreviewWebviewUrl(webview);
  if (!current) return true;
  if (previewUrlsMatch(current, url)) return false;
  try {
    const currentUrl = new URL(current);
    const nextUrl = new URL(url);
    if (currentUrl.origin !== nextUrl.origin) return true;
    const nextPath = nextUrl.pathname.replace(/\/+$/, "") || "/";
    const currentPath = currentUrl.pathname.replace(/\/+$/, "") || "/";
    if (nextPath === "/" && currentPath !== "/") return false;
    return true;
  } catch {
    return true;
  }
}

function compactHarnessText(value, maxLength = 900) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatChessStateSummary(prefix, boardState = {}) {
  const lastMove = Array.isArray(boardState.lastMoveSquares) && boardState.lastMoveSquares.length
    ? boardState.lastMoveSquares.join("-")
    : "none";
  const agentTurn = boardState.isAgentTurn === true ? "yes" : boardState.isAgentTurn === false ? "no" : "unknown";
  const instruction = compactHarnessText(boardState.turnInstruction || "", 220);
  const white = Array.isArray(boardState.whitePieces) ? boardState.whitePieces.join(" ") : "";
  const black = Array.isArray(boardState.blackPieces) ? boardState.blackPieces.join(" ") : "";
  const history = Array.isArray(boardState.moveHistorySan) && boardState.moveHistorySan.length
    ? ` movesSan=[${compactHarnessText(boardState.moveHistorySan.join(" "), 180)}]`
    : "";
  const gameEnd = boardState.gameEnd ? ` gameEnd=${compactHarnessText(JSON.stringify(boardState.gameEnd), 140)}` : "";
  return `${prefix}: playAs=${boardState.playAs || "unknown"} sideToMove=${boardState.sideToMove || "unknown"} agentTurn=${agentTurn} gameOver=${boardState.gameOver ? "yes" : "no"} turnText=${boardState.turnText || "none"} lastMove=${lastMove} orientation=${boardState.orientation}/${boardState.orientationSource || "unknown"} fen=${boardState.fenBoard || boardState.piecePlacement}${history}${gameEnd} white=[${white}] black=[${black}]${instruction ? ` instruction=${instruction}` : ""}`;
}

function isHarnessEntryNearViewport(entry = {}, viewport = null) {
  const rect = entry?.rect || {};
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  if (width <= 0 || height <= 0) return false;
  const left = Number(rect.left || 0);
  const top = Number(rect.top || 0);
  const right = left + width;
  const bottom = top + height;
  const viewportWidth = Number(viewport?.width || 0) || 1200;
  const viewportHeight = Number(viewport?.height || 0) || 900;
  return right >= -80 && bottom >= -80 && left <= viewportWidth + 120 && top <= viewportHeight + 160;
}

function compactHarnessEntry(entry = {}) {
  const rect = entry?.rect || {};
  return {
    ref: String(entry.ref || ""),
    tag: String(entry.tag || ""),
    role: String(entry.role || ""),
    type: String(entry.type || ""),
    label: compactHarnessText(entry.label || entry.accessibleName || entry.name || entry.ariaLabel || "", 140),
    selector: compactHarnessText(entry.selector || "", 180),
    x: Number.isFinite(Number(entry.x)) ? Number(entry.x) : undefined,
    y: Number.isFinite(Number(entry.y)) ? Number(entry.y) : undefined,
    rect: {
      left: Math.round(Number(rect.left || 0)),
      top: Math.round(Number(rect.top || 0)),
      width: Math.round(Number(rect.width || 0)),
      height: Math.round(Number(rect.height || 0))
    }
  };
}

function harnessEntryScore(entry = {}, snapshot = {}) {
  const viewport = snapshot.viewport || null;
  const rect = entry?.rect || {};
  const tag = String(entry.tag || "").toLowerCase();
  const role = String(entry.role || "").toLowerCase();
  const selector = String(entry.selector || "").toLowerCase();
  const label = normalizePreviewElementLabel(entry.label || entry.accessibleName || entry.name || entry.ariaLabel || "");
  const viewportHeight = Number(viewport?.height || 0) || 900;
  const viewportWidth = Number(viewport?.width || 0) || 1200;
  const top = Number(rect.top || 0);
  const left = Number(rect.left || 0);
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  const centerY = Number(entry.y ?? (top + height / 2));
  const centerX = Number(entry.x ?? (left + width / 2));
  let score = 0;

  if (isHarnessEntryNearViewport(entry, viewport)) score += 80;
  if (centerY >= 0 && centerY <= viewportHeight && centerX >= 0 && centerX <= viewportWidth) score += 40;
  if (["button", "input", "select", "textarea", "summary"].includes(tag)) score += 110;
  if (["button", "link", "textbox", "menuitem", "option", "tab"].includes(role)) score += 80;
  if (tag === "a") score += 55;
  if (selector.includes("aria-label") || selector.includes("data-testid") || selector.includes("title=") || selector.includes("#")) score += 20;
  if (label) score += Math.min(30, label.length / 3);

  const isLargeRepeatedRow = ["tr", "td", "li"].includes(tag) || (width >= viewportWidth * 0.72 && height <= 56 && role !== "button");
  if (isLargeRepeatedRow) score -= 95;
  if (["div", "span", "svg"].includes(tag) && !role && !selector.includes("href=")) score -= 45;
  if (!label && !selector) score -= 120;
  if (top > viewportHeight + 240) score -= Math.min(180, (top - viewportHeight) / 6);
  if (top < -160) score -= 80;

  return score;
}

function compactHarnessEntries(entries = [], snapshot = {}, maxEntries = 28) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  return list
    .filter((entry) => !isLichessBlindModeToggleLabel(entry.label || entry.accessibleName || entry.name || entry.ariaLabel || ""))
    .map((entry, index) => ({ entry, index, score: harnessEntryScore(entry, snapshot) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, maxEntries)
    .map(({ entry }) => compactHarnessEntry(entry))
    .filter((entry) => entry.ref || entry.label || entry.selector);
}

function compactHarnessMessages(messages = [], maxEntries = 6) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-maxEntries)
    .map((message) => compactHarnessText(message, 240));
}

function compactHarnessChessBoards(boards = []) {
  return (Array.isArray(boards) ? boards : [])
    .filter(Boolean)
    .slice(0, 4)
    .map((board) => {
      const pieces = (Array.isArray(board.pieces) ? board.pieces : [])
        .slice(0, 40)
        .map((piece) => ({
          square: String(piece.square || ""),
          color: String(piece.color || ""),
          piece: String(piece.piece || "")
        }))
        .filter((piece) => piece.square && piece.color && piece.piece);
      const lastMoveSquares = Array.isArray(board.lastMoveSquares)
        ? board.lastMoveSquares.map((square) => normalizeChessSquare(square)).filter(Boolean)
        : [];
      const lastMoveDestination = lastMoveSquares[lastMoveSquares.length - 1] || "";
      const lastMovePiece = lastMoveDestination ? pieces.find((piece) => piece.square === lastMoveDestination) : null;
      const inferredSideToMove = lastMovePiece?.color === "white" ? "black" : lastMovePiece?.color === "black" ? "white" : "";
      const gameOver = Boolean(board.gameOver || board.gameEnd);
      const moveHistorySan = Array.isArray(board.moveHistorySan)
        ? board.moveHistorySan.map((move) => String(move || "")).filter(Boolean).slice(-24)
        : [];
      const historySideToMove = chessSideToMoveFromHistory(moveHistorySan);
      const sideToMove = String(board.sideToMove || historySideToMove || inferredSideToMove || "");
      const playAs = String(board.playAs || board.controlledColor || board.orientation || "white");
      return {
        ref: String(board.ref || ""),
        kind: "chess",
        engine: String(board.engine || "dom-board"),
        selector: compactHarnessText(board.selector || "", 180),
        activeGame: Boolean(board.activeGame),
        orientation: String(board.orientation || "white"),
        orientationSource: String(board.orientationSource || ""),
        controlledColor: playAs,
        playAs,
        opponentColor: String(board.opponentColor || (String(board.orientation || "white") === "black" ? "white" : "black")),
        bottomColor: String(board.bottomColor || ""),
        topColor: String(board.topColor || ""),
        sideToMove,
        sideToMoveSource: String(board.sideToMoveSource || (historySideToMove ? "lichess-move-history" : inferredSideToMove ? "last-move-destination" : "")),
        turnText: String(board.turnText || ""),
        lastMoveSquares,
        lastMoveColor: String(board.lastMoveColor || lastMovePiece?.color || ""),
        isAgentTurn: gameOver ? false : Boolean(sideToMove && playAs && sideToMove === playAs),
        gameOver,
        gameEnd: board.gameEnd || null,
        moveHistorySan,
        lichessBotGame: board.lichessBotGame || null,
        orientationMeaning: String(board.orientationMeaning || "playAs/controlledColor is the side visually at the bottom of the Workbench board"),
        squareSize: Number(board.squareSize || 0),
        rect: board.rect || null,
        pieces,
        piecePlacement: chessPiecePlacementFromBoard({ pieces }),
        position: board.position || {},
        stateTool: "browser_chess_state()",
        moveTool: "browser_chess_move(from_square, to_square)",
        instruction: "Choose the move from this structured board state, then call moveTool. The app does not choose moves or claim moves without tool success."
      };
    });
}

function browserHarnessSnapshotPayload(snapshot = {}, extra = {}) {
  const interactiveElements = Array.isArray(snapshot.interactiveElements) ? snapshot.interactiveElements : [];
  const landmarks = Array.isArray(snapshot.landmarks) ? snapshot.landmarks : [];
  const chessBoards = compactHarnessChessBoards(snapshot.chessBoards);
  const hasGameBoard = chessBoards.length > 0;
  const snapshotUrl = String(snapshot.url || (previewHarnessBelongsToCurrentChat() ? state.previewHarness.url : "") || "");
  const activeChessGame = chessBoards.some((board) => board.activeGame) ||
    /^https:\/\/(?:[^/]+\.)?lichess\.org\/[A-Za-z0-9]{8,12}(?:\/|$)/i.test(snapshotUrl);
  const compactInteractive = compactHarnessEntries(interactiveElements, snapshot, activeChessGame ? 4 : hasGameBoard ? 16 : 42);
  const compactLandmarks = hasGameBoard ? [] : compactHarnessEntries(landmarks, snapshot, 10);
  const { interactiveElements: _ignoredInteractive, landmarks: _ignoredLandmarks, chessBoards: _ignoredChessBoards, ...safeExtra } = extra || {};
  return {
    source: "browser-harness-workbench",
    url: snapshotUrl,
    title: String(snapshot.title || ""),
    textLength: Number(snapshot.textLength || 0),
    visibleElements: Number(snapshot.visibleElements || 0),
    textPreview: compactHarnessText(snapshot.textPreview || "", activeChessGame ? 120 : hasGameBoard ? 320 : 900),
    viewport: snapshot.viewport || null,
    scroll: snapshot.scroll || null,
    interactiveElements: compactInteractive,
    landmarks: compactLandmarks,
    chessBoards,
    omittedInteractiveElements: Math.max(0, interactiveElements.length - compactInteractive.length),
    omittedLandmarks: Math.max(0, landmarks.length - compactLandmarks.length),
    consoleMessages: compactHarnessMessages(previewHarnessBelongsToCurrentChat() ? state.previewHarness.consoleMessages : []),
    pageErrors: compactHarnessMessages(previewHarnessBelongsToCurrentChat() ? state.previewHarness.pageErrors : []),
    updatedAt: previewHarnessBelongsToCurrentChat() ? state.previewHarness.updatedAt || Date.now() : Date.now(),
    ...safeExtra
  };
}

async function preparePreviewHarnessWebview(command = {}) {
  ensurePreviewHarnessChatScope();
  const commandChatId = String(command.chatId || "").trim();
  const chatId = currentChatId();
  if (commandChatId && chatId && commandChatId !== chatId) {
    throw new Error("Comando do browser pertence a outro chat; o Preview atual foi isolado para este topico.");
  }
  const mayNavigate = isPreviewNavigationCommand(command);
  let requestedUrl = mayNavigate ? String(command.url || "").trim() : "";
  const passiveUrl = mayNavigate ? "" : String(command.url || "").trim();
  const knownUrl = previewHarnessBelongsToCurrentChat() ? String(state.previewHarness.url || "").trim() : "";
  const targetUrl = requestedUrl || knownUrl || passiveUrl;
  const preserveCachedGame = requestedUrl && isLichessHomeUrl(requestedUrl) && (
    snapshotHasActiveChessGame(state.previewHarness.lastSnapshot || {}) ||
    isLichessGameUrl(knownUrl)
  );
  if (preserveCachedGame) {
    command.navigationSkipped = "active-lichess-game";
    requestedUrl = "";
  }
  if (requestedUrl) {
    state.previewHarness.url = requestedUrl;
    state.previewHarness.updatedAt = Date.now();
    state.workbenchView = "preview";
    state.panelOpen = true;
    if (String(command.deviceMode || "").trim()) {
      setPreviewDeviceMode(command.deviceMode);
    }
    state.renderCache.workbench = "";
    renderShell();
    renderWorkbenchPanel();
  }

  const webview = await waitForActivePreviewWebview(3000);
  if (!webview) {
    throw new Error("Preview desktop nao esta disponivel. Abra uma URL no Workbench antes de controlar o browser.");
  }
  markPreviewWebviewOwner(webview);
  bindPreviewWebviewTelemetry(webview);

  if (requestedUrl && shouldPreserveActiveLichessGame(webview, requestedUrl)) {
    command.navigationSkipped = "active-lichess-game";
    requestedUrl = "";
    state.previewHarness.url = currentPreviewWebviewUrl(webview) || state.previewHarness.lastSnapshot?.url || knownUrl;
  }

  if (requestedUrl && shouldNavigatePreviewTo(webview, requestedUrl)) {
    try {
      delete webview.dataset.previewDomReady;
      webview.loadURL(requestedUrl);
    } catch {}
  }
  await waitForPreviewWebviewReady(
    webview,
    Math.max(1200, Math.min(Number(command.timeoutMs || 15000), 60000)),
    requestedUrl || ""
  );
  if (!requestedUrl && targetUrl) {
    state.previewHarness.url = currentPreviewWebviewUrl(webview) || knownUrl || passiveUrl;
    state.previewHarness.updatedAt = Date.now();
  }
  return webview;
}

async function capturePreviewWebviewInfo(webview) {
  const snapshot = await snapshotPreviewWebview(webview);
  if (previewWebviewBelongsToCurrentChat(webview)) {
    state.previewHarness.url = snapshot.url || state.previewHarness.url;
    state.previewHarness.updatedAt = Date.now();
  }
  return snapshot;
}

async function runBrowserHarnessPrimitive(webview, command = {}, index = 0) {
  const name = String(command.command || command.type || "page_info").trim().toLowerCase();
  const maxTimeoutMs = name === "chess_move" || name === "move_chess_piece" || name === "chess_wait_turn" || name === "wait_chess_turn"
    ? 120000
    : 60000;
  const timeoutMs = Math.max(500, Math.min(Number(command.timeoutMs || 8000), maxTimeoutMs));

  if (name === "goto" || name === "navigate" || name === "open") {
    const url = String(command.url || "").trim();
    if (!url) throw new Error("browser_harness.goto exige url.");
    if (command.navigationSkipped === "active-lichess-game" || shouldPreserveActiveLichessGame(webview, url)) {
      const snapshot = await capturePreviewWebviewInfo(webview);
      return {
        ok: true,
        command: name,
        summary: `${index + 1}. goto ignorado: partida ativa do Lichess preservada (${snapshot.url || state.previewHarness.url || "url atual"})`,
        snapshot
      };
    }
    if (shouldNavigatePreviewTo(webview, url)) {
      delete webview.dataset.previewDomReady;
      try {
        webview.loadURL(url);
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        webview.loadURL(url);
      }
    }
    await waitForPreviewWebviewReady(webview, timeoutMs, url);
    const snapshot = await capturePreviewWebviewInfo(webview);
    return { ok: true, command: name, summary: `${index + 1}. goto ok: ${snapshot.url || url}` };
  }

  if (name === "page_info" || name === "snapshot" || name === "session_state") {
    const snapshot = await capturePreviewWebviewInfo(webview);
    return { ok: true, command: name, summary: `${index + 1}. ${name} ok`, snapshot };
  }

  if (name === "chess_state" || name === "board_state") {
    const snapshot = await capturePreviewWebviewInfo(webview);
    const chessState = chessBoardStateFromSnapshot(snapshot);
    return {
      ok: true,
      command: name,
      summary: formatChessStateSummary(`${index + 1}. chess_state ok`, chessState),
      result: { chessState }
    };
  }

  if (name === "chess_wait_turn" || name === "wait_chess_turn") {
    const waited = await waitForPreviewChessTurn(webview, Math.max(800, timeoutMs - 3000));
    return {
      ok: true,
      command: name,
      summary: formatChessStateSummary(`${index + 1}. chess_wait_turn ok waitedMs=${waited.waitedMs}`, waited.chessState),
      result: {
        waitedMs: waited.waitedMs,
        chessState: waited.chessState,
        instruction: waited.chessState?.gameOver
          ? "The game is over. Report the result and stop chess tool calls."
          : "It is your turn now. Choose a legal move from chessState and call browser_chess_move(from_square,to_square). Do not summarize while the game is still active."
      }
    };
  }

  if (name === "screenshot") {
    const snapshot = await capturePreviewWebviewInfo(webview);
    let screenshot = null;
    try {
      if (typeof webview.capturePage === "function") {
        const image = await webview.capturePage();
        const size = image?.getSize?.() || null;
        screenshot = { captured: true, size };
      }
    } catch (error) {
      screenshot = { captured: false, error: String(error?.message || error) };
    }
    return { ok: true, command: name, summary: `${index + 1}. screenshot ok`, snapshot, screenshot };
  }

  if (name === "click") {
    const point = await previewElementPoint(webview, command);
    const clicked = await clickPreviewPoint(webview, point);
    return { ok: true, command: name, summary: `${index + 1}. click ok: ${clicked.ref || clicked.selector || `${clicked.x},${clicked.y}`} ${clicked.label ? `(${clicked.label})` : ""}`.trim() };
  }

  if (name === "chess_move" || name === "move_chess_piece") {
    const fromSquare = normalizeChessSquare(command.fromSquare || command.from_square || command.from);
    const toSquare = normalizeChessSquare(command.toSquare || command.to_square || command.to);
    const beforeSnapshot = await capturePreviewWebviewInfo(webview);
    const movingPiece = chessPieceAtSnapshot(beforeSnapshot, fromSquare);
    if (!movingPiece) {
      throw new Error(`Movimento de xadrez invalido: nenhuma peca encontrada em ${fromSquare}. Atualize o snapshot e escolha uma casa de origem com peca.`);
    }
    validateChessMoveRequest(beforeSnapshot, fromSquare, movingPiece);
    const applied = await performPreviewChessMove(webview, fromSquare, toSquare, beforeSnapshot);
    const afterSnapshot = await capturePreviewWebviewInfo(webview);
    const chessState = chessBoardStateFromSnapshot(afterSnapshot);
    const followUpInstruction = chessState.gameOver
      ? "The game is over. Report the result and stop chess tool calls."
      : chessState.isAgentTurn === true
      ? "It is still your turn. Choose and execute the next legal move now."
      : "Move succeeded. If the game is still active, call browser_chess_wait_turn(), then choose and execute the next legal move when your turn returns.";
    return {
      ok: true,
      command: name,
      summary: `${index + 1}. chess_move ok: ${fromSquare}-${toSquare} (${applied.method}); ${formatChessStateSummary("after", chessState)} followUp=${followUpInstruction}`,
      result: {
        fromSquare,
        toSquare,
        method: applied.method,
        chessState,
        instruction: followUpInstruction
      }
    };
  }

  if (name === "click_square" || name === "chess_click_square") {
    const square = normalizeChessSquare(command.square || command.chessSquare || command.chess_square);
    await clickPreviewChessSquare(webview, square);
    return { ok: true, command: name, summary: `${index + 1}. click_square ok: ${square}` };
  }

  if (name === "type_text" || name === "fill") {
    const text = String(command.text || "");
    const point = await previewElementPoint(webview, command);
    if (point) {
      await clickPreviewPoint(webview, point);
    }
    const selector = String(command.selector || point?.selector || "").trim();
    if (selector) {
      await webview.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.focus();
        if ("value" in element) {
          element.value = ${JSON.stringify(text)};
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          element.textContent = ${JSON.stringify(text)};
          element.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(text)} }));
        }
        return true;
      })()`, true);
    } else if (typeof webview.insertText === "function") {
      await webview.insertText(text);
    } else {
      for (const char of text) {
        webview.sendInputEvent({ type: "char", keyCode: char });
      }
    }
    return { ok: true, command: name, summary: `${index + 1}. type_text ok: ${selector || point?.ref || "focused"}` };
  }

  if (name === "press_key" || name === "press") {
    const key = String(command.key || "").trim();
    if (!key) throw new Error("browser_harness.press_key exige key.");
    const snapshot = await capturePreviewWebviewInfo(webview).catch(() => null);
    if (String(snapshot?.url || "").includes("lichess.org") && Array.isArray(snapshot?.chessBoards) && snapshot.chessBoards.length) {
      throw new Error(
        "browser_harness.press_key bloqueado no Lichess com tabuleiro ativo. " +
        "Use browser_chess_state e browser_chess_move(from_square,to_square)."
      );
    }
    webview.sendInputEvent({ type: "keyDown", keyCode: key });
    webview.sendInputEvent({ type: "keyUp", keyCode: key });
    return { ok: true, command: name, summary: `${index + 1}. press_key ok: ${key}` };
  }

  if (name === "scroll") {
    const pixels = Math.max(80, Math.min(Number(command.pixels || Math.abs(Number(command.deltaY || 700))), 4000));
    const deltaY = Number.isFinite(Number(command.deltaY)) && Number(command.deltaY) !== 0
      ? Number(command.deltaY)
      : String(command.direction || "down").toLowerCase() === "up" ? -pixels : pixels;
    const deltaX = Number.isFinite(Number(command.deltaX)) ? Number(command.deltaX) : 0;
    webview.sendInputEvent({ type: "mouseWheel", x: 40, y: 40, deltaX, deltaY });
    await webview.executeJavaScript(`window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})`, true).catch(() => {});
    return { ok: true, command: name, summary: `${index + 1}. scroll ok: ${deltaX},${deltaY}` };
  }

  if (name === "js" || name === "eval") {
    const expression = String(command.expression || command.script || "").trim();
    if (!expression) throw new Error("browser_harness.js exige expression.");
    const result = await webview.executeJavaScript(expression, true);
    return { ok: true, command: name, summary: `${index + 1}. js ok`, result };
  }

  if (name === "back") {
    try {
      if (typeof webview.canGoBack === "function" && webview.canGoBack()) {
        webview.goBack();
      } else {
        await webview.executeJavaScript("history.back()", true);
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: true, command: name, summary: `${index + 1}. back ok` };
  }

  return { ok: true, command: name, summary: await runPreviewHarnessStep(webview, { ...command, type: name }, index) };
}

async function runBrowserHarnessCommand(rawCommand = {}) {
  ensurePreviewHarnessChatScope();
  const command = normalizePreviewHarnessCommand(rawCommand);
  const commandName = String(command.command || "page_info").trim().toLowerCase();
  const commandChatId = String(command.chatId || "").trim();
  const chatId = currentChatId();
  if (commandChatId && chatId && commandChatId !== chatId) {
    throw new Error("Comando do browser pertence a outro chat; o Preview atual foi isolado para este topico.");
  }
  const cached = previewHarnessBelongsToCurrentChat() ? state.previewHarness.lastSnapshot || {} : {};

  if (commandName === "session_state" && !command.url) {
    const existingWebview = await waitForActivePreviewWebview(1800).catch(() => null);
    if (existingWebview && previewHarnessBelongsToCurrentChat() && previewWebviewBelongsToCurrentChat(existingWebview) && isWebUrl(state.previewHarness.url)) {
      bindPreviewWebviewTelemetry(existingWebview);
      try {
        const snapshot = await capturePreviewWebviewInfo(existingWebview);
        state.renderCache.workbench = "";
        renderWorkbenchPanel();
        return browserHarnessSnapshotPayload(snapshot, {
          command: commandName,
          status: "live"
        });
      } catch (error) {
        const fallback = state.previewHarness.lastSnapshot || cached || {};
        return browserHarnessSnapshotPayload(fallback, {
          command: commandName,
          status: "warming",
          warning: error?.message || String(error || "Preview ainda esta anexando ao DOM.")
        });
      }
    }
    return browserHarnessSnapshotPayload(cached, {
      url: String(cached.url || (previewHarnessBelongsToCurrentChat() ? state.previewHarness.url : "") || ""),
      status: previewHarnessBelongsToCurrentChat() && (state.previewHarness.url || cached.url) ? "known" : "empty"
    });
  }

  const webview = await preparePreviewHarnessWebview(command);
  const stepResults = [];
  const artifacts = [];

  if (commandName === "sequence") {
    let didNavigate = false;
    if (command.url && shouldNavigatePreviewTo(webview, command.url)) {
      const nav = await runBrowserHarnessPrimitive(webview, { ...command, command: "goto" }, 0);
      stepResults.push(nav.summary);
      if (nav.screenshot) artifacts.push(nav.screenshot);
      didNavigate = true;
    } else {
      await capturePreviewWebviewInfo(webview);
    }
    const steps = Array.isArray(command.steps) ? command.steps.slice(0, 80) : [];
    for (const [index, step] of steps.entries()) {
      const result = await runBrowserHarnessPrimitive(webview, step, index + (didNavigate ? 1 : 0));
      stepResults.push(result.summary);
      if (result.screenshot) artifacts.push(result.screenshot);
      await capturePreviewWebviewInfo(webview);
    }
  } else {
    const result = await runBrowserHarnessPrimitive(webview, command, 0);
    stepResults.push(result.summary);
    if (result.screenshot) artifacts.push(result.screenshot);
    if (result.result !== undefined) {
      artifacts.push({ kind: "js_result", value: result.result });
    }
  }

  const snapshot = await capturePreviewWebviewInfo(webview);
  state.renderCache.workbench = "";
  renderWorkbenchPanel();
  return browserHarnessSnapshotPayload(snapshot, {
    stepResults,
    artifacts,
    command: commandName
  });
}

async function runPreviewHarnessCommand(command = {}) {
  return await runBrowserHarnessCommand(command);
}

function resizeComposer() {
  elements.promptInput.style.height = "0px";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 220)}px`;
}

function slashCatalogItems() {
  const catalog = state.app?.hermesCatalog || {};
  const localCommands = [
    { name: "/help", title: "DreamServer help", description: "Comandos locais do DreamServer", source: "dream" },
    { name: "/provider", title: "Provider Hermes", description: "Troca provider Hermes: kimi, nvidia, openai, claude, manus...", source: "dream" },
    { name: "/model", title: "Modelo Hermes", description: "Troca o modelo ativo do Hermes", source: "dream" },
    { name: "/doctor", title: "Diagnostico", description: "Mostra runtime, provider, bridge e workspace", source: "dream" },
    { name: "/mcp", title: "MCP", description: "Lista e gerencia servidores MCP", source: "dream" },
    { name: "/task", title: "Tasks", description: "Gerencia tarefas persistentes", source: "dream" },
    { name: "/agent", title: "Subagentes", description: "Cria, lista e para subagentes", source: "dream" },
    { name: "/git", title: "Git", description: "Status, branch e worktrees", source: "dream" },
    { name: "/lsp", title: "LSP", description: "Status e simbolos do language engine", source: "dream" }
  ];
  const merged = [
    ...localCommands,
    ...(Array.isArray(catalog.commands) ? catalog.commands : []),
    ...(Array.isArray(catalog.skills) ? catalog.skills : [])
  ];
  const seen = new Set();
  return merged.filter((item) => {
    const name = String(item?.name || "").trim();
    if (!name || seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
}

function currentSlashToken() {
  const input = elements.promptInput;
  if (!input || document.activeElement !== input) {
    return null;
  }
  const end = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, end);
  const match = before.match(/(^|\s)(\/[^\s]*)$/);
  if (!match) {
    return null;
  }
  const token = match[2] || "";
  return {
    token,
    query: token.slice(1).toLowerCase(),
    start: end - token.length,
    end
  };
}

function hideSlashCommandMenu() {
  state.slashMenu.open = false;
  state.slashMenu.items = [];
  state.slashMenu.index = 0;
  if (elements.slashCommandMenu) {
    elements.slashCommandMenu.hidden = true;
    elements.slashCommandMenu.innerHTML = "";
  }
}

function renderSlashCommandMenu() {
  const menu = elements.slashCommandMenu;
  if (!menu || !state.slashMenu.open) {
    return;
  }
  const html = state.slashMenu.items.map((item, index) => `
    <button type="button" class="slash-command-item ${index === state.slashMenu.index ? "is-active" : ""}" data-slash-index="${index}">
      <span class="slash-command-name">${escapeHtml(item.name)}</span>
      <span class="slash-command-desc">${escapeHtml(item.description || item.title || "")}</span>
      <span class="slash-command-source">${escapeHtml(item.source || item.category || "hermes")}</span>
    </button>
  `).join("");
  menu.innerHTML = html;
  menu.hidden = !html;
}

function updateSlashCommandMenu() {
  const token = currentSlashToken();
  if (!token) {
    hideSlashCommandMenu();
    return;
  }
  const query = token.query;
  const items = slashCatalogItems()
    .filter((item) => {
      const haystack = [
        item.name,
        item.label,
        item.title,
        item.description,
        item.category,
        item.source
      ].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    })
    .slice(0, 12);
  if (!items.length) {
    hideSlashCommandMenu();
    return;
  }
  state.slashMenu = {
    open: true,
    index: Math.min(state.slashMenu.index || 0, items.length - 1),
    items,
    query,
    tokenStart: token.start,
    tokenEnd: token.end
  };
  renderSlashCommandMenu();
}

function applySlashCommand(item = state.slashMenu.items[state.slashMenu.index]) {
  if (!item || !elements.promptInput) {
    return;
  }
  const input = elements.promptInput;
  const before = input.value.slice(0, state.slashMenu.tokenStart);
  const after = input.value.slice(state.slashMenu.tokenEnd);
  input.value = `${before}${item.name} ${after}`.replace(/\s+$/g, " ");
  const caret = before.length + item.name.length + 1;
  input.setSelectionRange(caret, caret);
  hideSlashCommandMenu();
  resizeComposer();
  input.focus();
}

function handleSlashCommandKeydown(event) {
  if (!state.slashMenu.open || !state.slashMenu.items.length) {
    return false;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.slashMenu.index = (state.slashMenu.index + 1) % state.slashMenu.items.length;
    renderSlashCommandMenu();
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.slashMenu.index = (state.slashMenu.index - 1 + state.slashMenu.items.length) % state.slashMenu.items.length;
    renderSlashCommandMenu();
    return true;
  }
  if (event.key === "Tab" || event.key === "Enter") {
    event.preventDefault();
    applySlashCommand();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideSlashCommandMenu();
    return true;
  }
  return false;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function cubicBezierAt(t, x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  let u = clamp01(t);

  for (let i = 0; i < 5; i += 1) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(x) < 0.0001 || Math.abs(dx) < 0.0001) {
      break;
    }
    u = clamp01(u - x / dx);
  }

  return ((ay * u + by) * u + cy) * u;
}

function originalEase(value) {
  return cubicBezierAt(value, 0.2, 0, 0.432, 0.147);
}

function originalEaseIn(value) {
  return cubicBezierAt(value, 0.594, 0.062, 0.79, 0.698);
}

function originalEaseOut(value) {
  return cubicBezierAt(value, 0.271, 0.302, 0.323, 0.535);
}

function startThinkingAnimationLoop() {
  if (thinkingAnimationFrame) {
    return;
  }

  const duration = 4000;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const tick = (timestamp) => {
    lastThinkingTimestamp = timestamp;
    updateThinkingSvgs(timestamp, duration, reduceMotion);
    thinkingAnimationFrame = window.requestAnimationFrame(tick);
  };

  thinkingAnimationFrame = window.requestAnimationFrame(tick);
}

function updateThinkingSvgs(timestamp = lastThinkingTimestamp || performance.now(), duration = 4000, reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
  const svgs = document.querySelectorAll(".thinking-svg");
  svgs.forEach((svg) => {
    svg.style.visibility = "visible";
    const ellipses = svg.querySelectorAll(".t-ell");
    const total = ellipses.length || 1;

    ellipses.forEach((ellipse, index) => {
      const baseStroke = ellipse.dataset.baseStroke || ellipse.getAttribute("stroke") || "#4cc9f0";
      ellipse.dataset.baseStroke = baseStroke;
      const layer = Number(ellipse.dataset.index || index + 1);
      const progress = layer / total;
      const baseOpacity = 1 - progress;
      const rxShift = layer * 3.8;
      const ryShift = layer * 2.3;

      if (reduceMotion) {
        ellipse.setAttribute("rx", String(180 + rxShift));
        ellipse.setAttribute("ry", String(180 - ryShift));
        ellipse.style.stroke = baseStroke;
        ellipse.style.strokeWidth = "10px";
        ellipse.style.opacity = String(Math.max(0.08, baseOpacity));
        ellipse.style.transform = "rotate(-18deg) scale(1)";
        return;
      }

      const localTime = (((timestamp / 1000) - progress) % 4 + 4) % 4;
      const scale = localTime < 1 ? originalEase(localTime) : 1;
      const rotation = -360 * originalEase(clamp01(localTime / 2));

      let rx = 180;
      let ry = 180;
      let strokeWidth = 0;
      if (localTime < 1) {
        const amount = originalEaseIn(localTime);
        rx = 180 + rxShift * amount;
        ry = 180 - ryShift * amount;
        strokeWidth = 10 * amount;
      } else if (localTime < 2) {
        const amount = originalEaseOut(localTime - 1);
        rx = 180 + rxShift * (1 - amount);
        ry = 180 - ryShift * (1 - amount);
        strokeWidth = 10 + 90 * amount;
      } else {
        strokeWidth = 100;
      }

      ellipse.setAttribute("rx", rx.toFixed(2));
      ellipse.setAttribute("ry", Math.max(8, ry).toFixed(2));
      ellipse.style.stroke = localTime >= 2 ? "url(#thinking-final-gradient)" : baseStroke;
      ellipse.style.strokeWidth = `${strokeWidth.toFixed(2)}px`;
      ellipse.style.opacity = Math.max(0.02, baseOpacity).toFixed(3);
      ellipse.style.transform = `rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    });
  });
}

function normalizeStatus(status) {
  const value = String(status || "idle").toLowerCase();
  if (value === "running") {
    return "Respondendo";
  }
  if (value === "stopped") {
    return "Concluido";
  }
  if (value === "error") {
    return "Erro";
  }
  return "Pronto";
}

function parseActionPayload(content) {
  const source = String(content || "");
  const pattern = /```(?:dream-server-action|manus-studio-action)\s*([\s\S]*?)```/gi;
  const actions = [];
  const cleaned = source.replace(pattern, (_, rawJson) => {
    try {
      const parsed = JSON.parse(rawJson.trim());
      if (parsed && typeof parsed === "object") {
        actions.push(parsed);
      }
    } catch { }
    return "";
  });

  return {
    body: cleaned.trim(),
    actions
  };
}

function extractMessagePayload(message) {
  if (Array.isArray(message?.actions) && message.actions.length) {
    return {
      body: String(message.content || "").trim(),
      actions: message.actions
    };
  }

  return parseActionPayload(message?.content || "");
}

function assistantActionKeys(chat) {
  const keys = new Set();
  for (const message of chat?.messages || []) {
    if (message.kind !== "assistant") {
      continue;
    }
    const parsed = extractMessagePayload(message);
    parsed.actions.forEach((_, index) => keys.add(`${message.id}:${index}`));
  }
  return keys;
}

function visibleEntries(chat) {
  if (!chat) {
    return [];
  }

  return (chat.messages || [])
    .filter((message) => !message.hidden)
    .map((message) => ({ ...message, entryType: "message" }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function lastPreview(chat) {
  const entries = visibleEntries(chat).slice().reverse();
  for (const entry of entries) {
    if (entry.kind === "assistant") {
      const parsed = extractMessagePayload(entry);
      return parsed.body || "Acao sugerida pronta para executar.";
    }
    if (entry.kind === "user") {
      return entry.content;
    }
    if (entry.kind === "status") {
      return entry.brief || entry.description || normalizeStatus(entry.status);
    }
  }
  return "";
}

function describeAction(action) {
  const type = String(action?.type || "").trim();
  if (type === "launch_app") {
    return action.app || action.path || "abrir aplicativo";
  }
  if (type === "open_url") {
    return action.url || "abrir link";
  }
  if (type === "open_path" || type === "reveal_path") {
    return action.path || "abrir caminho";
  }
  if (type === "run_command") {
    return action.command || "executar comando";
  }
  if (type === "file_edit") {
    return action.path || "editar arquivo";
  }
  if (type === "workspace_symbols") {
    return action.query || "buscar simbolos";
  }
  if (type === "file_symbols") {
    return action.path || "listar simbolos do arquivo";
  }
  if (type === "lsp_document_symbols") {
    return action.path || "listar simbolos via lsp";
  }
  if (type === "lsp_workspace_symbols") {
    return action.query || "buscar simbolos via lsp";
  }
  if (type === "lsp_definition") {
    return action.path || "ir para definicao";
  }
  if (type === "lsp_references") {
    return action.path || "buscar referencias";
  }
  if (type === "lsp_hover") {
    return action.path || "ler hover";
  }
  if (type === "lsp_code_actions") {
    return action.path || "listar code actions";
  }
  if (type === "lsp_apply_code_action") {
    return action.actionId || action.path || "aplicar code action";
  }
  if (type === "lsp_rename") {
    return action.newName || action.path || "renomear simbolo";
  }
  if (type === "git_create_branch") {
    return action.name || "criar branch";
  }
  if (type === "git_worktree_add" || type === "git_worktree_remove") {
    return action.path || type;
  }
  if (type === "agent_spawn") {
    return action.name || action.objective || "criar subagente";
  }
  if (type === "task_create") {
    return action.title || "criar tarefa";
  }
  if (type === "terminal_exec" || type === "background_command_start") {
    return action.command || type;
  }
  if (type === "verify_file") {
    return action.path || (Array.isArray(action.files) ? action.files.join(", ") : "verificar arquivo");
  }
  if (type === "verify_url" || type === "verify_site" || type === "browser_check" || type === "verify_browser_console") {
    return action.url || type;
  }
  if (type === "verify_command") {
    return action.command || "verificar comando";
  }
  if (type === "stop_all_local_activity") {
    return "parar jobs e terminais";
  }
  if (type === "adb_command") {
    return Array.isArray(action.args) ? `adb ${action.args.join(" ")}` : "adb";
  }
  if (type === "adb_shell") {
    return action.command || "adb shell";
  }
  if (type === "mcp_call") {
    return `${action.server || "mcp"}:${action.tool || "tool"}`;
  }
  return type || "acao local";
}

function collectSuggestedActions(chat) {
  const executed = new Map((chat?.localEvents || []).map((event) => [event.actionKey, event]));
  const suggestions = [];

  for (const message of chat?.messages || []) {
    if (message.kind !== "assistant") {
      continue;
    }

    const parsed = extractMessagePayload(message);
    parsed.actions.forEach((action, index) => {
      const actionKey = `${message.id}:${index}`;
      const executedEvent = executed.get(actionKey);
      suggestions.push({
        actionKey,
        action,
        label: describeAction(action),
        executedEvent,
        status: executedEvent ? (executedEvent.ok ? "done" : "failed") : state.runningActions.has(actionKey) ? "running" : "pending",
        sourceMessageId: message.id
      });
    });
  }

  return suggestions;
}

function attachmentMarkup(attachments = []) {
  const cards = attachments.map((attachment) => {
    const source = attachment.path ? fileUrl(attachment.path) : attachment.url;
    const imageLike =
      (attachment.contentType || "").startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.filename || "");
    const preview = source && imageLike
      ? `<div class="attachment-image"><img src="${escapeHtml(source)}" alt="${escapeHtml(attachment.filename || "imagem")}" /></div>`
      : "";

    return `<div class="attachment-card">${preview}<strong>${escapeHtml(attachment.filename || "arquivo")}</strong><span class="action-meta">${escapeHtml(attachment.contentType || attachment.type || "arquivo")}</span></div>`;
  });

  return cards.length ? `<div class="attachment-row">${cards.join("")}</div>` : "";
}

function visibleThinkingSummary(item = {}) {
  const summary = String(item.summary || "").trim();
  if (!summary) {
    return "";
  }
  if (/^(thinking|activity|step|Hermes pensando)$/i.test(summary)) {
    return "";
  }
  if (/^(Starting|Iniciando)\b/i.test(summary)) {
    return "";
  }
  return summary;
}

function thinkingActivityMarkup() {
  const items = runtimeActivityForChat(currentChat())
    .filter((item) => item.type === "agent_reasoning_delta" || item.type === "agent_phase_changed")
    .map((item) => ({
      ...item,
      summary: visibleThinkingSummary(item)
    }))
    .filter((item) => item.summary)
    .slice(-8)
    .reverse();
  if (!items.length) {
    return "";
  }
  return `
    <details class="thinking-details">
      <summary>Ver raciocinio do Hermes</summary>
      <div class="thinking-detail-feed">
        ${items.map((item) => `
          <div class="thinking-detail-row">
            <span>${escapeHtml(item.type === "agent_reasoning_delta" ? "Thought" : "Status")}</span>
            <p>${escapeHtml(shortText(item.summary || item.type, 220))}</p>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function thinkingMarkup() {
  const palette = ["#f72585", "#7209b7", "#3a0ca3", "#4361ee", "#4cc9f0", "#d9f4fc"];
  const total = 31;
  const ellipses = Array.from({ length: total }, (_, index) => {
    const progress = (index + 1) / total;
    const color = palette[Math.min(palette.length - 1, Math.floor(progress * palette.length))];
    return `<ellipse class="t-ell" data-index="${index + 1}" data-total="${total}" data-base-stroke="${color}" cx="400" cy="300" rx="180" ry="180" stroke="${color}" />`;
  }).join("");
  return `
    <article class="message message-assistant message-thinking" aria-live="polite">
      <div class="message-shell">
        <div class="message-meta"><span>assistant</span><span>${escapeHtml(formatClock(Date.now()))}</span></div>
        <div class="thinking-indicator">
          <svg class="thinking-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" aria-hidden="true">
            <defs>
              <linearGradient id="thinking-final-gradient" x1="170" y1="135" x2="640" y2="470" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#d9c7ff" />
                <stop offset="28%" stop-color="#a98bff" />
                <stop offset="58%" stop-color="#4b5cff" />
                <stop offset="100%" stop-color="#081d72" />
              </linearGradient>
            </defs>
            ${ellipses}
          </svg>
          <span class="thinking-label">Pensando<span class="thinking-dot" style="animation-delay:0s">.</span><span class="thinking-dot" style="animation-delay:0.2s">.</span><span class="thinking-dot" style="animation-delay:0.4s">.</span></span>
        </div>
        ${thinkingActivityMarkup()}
      </div>
    </article>
  `;
}

function actionCardsMarkup(items) {
  return items
    .map((item) => {
      state.actionRegistry.set(item.actionKey, item.action);
      const automatic = state.app?.settings?.fullAccessMode && state.app?.settings?.trustMode === "always";
      const label =
        item.status === "done" ? "Executado" : item.status === "failed" ? "Falhou" : item.status === "running" ? "Executando" : automatic ? "Automatico" : "Executar";
      const disabled = item.status === "done" || item.status === "running" ? "disabled" : "";
      return `<div class="inline-action-card"><div class="inline-action-top"><div><h4>${escapeHtml(String(item.action.type || "acao local"))}</h4><p>${escapeHtml(item.label)}</p></div><button class="inline-action-button" data-action-key="${escapeHtml(item.actionKey)}" ${disabled}>${label}</button></div></div>`;
    })
    .join("");
}

function transcriptBodyForAssistant(content = "") {
  const source = String(content || "").trim();
  if (!source) {
    return "";
  }

  const artifact = extractCodeArtifacts(source);
  const codeBlocks = artifact.blocks;
  if (!codeBlocks.length) {
    return source;
  }

  const prose = artifact.prose;
  const languages = [...new Set(codeBlocks.map((block) => normalizeFenceLanguage(block.language)).filter(Boolean))];
  const label = codeBlocks.length === 1
    ? `Código ${languages[0] || ""} enviado para o Workbench.`
    : `${codeBlocks.length} blocos de código enviados para o Workbench.`;

  return [prose, `↳ ${label}`].filter(Boolean).join("\n\n");
}

function renderInlineMarkdown(text = "") {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownTable(lines, startIndex) {
  const rows = [];
  let index = startIndex;
  while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
    rows.push(lines[index]);
    index += 1;
  }
  if (rows.length < 2 || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(rows[1])) {
    return null;
  }
  const cellsFor = (line) => line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => renderInlineMarkdown(cell.trim()));
  const head = cellsFor(rows[0]);
  const body = rows.slice(2).map(cellsFor);
  return {
    nextIndex: index,
    html: `
      <div class="message-table-wrap">
        <table>
          <thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
          <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `
  };
}

function renderMessageMarkdown(source = "") {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      html.push(`<pre class="message-code"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const table = renderMarkdownTable(lines, index);
    if (table) {
      flushParagraph();
      flushList();
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const type = numbered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return html.join("") || `<p>${renderInlineMarkdown(source)}</p>`;
}

function messageBodyHtml(body = "") {
  return renderMessageMarkdown(body);
}

function renderSidebar() {
  const chats = (state.app?.chats || []).filter((chat) => !chat.hiddenInSidebar);
  const selectedId = currentChat()?.id;
  elements.chatCount.textContent = String(chats.length);
  const html = chats
    .map((chat) => {
      const isActive = chat.id === selectedId ? "is-active" : "";
      const snippet = shortText(lastPreview(chat) || "Sem mensagens ainda.", 86);
      return `<div class="chat-list-row"><button class="chat-list-item ${isActive}" data-chat-id="${escapeHtml(chat.id)}"><p class="chat-list-title">${escapeHtml(chat.title || "Nova sessao")}</p><p class="chat-list-snippet">${escapeHtml(snippet)}</p><div class="chat-list-meta"><span>${activeProvider(chat) === "local" ? "Hermes" : "Manus"}</span><span>${formatClock(chat.updatedAt)}</span></div></button><button class="toolbar-button chat-delete" data-delete-chat="${escapeHtml(chat.id)}">x</button></div>`;
    })
    .join("");

  if (state.renderCache.sidebar !== html) {
    state.renderCache.sidebar = html;
    elements.chatList.innerHTML = html;
  }
}

function setValueIfIdle(element, value) {
  if (!element || document.activeElement === element) {
    return;
  }
  const nextValue = String(value ?? "");
  if (element.value !== nextValue) {
    element.value = nextValue;
  }
}

function setCheckedIfPresent(element, value) {
  if (element) {
    element.checked = Boolean(value);
  }
}

function currentHostInfo() {
  return state.app?.hostInfo || {};
}

function defaultTerminalShellValue() {
  const host = currentHostInfo();
  const shell = String(host.defaultShell || "").toLowerCase();
  if (["powershell", "pwsh", "cmd", "bash", "zsh", "sh"].includes(shell)) {
    return shell;
  }
  if (host.platform === "win32") {
    return "cmd";
  }
  if (host.platform === "darwin") {
    return "zsh";
  }
  return "sh";
}

function managedLlamaAvailable() {
  return Boolean(currentHostInfo().managedLlamaAvailable);
}

function hostPathPlaceholder(kind = "dir") {
  const host = currentHostInfo();
  const platform = String(host.platform || "").toLowerCase();
  if (platform === "win32") {
    return kind === "file"
      ? "C:\\Users\\...\\models\\modelo.gguf"
      : "%LOCALAPPDATA%\\Dream Server\\models";
  }
  if (platform === "darwin") {
    return kind === "file"
      ? "/Users/.../Library/Application Support/Dream Server/models/modelo.gguf"
      : "~/Library/Application Support/Dream Server/models";
  }
  return kind === "file"
    ? "~/.local/share/dream-server/models/modelo.gguf"
    : "~/.local/share/dream-server/models";
}

function syncPlatformSettingsHints(settings = {}) {
  const host = currentHostInfo();
  const label = host.platformLabel || host.platform || "host";
  const wslSuffix = host.isWsl ? " · WSL" : "";
  const shell = host.defaultShellLabel || "shell do host";
  const managedAvailable = managedLlamaAvailable();

  if (elements.hostPlatformBadge) {
    elements.hostPlatformBadge.textContent = `${label}${wslSuffix} · ${host.arch || ""}`.trim();
    elements.hostPlatformBadge.title = [host.release, shell].filter(Boolean).join("\n");
  }
  if (elements.desktopBridgeDescription) {
    elements.desktopBridgeDescription.textContent =
      `Como o modelo interage com ${label}${wslSuffix}: apps, arquivos, comandos e Workbench.`;
  }
  if (elements.hermesDesktopIntegrationHint) {
    elements.hermesDesktopIntegrationHint.textContent =
      "Mantem as ferramentas Dream Desktop ativas para Workbench, navegador interno e caminhos do host. Recomendada em desktop; desligue apenas para Hermes puro sem ponte Dream.";
  }
  if (elements.localLlamaRuntimeDescription) {
    elements.localLlamaRuntimeDescription.textContent = managedAvailable
      ? `Servidor OpenAI-compatible proprio usando runtime empacotado para ${label}.`
      : `Runtime llama.cpp gerenciado nao encontrado para ${label}. Use Hermes Agent routing com provider externo ou empacote bin/llama deste OS.`;
  }
  if (elements.localLlamaManagedLabel) {
    elements.localLlamaManagedLabel.textContent = managedAvailable
      ? "llama.cpp local gerenciado"
      : "llama.cpp gerenciado indisponivel";
  }
  if (elements.localLlamaManagedHint) {
    elements.localLlamaManagedHint.textContent = managedAvailable
      ? "Quando ligado, o app sobe um servidor OpenAI-compatible proprio no host atual."
      : "Esta instalacao nao tem llama-server empacotado para este host. Hermes Agent ainda pode usar OpenRouter, APIs diretas, Ollama, vLLM, LM Studio ou outro endpoint.";
  }
  if (elements.localLlamaModelDirInput) {
    elements.localLlamaModelDirInput.placeholder = hostPathPlaceholder("dir");
  }
  if (elements.localLlamaModelPathInput) {
    elements.localLlamaModelPathInput.placeholder = hostPathPlaceholder("file");
  }
  for (const element of [
    elements.localLlamaEnabledInput,
    elements.localLlamaAutoStartInput,
    elements.localLlamaPortInput,
    elements.localLlamaContextSizeInput,
    elements.localLlamaGpuLayersInput,
    elements.localLlamaBatchSizeInput,
    elements.startLocalLlamaButton
  ]) {
    if (element) {
      element.disabled = !managedAvailable;
    }
  }
  if (elements.localLlamaAutoStartInput && !settings.localLlamaEnabled) {
    elements.localLlamaAutoStartInput.disabled = true;
  }
}

function syncProviderSpecificSettings(settings = state.app?.settings || {}, options = {}) {
  const provider = normalizeHermesProvider(elements.hermesProviderInput?.value || settings.hermesProvider || "custom");
  const providerChanged = Boolean(options.providerChanged);
  if (elements.manusProviderDetails) {
    elements.manusProviderDetails.hidden = provider !== "manus";
  }
  if (elements.openRouterRoutingDetails) {
    elements.openRouterRoutingDetails.hidden = provider !== "openrouter";
  }
  if (elements.localBaseUrlInput) {
    const defaultBaseUrl = defaultBaseUrlForProvider(provider);
    elements.localBaseUrlInput.placeholder = provider === "custom"
      ? "http://localhost:11434/v1"
      : provider === "kimi-coding"
        ? "https://api.moonshot.ai/v1 ou https://api.kimi.com/coding"
        : defaultBaseUrl || "Override opcional do endpoint";
    const currentBaseUrl = fieldValue(elements.localBaseUrlInput, settings.localBaseUrl || "");
    const selectedProviderBaseUrl = provider === "auto" || provider === "manus"
      ? ""
      : defaultBaseUrl;
    const effectiveBaseUrl = providerChanged
      ? selectedProviderBaseUrl
      : effectiveBaseUrlForProvider(provider, currentBaseUrl);
    if (options.applyDefaults && effectiveBaseUrl !== currentBaseUrl) {
      elements.localBaseUrlInput.value = effectiveBaseUrl;
    }
  }
  if (elements.localModelInput) {
    const defaultModel = HERMES_PROVIDER_DEFAULT_MODELS[provider] || "default";
    elements.localModelInput.placeholder = defaultModel;
    const currentModel = fieldValue(elements.localModelInput, settings.localModel || "");
    const effectiveModel = providerChanged && HERMES_PROVIDER_DEFAULT_MODELS[provider]
      ? HERMES_PROVIDER_DEFAULT_MODELS[provider]
      : effectiveModelForProvider(provider, currentModel);
    if (options.applyDefaults && effectiveModel && effectiveModel !== currentModel) {
      elements.localModelInput.value = effectiveModel;
    }
  }
}

function hydrateSettings(force = false) {
  const settings = state.app?.settings;
  if (!settings) {
    return;
  }
  applyAmbientBackground(settings.backgroundMediaPath || "");
  syncPlatformSettingsHints(settings);
  const isEditing = Boolean(elements.settingsForm?.contains(document.activeElement));
  if (isEditing && !force) {
    return;
  }

  if (force && elements.apiKeyInput && document.activeElement !== elements.apiKeyInput) {
    elements.apiKeyInput.value = "";
  }
  syncHermesProviderOptions(settings);
  setValueIfIdle(elements.agentProfileSelect, settings.agentProfile || "manus-1.6");
  setValueIfIdle(elements.localeInput, settings.locale || effectiveLocale());
  setValueIfIdle(elements.localBaseUrlInput, settings.localBaseUrl || "http://127.0.0.1:11435/v1");
  setValueIfIdle(elements.localModelInput, settings.localModel || "default");
  setValueIfIdle(elements.localApiKeyInput, settings.localApiKey || "not-needed");
  setValueIfIdle(elements.hermesProviderInput, settings.hermesProvider || "custom");
  setValueIfIdle(elements.hermesApiModeInput, settings.hermesApiMode || "auto");
  setValueIfIdle(elements.hermesProvidersAllowedInput, (settings.hermesProvidersAllowed || []).join(", "));
  setValueIfIdle(elements.hermesProvidersIgnoredInput, (settings.hermesProvidersIgnored || []).join(", "));
  setValueIfIdle(elements.hermesProvidersOrderInput, (settings.hermesProvidersOrder || []).join(", "));
  setValueIfIdle(elements.hermesProviderSortInput, settings.hermesProviderSort || "");
  setValueIfIdle(elements.hermesProviderDataCollectionInput, settings.hermesProviderDataCollection || "");
  setCheckedIfPresent(elements.hermesProviderRequireParametersInput, settings.hermesProviderRequireParameters);
  setCheckedIfPresent(elements.localThinkingEnabledInput, settings.localThinkingEnabled);
  setCheckedIfPresent(elements.localLlamaEnabledInput, settings.localLlamaEnabled);
  setCheckedIfPresent(elements.localLlamaAutoStartInput, settings.localLlamaAutoStart);
  setValueIfIdle(elements.localLlamaPortInput, settings.localLlamaPort || 11435);
  setValueIfIdle(elements.localLlamaContextSizeInput, settings.localLlamaContextSize || 16384);
  setValueIfIdle(elements.localLlamaGpuLayersInput, settings.localLlamaGpuLayers ?? 999);
  setValueIfIdle(elements.localLlamaBatchSizeInput, settings.localLlamaBatchSize || 1024);
  setValueIfIdle(elements.localLlamaModelDirInput, settings.localLlamaModelDir || "");
  setValueIfIdle(elements.localLlamaModelPathInput, settings.localLlamaModelPath || "");
  const llama = state.app?.localLlamaState || {};
  if (elements.localLlamaStatusLabel) {
    const statusBits = [
      `llama.cpp: ${llama.status || "idle"}`,
      llama.pid ? `pid ${llama.pid}` : "",
      llama.model ? llama.model : "",
      llama.lastError ? `erro: ${llama.lastError}` : ""
    ].filter(Boolean);
    elements.localLlamaStatusLabel.textContent = statusBits.join(" · ");
    elements.localLlamaStatusLabel.title = statusBits.join("\n");
  }
  setCheckedIfPresent(elements.hermesDesktopIntegrationEnabledInput, settings.hermesDesktopIntegrationEnabled);
  setValueIfIdle(elements.trustModeInput, settings.trustMode || "ask");
  setValueIfIdle(elements.connectorIdsInput, (settings.connectorIds || []).join(", "));
  setValueIfIdle(elements.enableSkillsInput, (settings.enableSkillIds || []).join(", "));
  setValueIfIdle(elements.forceSkillsInput, (settings.forceSkillIds || []).join(", "));
  setCheckedIfPresent(elements.interactiveModeInput, settings.interactiveMode);
  setCheckedIfPresent(elements.desktopBridgeEnabledInput, settings.desktopBridgeEnabled);
  setCheckedIfPresent(elements.fullAccessModeInput, settings.fullAccessMode);
  setCheckedIfPresent(elements.kanbanGitEnabledInput, settings.kanbanGitEnabled);
  setCheckedIfPresent(elements.kanbanAutoSchedulerEnabledInput, settings.kanbanAutoSchedulerEnabled !== false);
  setCheckedIfPresent(elements.kanbanAutoRecoverEnabledInput, settings.kanbanAutoRecoverEnabled !== false);
  setCheckedIfPresent(elements.kanbanAutoCleanupEnabledInput, settings.kanbanAutoCleanupEnabled !== false);
  setCheckedIfPresent(elements.kanbanAutoPrEnabledInput, settings.kanbanAutoPrEnabled);
  setCheckedIfPresent(elements.kanbanMultiAgentOrchestrationEnabledInput, settings.kanbanMultiAgentOrchestrationEnabled);
  setValueIfIdle(elements.kanbanMaxParallelAgentsInput, settings.kanbanMaxParallelAgents || APERANT_MAX_PARALLEL_TASKS);
  setValueIfIdle(elements.kanbanSchedulerIntervalMsInput, settings.kanbanSchedulerIntervalMs || 2500);
  syncProviderSpecificSettings(settings, { applyDefaults: force || !isEditing });
  syncCodeShaderControls(settings);
  applyCodeShaderSettings(settings);
  if (elements.localSettingsGroup) {
    elements.localSettingsGroup.hidden = false;
  }
}

function renderHeader() {
  const chat = currentChat();
  const provider = activeProvider(chat);
  const settings = state.app?.settings || {};
  const hermesRoute = currentHermesRoute(settings);
  const hermesRouteText = [
    hermesRoute.label,
    hermesRoute.model && hermesRoute.model !== "default" ? hermesRoute.model : "",
    hermesRoute.baseUrl && hermesRoute.provider !== "auto" ? hermesRoute.baseUrl : ""
  ].filter(Boolean).join(" · ");
  const preview = shortText(lastPreview(chat) || `Conectado ao Hermes Agent: ${hermesRouteText || "config Hermes"}.`, 180);

  const setText = (el, value) => { if (el) el.textContent = value; };
  setText(elements.statusBadge, normalizeStatus(chat?.status));
  setText(elements.providerBadge, "Hermes");
  setText(elements.bridgeModePill, settings.desktopBridgeEnabled ? "Bridge ativa" : "Bridge desligada");
  setText(elements.accessModePill, settings.fullAccessMode ? "Acesso total" : "Modo limitado");
  setText(elements.threadEyebrow, "Hermes Agent");
  setText(elements.chatTitle, chat?.title || "Crie um topico para comecar");
  setText(elements.chatSubtitle, preview);
  setText(elements.providerMeta, "Hermes Agent");
  setText(elements.profileMeta, hermesRoute.model || hermesRoute.label);
  setText(elements.localeMeta, hermesRoute.label);
  setText(elements.interactiveMeta, chat?.activeRoute?.label || (settings.interactiveMode ? "interactive" : "best effort"));
  setText(elements.composerProviderHint, `Hermes: ${hermesRouteText || "config.yaml"}`);
  setText(elements.composerAttachmentHint, state.attachments.length ? `${state.attachments.length} anexo(s)` : "Imagens, PDF e arquivos");
  setText(elements.apiKeyState, isManusProviderSelected(settings)
    ? (state.app?.hasCloudApiKey ? "Manus selecionado dentro do Hermes: chave salva localmente." : "Manus selecionado dentro do Hermes: configure a chave Manus.")
    : `Hermes usa provider/modelo configurados: ${hermesRouteText || "config.yaml/env do Hermes"}.`);
  setText(elements.providerSummary, `Runtime: Hermes Agent. Provider: ${hermesRouteText || "config.yaml/env"}. Workspace: ${chat?.workspaceRoot || "-"}. Rota: ${chat?.activeRoute?.id || "general-purpose"}.`);
  if (elements.openTaskButton) {
    elements.openTaskButton.disabled = !(provider === "cloud" && chat?.taskUrl);
  }
  setText(elements.bridgeState, settings.desktopBridgeEnabled ? "Ativa" : "Off");
  elements.cloudProviderButton?.classList.toggle("is-active", false);
  elements.localProviderButton?.classList.toggle("is-active", true);

  // Settings v5 — badges espelhados do header
  if (elements.providerBadgeSettings) {
    elements.providerBadgeSettings.textContent = `Hermes · ${hermesRoute.label}`;
    elements.providerBadgeSettings.classList.toggle("is-acc", true);
  }
  if (elements.apiKeyBadge) {
    const hasKey = Boolean(state.app?.hasCloudApiKey);
    elements.apiKeyBadge.textContent = hasKey ? "• conectada" : "sem chave";
    elements.apiKeyBadge.classList.toggle("is-ok", hasKey);
  }
  if (elements.bridgeStateBadge) {
    const on = Boolean(settings.desktopBridgeEnabled);
    elements.bridgeStateBadge.textContent = on ? "bridge ativa" : "bridge off";
    elements.bridgeStateBadge.classList.toggle("is-ok", on);
  }
}

function cssEscape(value) {
  const text = String(value || "");
  if (window.CSS?.escape) {
    return window.CSS.escape(text);
  }
  return text.replace(/["\\]/g, "\\$&");
}

function transcriptEntryBody(entry, actions = []) {
  if (entry.kind === "assistant") {
    const parsed = extractMessagePayload(entry);
    return transcriptBodyForAssistant(parsed.body);
  }
  return entry.content || (actions.length ? "Acao local pronta para executar." : "");
}

function patchTranscriptBodies(entries = [], suggestedActionByKey = new Map(), transcriptThinking = false) {
  if (!elements.transcript || !entries.length) {
    return false;
  }

  let allPatchable = true;
  for (const entry of entries) {
    if (!entry?.id || entry.kind === "status") {
      continue;
    }

    const parsed = entry.kind === "assistant" ? extractMessagePayload(entry) : { body: entry.content, actions: [] };
    const actions = (parsed.actions || []).map((action, index) => ({
      action,
      actionKey: `${entry.id}:${index}`,
      label: describeAction(action),
      status: suggestedActionByKey.get(`${entry.id}:${index}`)?.status || "pending"
    }));
    const visibleActions = actions.filter((action) => action.status !== "done");
    if (visibleActions.length || (entry.attachments || []).length) {
      continue;
    }

    const body = entry.kind === "assistant"
      ? transcriptBodyForAssistant(parsed.body)
      : parsed.body || (actions.length ? "Acao local pronta para executar." : "");
    const node = elements.transcript.querySelector(`[data-message-id="${cssEscape(entry.id)}"] .message-body`);
    if (!body) {
      continue;
    }
    if (!node) {
      allPatchable = false;
      continue;
    }
    const renderedBody = messageBodyHtml(body);
    if (node.dataset.renderedBody !== body) {
      node.innerHTML = renderedBody;
      node.dataset.renderedBody = body;
    }
  }

  if (transcriptThinking) {
    updateThinkingSvgs();
  }
  return allPatchable;
}

function renderTranscript() {
  const chat = currentChat();
  const entries = visibleEntries(chat);
  const suggestedActions = collectSuggestedActions(chat);
  const suggestedActionByKey = new Map(suggestedActions.map((item) => [item.actionKey, item]));
  const transcriptThinking = Boolean(state.busy || state.stopping || String(chat?.status || "").toLowerCase() === "running");
  const stableEntries = entries.map((entry) => {
    const content = entry.kind === "assistant" && transcriptThinking ? "" : entry.content;
    return [entry.id, entry.kind, content, entry.status, entry.timestamp, entry.attachments?.length || 0, entry.actions?.length || 0];
  });
  const signature = JSON.stringify([
    chat?.id || "none",
    transcriptThinking,
    ...stableEntries,
    ...suggestedActions.map((item) => [item.actionKey, item.status, item.executedEvent?.ok, item.executedEvent?.timestamp])
  ]);
  const showHero = !chat || (!transcriptThinking && !entries.length && !(chat.messages || []).length);

  elements.heroState.hidden = !showHero;
  elements.transcript.hidden = showHero;
  if (showHero) {
    return;
  }

  const shouldStick = elements.transcript.scrollHeight - elements.transcript.scrollTop - elements.transcript.clientHeight < 60;
  if (state.renderCache.transcript === signature) {
    if (patchTranscriptBodies(entries, suggestedActionByKey, transcriptThinking)) {
      if (shouldStick) {
        elements.transcript.scrollTop = elements.transcript.scrollHeight;
      }
      return;
    }
  }

  state.actionRegistry.clear();

  const html = entries.map((entry) => {
    if (entry.kind === "status") {
      const body = entry.brief || entry.description || normalizeStatus(entry.status);
      const live = String(entry.status || "").toLowerCase() === "running" ? "is-live" : "";
      return `<div class="message message-assistant"><div class="message-shell"><div class="status-event ${live}"><strong>${escapeHtml(normalizeStatus(entry.status))}</strong><span>${escapeHtml(body)}</span></div></div></div>`;
    }

    const kindClass = entry.kind === "user" ? "message-user" : entry.kind === "assistant" ? "message-assistant" : "message-local_action";
    const parsed = entry.kind === "assistant" ? extractMessagePayload(entry) : { body: entry.content, actions: [] };
    const actions = parsed.actions.map((action, index) => ({
      action,
      actionKey: `${entry.id}:${index}`,
      label: describeAction(action),
      status: suggestedActionByKey.get(`${entry.id}:${index}`)?.status || "pending"
    }));
    const visibleActions = actions.filter((action) => action.status !== "done");
    const body = entry.kind === "assistant"
      ? transcriptBodyForAssistant(parsed.body)
      : parsed.body || (actions.length ? "Acao local pronta para executar." : "");
    if (!body && !visibleActions.length && !(entry.attachments || []).length && entry.kind === "assistant") {
      return "";
    }
    return `<article class="message ${kindClass}" data-message-id="${escapeHtml(entry.id || "")}"><div class="message-shell"><div class="message-meta"><span>${escapeHtml(entry.kind === "local_action" ? "local" : entry.kind)}</span><span>${escapeHtml(formatClock(entry.timestamp))}</span></div>${body ? `<div class="message-body message-markdown" data-rendered-body="${escapeHtml(body)}">${messageBodyHtml(body)}</div>` : ""}${attachmentMarkup(entry.attachments || [])}${visibleActions.length ? `<div class="inline-actions">${actionCardsMarkup(visibleActions)}</div>` : ""}</div></article>`;
  }).join("") + (transcriptThinking ? thinkingMarkup() : "");

  state.renderCache.transcript = signature;
  elements.transcript.innerHTML = html;
  if (transcriptThinking) {
    updateThinkingSvgs();
  }
  if (shouldStick) {
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }
}

function renderActionFeed() {
  const chat = currentChat();
  const actions = collectSuggestedActions(chat);
  const signature = JSON.stringify([chat?.id || "none", ...actions.map((item) => [item.actionKey, item.status, item.executedEvent?.result || ""])]);
  if (state.renderCache.actions === signature) {
    return;
  }

  const html = actions.length
    ? actions
      .slice(-8)
      .reverse()
      .map((item) => {
        state.actionRegistry.set(item.actionKey, item.action);
        const meta = item.executedEvent?.result || item.label;
        const automatic = state.app?.settings?.fullAccessMode && state.app?.settings?.trustMode === "always";
        const buttonLabel =
          item.status === "done" ? "Executado" : item.status === "failed" ? "Repetir" : item.status === "running" ? "Executando" : automatic ? "Automatico" : "Executar";
        const disabled = item.status === "done" || item.status === "running" ? "disabled" : "";
        return `<div class="action-card"><div class="action-card-head"><div><h5>${escapeHtml(String(item.action.type || "acao local"))}</h5><p class="action-meta">${escapeHtml(shortText(meta, 120))}</p></div><button class="inline-action-button" data-action-key="${escapeHtml(item.actionKey)}" ${disabled}>${buttonLabel}</button></div></div>`;
      })
      .join("")
    : `<p class="panel-copy">Nenhuma acao local sugerida nesta conversa.</p>`;

  state.renderCache.actions = signature;
  elements.actionFeed.innerHTML = html;
}

function actionPath(action = {}) {
  return (
    action.path ||
    action.file ||
    action.screenshotPath ||
    action.imagePath ||
    action.outputPath ||
    action.artifactPath ||
    action.target ||
    action.directory ||
    action.cwd ||
    (Array.isArray(action.files) ? action.files[0] : "") ||
    ""
  );
}

function actionDisplayName(action = {}) {
  const pathValue = actionPath(action);
  if (pathValue) {
    return String(pathValue).split(/[\\/]/).filter(Boolean).pop() || pathValue;
  }
  return describeAction(action);
}

function artifactKindForAction(action = {}) {
  const type = String(action?.type || "").toLowerCase();
  if (["write_file", "append_file", "read_file", "create_directory", "delete_path"].includes(type)) return "code";
  if (["apply_patch", "file_edit", "file_rollback"].includes(type)) return "diff";
  if (type.startsWith("verify_")) return "verification";
  if (type === "browser_check" && (action.screenshotPath || action.imagePath)) return "screenshot";
  if (["browser_check", "browser_control", "browser_harness", "open_url"].includes(type)) return "preview";
  if (["terminal_open", "terminal_exec", "run_command", "execute_code"].includes(type)) return "terminal";
  if (type.startsWith("background_command_") || type === "process") return "job";
  if (["web_search", "web_fetch"].includes(type)) return "web";
  if (["todo_write", "task_create"].includes(type)) return "task";
  if (type === "agent_spawn") return "agent";
  if (["image_generate", "vision_analyze"].includes(type)) return "media";
  if (type === "audio_generate") return "audio";
  if (["launch_app", "open_path", "reveal_path", "set_volume", "media_control", "set_preview_device", "system_query"].includes(type)) return "desktop";
  return "tool";
}

function artifactLabelForKind(kind = "tool") {
  return {
    code: "Codigo",
    diff: "Diff",
    verification: "Verificacao",
    preview: "Preview",
    screenshot: "Screenshot",
    terminal: "Terminal",
    job: "Job",
    web: "Web",
    task: "Tarefa",
    agent: "Agente",
    media: "Midia",
    audio: "Audio",
    desktop: "PC",
    tool: "Tool"
  }[kind] || "Tool";
}

function artifactIconForKind(kind = "tool") {
  return {
    code: "{}",
    diff: "+-",
    verification: "ok",
    preview: "ui",
    screenshot: "img",
    terminal: ">_",
    job: "run",
    web: "net",
    task: "todo",
    agent: "ai",
    media: "img",
    audio: "aud",
    desktop: "pc",
    tool: "*"
  }[kind] || "*";
}

function artifactSummaryForEvent(event = {}) {
  const action = event.action || {};
  const pathValue = actionPath(action);
  const urlValue = action.url || urlFromText(event.result || event.content || "");
  const raw = event.result || event.content || describeAction(action);
  if (pathValue && urlValue) {
    return `${pathValue} -> ${urlValue}`;
  }
  return pathValue || urlValue || raw;
}

function diffStatsFromText(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (/^\+\s?/.test(line)) additions += 1;
    if (/^-\s?/.test(line)) deletions += 1;
  }
  const hunk = String(text || "").match(/@@\s+-\d+,(\d+)\s+\+\d+,(\d+)\s+@@/);
  if (!additions && !deletions && hunk) {
    deletions = Number(hunk[1] || 0);
    additions = Number(hunk[2] || 0);
  }
  return { additions, deletions };
}

function changeStatsForEvent(event = {}) {
  const action = event.action || {};
  const type = String(action.type || "").toLowerCase();
  if (type === "write_file" || type === "append_file") {
    const additions = String(action.content || "").split(/\r?\n/).filter((line) => line.length || String(action.content || "").includes("\n")).length;
    return { additions, deletions: 0 };
  }
  return diffStatsFromText([event.result, event.content, action.patch].filter(Boolean).join("\n"));
}

function collectChangeItems(chat = currentChat()) {
  const changeTypes = new Set([
    "write_file",
    "append_file",
    "file_edit",
    "apply_patch",
    "file_rollback",
    "create_directory",
    "delete_path",
    "project_prepare_vite",
    "image_generate",
    "audio_generate"
  ]);
  const seen = new Set();
  const items = [];

  for (const event of (chat?.localEvents || []).slice().reverse()) {
    const action = event.action || {};
    const type = String(action.type || "").toLowerCase();
    if (!changeTypes.has(type)) {
      continue;
    }

    const pathValue = actionPath(action) || urlFromText(event.result || event.content) || describeAction(action);
    const key = `${type}:${pathValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const stats = changeStatsForEvent(event);
    items.push({
      type,
      path: pathValue,
      name: actionDisplayName(action),
      ok: event.ok,
      timestamp: event.timestamp,
      summary: event.result || event.content || describeAction(action),
      additions: stats.additions,
      deletions: stats.deletions
    });
  }

  return items.slice(0, 12);
}

function runtimeActivityForChat(chat = currentChat()) {
  const chatId = chat?.id || currentChatId();
  return (state.runtimeActivity || []).filter((item) => !item.chatId || item.chatId === chatId);
}

function rememberRuntimeActivity(payload = {}) {
  const event = payload?.event || payload || {};
  const type = String(event.type || "").trim();
  if (!type || type === "text_delta" || type === "message_final" || type === "permission_result") {
    return;
  }
  const chatId = String(payload?.chatId || currentChatId() || "");
  const now = Date.now();
  const action = event.action || (event.tool || event.name ? { type: event.tool || event.name, ...event.args } : {});
  const kind = type === "agent_phase_changed" || type === "agent_reasoning_delta"
    ? "thinking"
    : type === "error"
      ? "error"
      : artifactKindForAction(action);
  const label = type === "agent_reasoning_delta"
    ? "Thought"
    : type === "agent_phase_changed"
      ? "Activity"
      : type === "error"
        ? "Error"
        : artifactLabelForKind(kind);
  const summary = type === "agent_reasoning_delta"
    ? String(event.delta || "").trim()
    : type === "agent_phase_changed"
      ? String(event.summary || event.message || event.phase || "Hermes pensando").trim()
      : type === "tool_call_started"
        ? `Starting ${describeAction(action)}`
        : type === "tool_call_finished"
          ? String(event.result || event.summary || describeAction(action)).trim()
          : String(event.message || event.reason || event.summary || describeAction(action) || type).trim();

  if (!summary && type !== "tool_call_started") {
    return;
  }

  if (type === "agent_reasoning_delta") {
    for (let index = state.runtimeActivity.length - 1; index >= 0; index -= 1) {
      const existing = state.runtimeActivity[index];
      if (existing.chatId === chatId && existing.type === "agent_reasoning_delta" && now - existing.timestamp < 8000) {
        existing.summary = shortText(`${existing.summary || ""}${summary}`, 900);
        existing.timestamp = now;
        return;
      }
    }
  }

  state.runtimeActivity.push({
    id: `${type}-${now}-${Math.random().toString(16).slice(2)}`,
    chatId,
    type,
    kind,
    label,
    icon: kind === "thinking" ? "th" : kind === "error" ? "!" : artifactIconForKind(kind),
    ok: type === "tool_call_started" ? null : event.ok,
    timestamp: now,
    path: actionPath(action),
    imagePath: imagePathFromEvent({ action, result: event.result }),
    summary: shortText(summary || type, 900)
  });

  if (state.runtimeActivity.length > 80) {
    state.runtimeActivity = state.runtimeActivity.slice(-80);
  }
  state.renderCache.activity = "";
  state.renderCache.transcript = "";
}

function collectActivityItems(chat = currentChat()) {
  const localItems = (chat?.localEvents || [])
    .slice(-16)
    .map((event) => {
      const action = event?.action || {};
      const kind = artifactKindForAction(action);
      return {
        type: String(action.type || "local"),
        kind,
        label: artifactLabelForKind(kind),
        icon: artifactIconForKind(kind),
        ok: event.ok,
        timestamp: event.timestamp,
        path: actionPath(action),
        imagePath: imagePathFromEvent(event),
        summary: artifactSummaryForEvent(event)
      };
    });
  const runtimeItems = runtimeActivityForChat(chat).slice(-24);
  return [...localItems, ...runtimeItems]
    .filter((item) => item && item.summary)
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
    .slice(0, 24);
}

function detectCodeLanguage(filePath = "", content = "") {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) return "javascript";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "bash";
  if (lower.endsWith(".ps1") || lower.endsWith(".psm1") || lower.endsWith(".psd1")) return "powershell";
  if (lower.endsWith(".diff") || lower.endsWith(".patch")) return "diff";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".lua")) return "lua";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return "xml";
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".hpp")) return "cpp";
  if (lower.endsWith(".cs")) return "csharp";
  const trimmed = String(content || "").trim();
  if (/^(<!doctype\s+html|<html[\s>]|<[a-z][\w:-]*(\s|>|\/>))/i.test(trimmed)) return "html";
  if (/^<\?xml|<[a-z][\w:-]*(\s|>|\/>)[\s\S]*<\/[a-z][\w:-]*>$/i.test(trimmed)) return "xml";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Keep falling through; many snippets start with braces without being JSON.
    }
  }
  if (/^[\s\S]*\{[\s\S]*:[\s\S]*;[\s\S]*\}/.test(trimmed) && /(^|\n)\s*[.#]?[a-z-][\w-]*\s*\{/i.test(trimmed)) return "css";
  if (/\b(import|export|const|let|function|class|return)\b/.test(trimmed)) return "javascript";
  return "text";
}

function normalizeFenceLanguage(language = "") {
  const lower = String(language || "").trim().toLowerCase();
  if (!lower) return "text";
  if (lower === "js" || lower === "mjs" || lower === "cjs") return "javascript";
  if (lower === "ts" || lower === "tsx") return "typescript";
  if (lower === "yml") return "yaml";
  if (lower === "htm") return "html";
  if (lower === "md") return "markdown";
  if (lower === "py") return "python";
  if (lower === "sh" || lower === "bash" || lower === "zsh" || lower === "shell") return "bash";
  if (lower === "ps1" || lower === "powershell") return "powershell";
  if (lower === "patch") return "diff";
  if (lower === "rs") return "rust";
  if (lower === "cs") return "csharp";
  if (lower === "c++") return "cpp";
  return lower;
}

function extractCodeBlocks(content = "") {
  const blocks = [];
  const source = String(content || "");
  const pattern = /```([a-zA-Z0-9_+#.-]*)[^\r\n]*\r?\n([\s\S]*?)```/g;
  for (const match of source.matchAll(pattern)) {
    const blockContent = String(match[2] || "").trim();
    if (!blockContent) {
      continue;
    }
    blocks.push({
      language: normalizeFenceLanguage(match[1]),
      content: blockContent
    });
  }

  const fenceCount = (source.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    const partialMatch = source.match(/```([a-zA-Z0-9_+#.-]*)[^\r\n]*\r?\n([\s\S]*)$/);
    const partialContent = String(partialMatch?.[2] || "").trim();
    if (partialContent && (!blocks.length || blocks.at(-1)?.content !== partialContent)) {
      blocks.push({
        language: normalizeFenceLanguage(partialMatch?.[1]),
        content: partialContent
      });
    }
  }

  return blocks;
}

function isHtmlLikeCode(content = "") {
  const source = String(content || "").trim();
  if (!source) {
    return false;
  }
  if (/(?:<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>])/i.test(source)) {
    return true;
  }
  const hasRenderableTag = /<(main|section|article|div|button|input|canvas|form|header|footer|style|script|h[1-6]|p|ul|ol|li|table|nav|aside|span|a|img|label|select|textarea)\b[\s\S]*?>/i.test(source);
  const hasClosingTag = /<\/(main|section|article|div|button|canvas|form|header|footer|style|script|h[1-6]|p|ul|ol|li|table|nav|aside|span|a|label|select|textarea)>/i.test(source);
  return hasRenderableTag && hasClosingTag;
}

function normalizeCodeBlockForPreview(block = {}) {
  const language = normalizeFenceLanguage(block.language || "");
  const content = String(block.content || "").trim();
  if ((language === "text" || !language) && isHtmlLikeCode(content)) {
    return { ...block, language: "html", content };
  }
  return { ...block, language, content };
}

function extractCodeArtifacts(content = "") {
  const source = String(content || "");
  const fencedBlocks = extractCodeBlocks(source);
  if (fencedBlocks.length) {
    return {
      blocks: fencedBlocks.map(normalizeCodeBlockForPreview),
      prose: source
        .replace(/```([a-zA-Z0-9_+#.-]*)[^\r\n]*\r?\n[\s\S]*?```/g, "")
        .replace(/```([a-zA-Z0-9_+#.-]*)[^\r\n]*\r?\n[\s\S]*$/g, "")
        .trim()
    };
  }

  const htmlStart = source.search(/(?:<!doctype\s+html|<html[\s>])/i);
  if (htmlStart < 0) {
    return { blocks: [], prose: source.trim() };
  }

  const artifact = source.slice(htmlStart).trim();
  if (artifact.length < 180 || !/<\/html>|<\/body>|<\/script>|<\/style>/i.test(artifact)) {
    return { blocks: [], prose: source.trim() };
  }

  return {
    blocks: [
      {
        language: "html",
        content: artifact
      }
    ],
    prose: source.slice(0, htmlStart).trim()
  };
}

function codePathForLanguage(language = "text") {
  switch (normalizeFenceLanguage(language)) {
    case "html":
      return "assistant-snippet.html";
    case "css":
      return "assistant-snippet.css";
    case "javascript":
      return "assistant-snippet.js";
    case "typescript":
      return "assistant-snippet.ts";
    case "json":
      return "assistant-snippet.json";
    case "markdown":
      return "assistant-snippet.md";
    case "python":
      return "assistant-snippet.py";
    case "yaml":
      return "assistant-snippet.yml";
    case "bash":
      return "assistant-snippet.sh";
    case "powershell":
      return "assistant-snippet.ps1";
    default:
      return "assistant-snippet.txt";
  }
}

function codeExtensionForLanguage(language = "text") {
  const pathValue = codePathForLanguage(language);
  const match = pathValue.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "txt";
}

function codeEditorKey(preview = null) {
  if (!preview) {
    return "";
  }
  return [
    preview.source || "unknown",
    preview.path || "",
    preview.language || ""
  ].join("::");
}

function stopCodeTyping() {
  if (state.codeTyping.timer) {
    clearTimeout(state.codeTyping.timer);
  }
  state.codeTyping = {
    stableKey: "",
    target: "",
    visible: "",
    timer: null
  };
}

function shouldAnimateCodePreview(preview = null, chat = currentChat()) {
  if (!preview || state.codeEditor.dirty || preview.source === "patch") {
    return false;
  }
  const chatRunning = String(chat?.status || "").toLowerCase() === "running";
  const typingActive =
    state.codeTyping.stableKey === codeEditorKey(preview) &&
    state.codeTyping.visible.length < state.codeTyping.target.length;
  return Boolean(chatRunning || preview.pending || typingActive);
}

function nextCodeTypingIndex(target = "", currentIndex = 0) {
  const source = String(target || "");
  if (currentIndex >= source.length) {
    return source.length;
  }
  const newlineIndex = source.indexOf("\n", currentIndex + 1);
  const lineEnd = newlineIndex >= 0 ? newlineIndex + 1 : source.length;
  const chunkSize = source.length > 6000 ? 260 : source.length > 1800 ? 120 : 60;
  return Math.min(source.length, lineEnd, currentIndex + chunkSize);
}

function scheduleCodeTypingFrame() {
  if (state.codeTyping.timer) {
    return;
  }
  state.codeTyping.timer = setTimeout(() => {
    state.codeTyping.timer = null;
    const typing = state.codeTyping;
    if (!typing.target || typing.visible.length >= typing.target.length) {
      return;
    }
    const nextIndex = nextCodeTypingIndex(typing.target, typing.visible.length);
    typing.visible = typing.target.slice(0, nextIndex);
    state.renderCache.workbench = "";
    renderWorkbenchPanel();
    if (typing.visible.length < typing.target.length) {
      scheduleCodeTypingFrame();
    }
  }, 34);
}

function codeTypingDisplayValue(preview = null, targetValue = "", chat = currentChat()) {
  const target = String(targetValue || "");
  if (!shouldAnimateCodePreview(preview, chat)) {
    stopCodeTyping();
    return target;
  }

  const stableKey = codeEditorKey(preview);
  if (
    state.codeTyping.stableKey !== stableKey ||
    !target.startsWith(state.codeTyping.visible)
  ) {
    state.codeTyping.stableKey = stableKey;
    state.codeTyping.visible = "";
  }
  state.codeTyping.target = target;
  if (state.codeTyping.visible.length >= target.length) {
    return target;
  }
  scheduleCodeTypingFrame();
  return state.codeTyping.visible;
}

function canPersistCodePreview(preview = null) {
  if (!preview?.path) {
    return false;
  }
  if (preview.source === "assistant" || preview.source === "patch") {
    return false;
  }
  return !/^assistant-snippet\./i.test(String(preview.path || ""));
}

function languageLabel(language = "text") {
  const normalized = normalizeFenceLanguage(language);
  return ({
    javascript: "JavaScript",
    typescript: "TypeScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    markdown: "Markdown",
    python: "Python",
    yaml: "YAML",
    bash: "Bash",
    powershell: "PowerShell",
    diff: "Diff",
    rust: "Rust",
    csharp: "C#",
    cpp: "C++",
    c: "C",
    go: "Go",
    java: "Java",
    lua: "Lua",
    sql: "SQL",
    xml: "XML"
  })[normalized] || normalized || "Texto";
}

function lineNumbersForCode(content = "") {
  const count = Math.max(1, String(content || "").split("\n").length);
  return Array.from({ length: count }, (_, index) => `<span>${index + 1}</span>`).join("");
}

function replaceTokenPlaceholders(value, tokens) {
  return String(value || "").replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || "");
}

function protectTokens(source, pattern, className, tokens) {
  return String(source || "").replace(pattern, (match) => {
    const tokenId = tokens.length;
    tokens.push(`<span class="${className}">${escapeHtml(match)}</span>`);
    return `\u0000${tokenId}\u0000`;
  });
}

function highlightCode(content = "", language = "text") {
  const normalized = normalizeFenceLanguage(language);
  const source = String(content || "");
  if (!source) {
    return "";
  }
  if (normalized === "html" || normalized === "xml") return highlightMarkup(source);
  if (normalized === "css") return highlightCss(source);
  if (normalized === "json") return highlightJson(source);
  if (normalized === "markdown") return highlightMarkdown(source);
  if (normalized === "yaml") return highlightYaml(source);
  if (normalized === "diff") return highlightDiff(source);
  if (normalized === "bash" || normalized === "powershell") return highlightShell(source, normalized);
  if (["javascript", "typescript", "python", "java", "go", "rust", "lua", "c", "cpp", "csharp", "sql"].includes(normalized)) {
    return highlightProgramming(source, normalized);
  }
  return escapeHtml(source);
}

function highlightProgramming(content = "", language = "text") {
  const tokens = [];
  let source = String(content || "");
  source = protectTokens(source, /\/\*[\s\S]*?\*\//g, "tok-comment", tokens);
  source = protectTokens(source, /(^|[^:])\/\/.*$/gm, "tok-comment", tokens);
  source = protectTokens(source, /#.*$/gm, "tok-comment", tokens);
  source = protectTokens(source, /`(?:\\[\s\S]|[^`\\])*`/g, "tok-template", tokens);
  source = protectTokens(source, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "tok-string", tokens);

  let html = escapeHtml(source);
  const keywordMap = {
    javascript: "async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined",
    typescript: "abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace never new null number object of private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield",
    python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while",
    go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil",
    rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    lua: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
    c: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while",
    cpp: "alignas alignof and asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while",
    csharp: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while",
    sql: "select from where insert update delete into values create alter drop table join left right inner outer on group by order having limit offset distinct as and or not null true false primary key foreign references"
  };
  const keywords = (keywordMap[language] || keywordMap.javascript).split(/\s+/).filter(Boolean);
  const keywordPattern = new RegExp(`\\b(${keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");

  html = html
    .replace(keywordPattern, '<span class="tok-keyword">$1</span>')
    .replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, '<span class="tok-function">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="tok-number">$1</span>')
    .replace(/([=+\-*/%<>!&|?:~^]+)/g, '<span class="tok-operator">$1</span>');

  return replaceTokenPlaceholders(html, tokens);
}

function highlightMarkup(content = "") {
  let html = escapeHtml(content);
  html = html.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>');
  html = html.replace(/(&lt;\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?&gt;)/g, (_, open, tag, attrs, close) => {
    const highlightedAttrs = attrs.replace(/([\w:-]+)(\s*=\s*)(&quot;.*?&quot;|&#39;.*?&#39;|[^\s&]+)?/g, (_attr, name, eq, value = "") =>
      `<span class="tok-attr">${name}</span>${eq}<span class="tok-string">${value}</span>`
    );
    return `<span class="tok-punctuation">${open}</span><span class="tok-tag">${tag}</span>${highlightedAttrs}<span class="tok-punctuation">${close}</span>`;
  });
  return html;
}

function highlightCss(content = "") {
  const tokens = [];
  let source = protectTokens(content, /\/\*[\s\S]*?\*\//g, "tok-comment", tokens);
  source = protectTokens(source, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "tok-string", tokens);
  let html = escapeHtml(source);
  html = html
    .replace(/([.#]?[A-Za-z_-][\w-]*)(?=\s*\{)/g, '<span class="tok-selector">$1</span>')
    .replace(/([A-Za-z-]+)(\s*:)/g, '<span class="tok-property">$1</span>$2')
    .replace(/(#[0-9A-Fa-f]{3,8})\b/g, '<span class="tok-number">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?)\b/g, '<span class="tok-number">$1</span>');
  return replaceTokenPlaceholders(html, tokens);
}

function highlightJson(content = "") {
  let html = escapeHtml(content);
  html = html
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="tok-property">$1</span>$2')
    .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="tok-string">$2</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  return html;
}

function highlightYaml(content = "") {
  let html = escapeHtml(content);
  html = html
    .replace(/^(\s*#.*)$/gm, '<span class="tok-comment">$1</span>')
    .replace(/^(\s*[\w.-]+)(\s*:)/gm, '<span class="tok-property">$1</span>$2')
    .replace(/\b(true|false|null|yes|no|on|off)\b/gi, '<span class="tok-keyword">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  return html;
}

function highlightMarkdown(content = "") {
  let html = escapeHtml(content);
  html = html
    .replace(/^(#{1,6}\s.*)$/gm, '<span class="tok-heading">$1</span>')
    .replace(/(`[^`]+`)/g, '<span class="tok-string">$1</span>')
    .replace(/(\*\*[^*]+\*\*)/g, '<span class="tok-keyword">$1</span>')
    .replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="tok-link">$1</span>');
  return html;
}

function highlightDiff(content = "") {
  return escapeHtml(content)
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return `<span class="tok-diff-add">${line}</span>`;
      if (line.startsWith("-") && !line.startsWith("---")) return `<span class="tok-diff-del">${line}</span>`;
      if (line.startsWith("@@")) return `<span class="tok-diff-hunk">${line}</span>`;
      return line;
    })
    .join("\n");
}

function highlightShell(content = "", language = "bash") {
  const tokens = [];
  let source = protectTokens(content, /#.*$/gm, "tok-comment", tokens);
  source = protectTokens(source, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "tok-string", tokens);
  let html = escapeHtml(source);
  const keywords = language === "powershell"
    ? "function if else elseif foreach for while switch param process begin end try catch finally return true false null"
    : "if then else elif fi for while do done case esac function in select until return export local true false";
  html = html
    .replace(new RegExp(`\\b(${keywords.split(/\s+/).join("|")})\\b`, "g"), '<span class="tok-keyword">$1</span>')
    .replace(/(\$[A-Za-z_][\w]*|\$\{[^}]+\})/g, '<span class="tok-variable">$1</span>')
    .replace(/\b([A-Za-z_.-][\w.-]*)(?=\s)/g, '<span class="tok-function">$1</span>');
  return replaceTokenPlaceholders(html, tokens);
}

function syncCodeEditor() {
  const input = elements.codeSurface?.querySelector(".code-input");
  const highlight = elements.codeSurface?.querySelector(".code-highlight");
  const gutter = elements.codeSurface?.querySelector(".code-gutter");
  if (!input || !highlight || !gutter) {
    return;
  }

  const language = input.dataset.language || "text";
  const value = input.value || "";
  highlight.innerHTML = highlightCode(value, language);
  gutter.innerHTML = lineNumbersForCode(value);
  highlight.scrollTop = input.scrollTop;
  highlight.scrollLeft = input.scrollLeft;
  gutter.scrollTop = input.scrollTop;
  markCodeShaderTextureDirty();
  updateCodeShaderFromCaret(input, { pulse: false });
}

function estimateCodeCharWidth(input) {
  const style = getComputedStyle(input);
  const canvas = estimateCodeCharWidth.canvas || (estimateCodeCharWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  return Math.max(6, context.measureText("M").width);
}

function updateCodeShaderFromCaret(input, options = {}) {
  if (!input || !codeShaderRuntime.canvas || codeShaderRuntime.canvas.hidden) {
    return;
  }
  const rect = codeShaderRuntime.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const style = getComputedStyle(input);
  const value = input.value || "";
  const caret = Math.max(0, Math.min(value.length, input.selectionStart ?? value.length));
  const beforeCaret = value.slice(0, caret);
  const lines = beforeCaret.split("\n");
  const lineIndex = lines.length - 1;
  const column = lines[lineIndex]?.length || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const charWidth = estimateCodeCharWidth(input);
  codeShaderRuntime.cell = [charWidth, lineHeight];
  const x = paddingLeft + column * charWidth - input.scrollLeft;
  const lineTop = paddingTop + lineIndex * lineHeight - input.scrollTop;
  const y = lineTop + lineHeight * 0.58;
  const nextX = Math.max(0, Math.min(rect.width, x));
  const nextY = Math.max(0, Math.min(rect.height, y));
  const previous = codeShaderRuntime.caretPx || [nextX, nextY];
  const distance = Math.hypot(nextX - previous[0], nextY - previous[1]);
  const angle = Math.atan2(nextY - previous[1], nextX - previous[0]);
  const dprX = codeShaderRuntime.canvas.width / Math.max(1, rect.width);
  const dprY = codeShaderRuntime.canvas.height / Math.max(1, rect.height);
  const shaderSettings = currentCodeShaderSettings({
    ...(state.app?.settings || {}),
    ...(codeShaderRuntime.settings || {}),
    codeShaderForceOn: true
  });
  const shape = shaderSettings.preset;
  const cursorStyle = CODE_CURSOR_STYLES[shape] ?? CODE_CURSOR_STYLES.bar;
  const cursorWidthCss = Math.max(charWidth, 7);
  const cursorHeightCss = lineHeight;
  const cursorTopCss = lineTop;
  const cursorWidthPx = Math.max(1, cursorWidthCss * dprX);
  const cursorHeightPx = Math.max(1, cursorHeightCss * dprY);
  const cursorBox = [
    Math.max(0, Math.min(Math.max(0, codeShaderRuntime.canvas.width - cursorWidthPx), nextX * dprX)),
    Math.max(cursorHeightPx, Math.min(codeShaderRuntime.canvas.height, (rect.height - cursorTopCss) * dprY)),
    cursorWidthPx,
    cursorHeightPx
  ];
  const normalized = [
    Math.max(0, Math.min(1, x / rect.width)),
    Math.max(0, Math.min(1, 1 - (y / rect.height)))
  ];
  codeShaderRuntime.prevMouse = codeShaderRuntime.mouse || normalized;
  codeShaderRuntime.mouse = normalized;
  const shouldTriggerCursorChange = distance > 0.5 || options.pulse;
  if (shouldTriggerCursorChange) {
    codeShaderRuntime.lastCaretChangeAt = performance.now();
    if (Array.isArray(options.previousCursorBox)) {
      codeShaderRuntime.previousCursorBox = [...options.previousCursorBox];
    } else if (options.pulse && distance <= 0.5) {
      const fallbackWidth = Math.max(cursorBox[2], codeShaderRuntime.cell[0] * dprX);
      codeShaderRuntime.previousCursorBox = [
        Math.max(0, cursorBox[0] - fallbackWidth),
        cursorBox[1],
        cursorBox[2],
        cursorBox[3]
      ];
    } else {
      codeShaderRuntime.previousCursorBox = codeShaderRuntime.cursorBox ? [...codeShaderRuntime.cursorBox] : cursorBox;
    }
    if (options.pulse && CODE_WIDTH_PULSE_CURSOR_SHADERS.has(shaderSettings.cursor)) {
      codeShaderRuntime.previousCursorBox[2] = Math.max(1, cursorBox[2] * 0.18);
    }
    if (options.pulse) {
      const deltaX = codeShaderRuntime.previousCursorBox[0] - cursorBox[0];
      const deltaY = codeShaderRuntime.previousCursorBox[1] - cursorBox[1];
      const travel = Math.hypot(deltaX, deltaY);
      if (travel <= 0.5) {
        const fallbackTravel = Math.max(codeShaderRuntime.cell[0] * dprX, cursorBox[2]);
        codeShaderRuntime.previousCursorBox[0] = Math.max(0, cursorBox[0] - fallbackTravel);
        codeShaderRuntime.previousCursorBox[1] = cursorBox[1];
      }
    }
    codeShaderRuntime.previousCursorColor = codeShaderRuntime.cursorColor ? [...codeShaderRuntime.cursorColor] : [0.66, 0.61, 1, 1];
    codeShaderRuntime.previousCursorStyle = codeShaderRuntime.cursorStyle;
    codeShaderRuntime.cursorChangeTime = currentCodeShaderTime();
  }
  const colors = getGhosttyCodeUniformColors();
  codeShaderRuntime.cursorColor = codeShaderCursorUniformColor(shaderSettings.cursor, currentCodeShaderTime());
  codeShaderRuntime.cursorStyle = cursorStyle;
  codeShaderRuntime.cursorBox = cursorBox;
  const stack = input.closest(".code-editor-stack");
  if (stack) {
    stack.style.setProperty("--code-caret-x", `${nextX}px`);
    stack.style.setProperty("--code-caret-y", `${nextY}px`);
  }
  if (options.pulse) {
    const amount = Number.isFinite(options.amount) ? options.amount : 0.62;
    codeShaderRuntime.pulse = Math.min(1.35, (codeShaderRuntime.pulse || 0) + amount);
    codeShaderRuntime.lastInputAt = performance.now();
    if (stack) {
      stack.style.setProperty("--code-prev-x", `${previous[0]}px`);
      stack.style.setProperty("--code-prev-y", `${previous[1]}px`);
      stack.style.setProperty("--code-trail-w", `${Math.max(0, distance)}px`);
      stack.style.setProperty("--code-trail-r", `${Number.isFinite(angle) ? angle : 0}rad`);
      stack.classList.remove("is-code-pulsing");
      stack.classList.remove("is-code-trailing");
      void stack.offsetWidth;
      stack.classList.add("is-code-pulsing");
      if (distance > 1.25) {
        stack.classList.add("is-code-trailing");
      }
    }
    startCodeShaderLoop();
  }
  codeShaderRuntime.caretPx = [nextX, nextY];
}

function queueCodeShaderFromCaret(input, options = {}) {
  if (!input) {
    return;
  }
  requestAnimationFrame(() => updateCodeShaderFromCaret(input, options));
}

function replaceCodeSelection(input, replacement, nextSelectionStart, nextSelectionEnd = nextSelectionStart) {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  input.setRangeText(replacement, start, end, "preserve");
  input.selectionStart = nextSelectionStart;
  input.selectionEnd = nextSelectionEnd;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function handleCodeEditorKeydown(event, input) {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const value = input.value || "";
    const indent = "  ";
    if (start !== end && value.slice(start, end).includes("\n")) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const selected = value.slice(lineStart, end);
      const replacement = selected
        .split("\n")
        .map((line) => event.shiftKey ? line.replace(/^ {1,2}/, "") : indent + line)
        .join("\n");
      const delta = replacement.length - selected.length;
      replaceCodeSelection(input, replacement, lineStart, Math.max(lineStart, end + delta));
    } else if (event.shiftKey) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const removable = value.slice(lineStart, lineStart + 2).match(/^ {1,2}/)?.[0] || "";
      if (removable) {
        input.setSelectionRange(lineStart, lineStart + removable.length);
        replaceCodeSelection(input, "", Math.max(lineStart, start - removable.length), Math.max(lineStart, end - removable.length));
      }
    } else {
      replaceCodeSelection(input, indent, start + indent.length);
    }
    updateCodeShaderFromCaret(input, { pulse: true });
    return true;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const start = input.selectionStart ?? 0;
    const value = input.value || "";
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const currentLine = value.slice(lineStart, start);
    const indentation = currentLine.match(/^\s*/)?.[0] || "";
    const extra = /[{[(]\s*$/.test(currentLine) ? "  " : "";
    const insert = `\n${indentation}${extra}`;
    replaceCodeSelection(input, insert, start + insert.length);
    updateCodeShaderFromCaret(input, { pulse: true });
    return true;
  }
  return false;
}

function composeInlinePreviewDocument(blocks = []) {
  const normalizedBlocks = blocks.map(normalizeCodeBlockForPreview);
  const htmlBlock = normalizedBlocks.find((block) => block.language === "html");
  if (!htmlBlock) {
    return "";
  }

  const cssBundle = normalizedBlocks
    .filter((block) => block.language === "css")
    .map((block) => block.content)
    .join("\n\n");
  const jsBundle = normalizedBlocks
    .filter((block) => block.language === "javascript" || block.language === "typescript")
    .map((block) => block.content)
    .join("\n\n");

  let documentHtml = htmlBlock.content;
  if (!/<html[\s>]/i.test(documentHtml)) {
    documentHtml = [
      "<!doctype html>",
      `<html lang="${effectiveLocale()}">`,
      "<head>",
      "  <meta charset=\"UTF-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
      "</head>",
      "<body>",
      documentHtml,
      "</body>",
      "</html>"
    ].join("\n");
  }

  if (cssBundle) {
    const styleTag = `<style>\n${cssBundle}\n</style>`;
    documentHtml = /<\/head>/i.test(documentHtml)
      ? documentHtml.replace(/<\/head>/i, `${styleTag}\n</head>`)
      : `${styleTag}\n${documentHtml}`;
  }

  const scrollbarStyleTag = `<style>
    html {
      scrollbar-width: thin;
      scrollbar-color: rgba(170, 146, 255, 0.34) transparent;
    }
    *::-webkit-scrollbar {
      width: 7px;
      height: 7px;
    }
    *::-webkit-scrollbar-track {
      background: transparent;
    }
    *::-webkit-scrollbar-thumb {
      min-height: 36px;
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(185, 160, 255, 0.42), rgba(95, 131, 255, 0.26));
      border: 2px solid rgba(8, 7, 20, 0.72);
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(180deg, rgba(200, 178, 255, 0.62), rgba(119, 151, 255, 0.42));
      background-clip: padding-box;
    }
  </style>`;
  documentHtml = /<\/head>/i.test(documentHtml)
    ? documentHtml.replace(/<\/head>/i, `${scrollbarStyleTag}\n</head>`)
    : `${scrollbarStyleTag}\n${documentHtml}`;

  if (jsBundle) {
    const scriptTag = `<script>\n${jsBundle}\n<\/script>`;
    documentHtml = /<\/body>/i.test(documentHtml)
      ? documentHtml.replace(/<\/body>/i, `${scriptTag}\n</body>`)
      : `${documentHtml}\n${scriptTag}`;
  }

  return documentHtml;
}

function buildAssistantCodePreview(chat = currentChat()) {
  const messages = Array.isArray(chat?.messages) ? [...chat.messages].reverse() : [];
  for (const message of messages) {
    if (message?.kind !== "assistant") {
      continue;
    }

    const parsed = extractMessagePayload(message);
    const blocks = extractCodeArtifacts(parsed.body || message.content || "").blocks;
    if (!blocks.length) {
      continue;
    }

    const primary =
      blocks.find((block) => block.language === "html") ||
      blocks.find((block) => block.language !== "text") ||
      blocks[0];
    const path = codePathForLanguage(primary.language);
    const inlinePreviewHtml = composeInlinePreviewDocument(blocks);
    const content = blocks.length === 1
      ? primary.content
      : blocks.map((block, index) => [
        `===== bloco ${index + 1} · ${block.language} =====`,
        block.content
      ].join("\n")).join("\n\n");

    return {
      path,
      language: detectCodeLanguage(path, content),
      content,
      meta: blocks.length > 1 ? `${blocks.length} blocos` : "assistant",
      inlinePreviewHtml,
      timestamp: message.timestamp || 0,
      source: "assistant",
      pending: Boolean(message.pending)
    };
  }

  return null;
}

function basenameForWorkbenchPath(filePath = "") {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || String(filePath || "arquivo");
}

function upsertWorkbenchFile(filesByPath, item = {}) {
  const pathValue = String(item.path || "").trim();
  if (!pathValue) {
    return;
  }
  const timestamp = Number(item.timestamp || Date.now());
  const previous = filesByPath.get(pathValue);
  if (previous && Number(previous.timestamp || 0) > timestamp) {
    return;
  }
  const content = String(item.content ?? "");
  filesByPath.set(pathValue, {
    path: pathValue,
    name: basenameForWorkbenchPath(pathValue),
    language: item.language || detectCodeLanguage(pathValue, content),
    content,
    meta: item.meta || item.type || item.source || "arquivo",
    timestamp,
    source: item.source || "file",
    ok: typeof item.ok === "boolean" ? item.ok : null,
    inlinePreviewHtml: item.inlinePreviewHtml || "",
    pending: Boolean(item.pending)
  });
}

function collectAssistantWorkbenchFiles(chat = currentChat()) {
  const files = [];
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (const message of messages) {
    if (message?.kind !== "assistant") {
      continue;
    }
    const parsed = extractMessagePayload(message);
    const blocks = extractCodeArtifacts(parsed.body || message.content || "").blocks;
    if (!blocks.length) {
      continue;
    }
    const combinedInlinePreview = composeInlinePreviewDocument(blocks);
    blocks.forEach((block, index) => {
      const language = normalizeFenceLanguage(block.language);
      const extension = codeExtensionForLanguage(language);
      const pathValue = blocks.length === 1
        ? codePathForLanguage(language)
        : `assistant-snippet-${index + 1}.${extension}`;
      const content = String(block.content || "");
      files.push({
        path: pathValue,
        language: detectCodeLanguage(pathValue, content),
        content,
        meta: blocks.length > 1 ? `bloco ${index + 1}` : "assistant",
        inlinePreviewHtml: language === "html" ? combinedInlinePreview : "",
        timestamp: message.timestamp || 0,
        source: "assistant",
        pending: Boolean(message.pending)
      });
    });
  }
  return files;
}

function collectWorkbenchFiles(chat = currentChat()) {
  const filesByPath = new Map();
  const events = Array.isArray(chat?.localEvents) ? chat.localEvents : [];
  for (const event of events) {
    const action = event?.action || {};
    const type = String(action.type || "").trim().toLowerCase();
    const filePath = action.path || action.file || action.target || "";
    if (type === "write_file" || type === "append_file" || type === "read_file") {
      if (!filePath) {
        continue;
      }
      const content = String(action.content ?? "");
      const language = detectCodeLanguage(filePath, content);
      upsertWorkbenchFile(filesByPath, {
        path: filePath,
        language,
        content,
        meta: type === "append_file" ? "append" : type === "read_file" ? "read" : "write",
        inlinePreviewHtml: language === "html"
          ? composeInlinePreviewDocument([{ language: "html", content }])
          : "",
        timestamp: event.timestamp || 0,
        source: "file",
        ok: event.ok
      });
      continue;
    }
    if (type === "apply_patch") {
      const content = String(action.patch || "");
      if (content) {
        upsertWorkbenchFile(filesByPath, {
          path: filePath || "patch.diff",
          language: "diff",
          content,
          meta: "patch",
          timestamp: event.timestamp || 0,
          source: "patch",
          ok: event.ok
        });
      }
      continue;
    }
    if (type === "file_edit") {
      if (!filePath) {
        continue;
      }
      const edits = Array.isArray(action.edits) ? action.edits : [];
      if (edits.length) {
        const content = edits
          .slice(0, 10)
          .map((edit, index) => {
            const editType = String(edit?.type || "replace");
            const oldText = String(edit?.oldText || "").trim();
            const newText = String(edit?.newText || "").trim();
            return [
              `# edit ${index + 1} · ${editType}`,
              oldText ? `- ${oldText}` : "",
              newText ? `+ ${newText}` : ""
            ].filter(Boolean).join("\n");
          })
          .join("\n\n");
        if (content) {
          upsertWorkbenchFile(filesByPath, {
            path: filePath,
            language: detectCodeLanguage(filePath, content),
            content,
            meta: "patch",
            timestamp: event.timestamp || 0,
            source: "patch",
            ok: event.ok
          });
        }
      }
    }
  }

  for (const file of collectAssistantWorkbenchFiles(chat)) {
    upsertWorkbenchFile(filesByPath, file);
  }

  return [...filesByPath.values()]
    .filter((file) => file.content || file.source === "file")
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function codePreviewFromWorkbenchFile(file = null) {
  if (!file) {
    return null;
  }
  return {
    path: file.path,
    language: file.language || detectCodeLanguage(file.path, file.content),
    content: String(file.content || ""),
    meta: file.meta || file.source || "arquivo",
    inlinePreviewHtml: file.inlinePreviewHtml || "",
    timestamp: file.timestamp || 0,
    source: file.source || "file",
    pending: Boolean(file.pending)
  };
}

function buildCodePreview(chat = currentChat(), files = collectWorkbenchFiles(chat)) {
  const selectedPath = String(state.selectedWorkbenchFilePath || "");
  if (selectedPath) {
    const selected = files.find((file) => file.path === selectedPath);
    if (selected) {
      return codePreviewFromWorkbenchFile(selected);
    }
  }
  const preferred = files.find((file) => file.source !== "patch") || files[0] || null;
  return codePreviewFromWorkbenchFile(preferred) || buildAssistantCodePreview(chat);
}

function normalizeWorkbenchBrowserPath(value = "") {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  const uncPrefix = normalized.startsWith("//") ? "//" : "";
  const body = (uncPrefix ? normalized.slice(2) : normalized)
    .replace(/\/+/g, "/")
    .replace(/\/$/g, "");
  return `${uncPrefix}${body}`;
}

function splitWorkbenchBrowserPath(value = "") {
  return normalizeWorkbenchBrowserPath(value).split("/").filter(Boolean);
}

function commonWorkbenchRoot(files = []) {
  const folders = files
    .map((file) => splitWorkbenchBrowserPath(file.path).slice(0, -1))
    .filter((parts) => parts.length > 1);
  if (!folders.length) {
    return "";
  }
  let prefix = [...folders[0]];
  for (const parts of folders.slice(1)) {
    let index = 0;
    while (
      index < prefix.length &&
      index < parts.length &&
      prefix[index].toLowerCase() === parts[index].toLowerCase()
    ) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix.length) {
      return "";
    }
  }
  return prefix.length > 1 ? prefix.join("/") : "";
}

function workbenchBrowserRoot(files = [], chat = currentChat()) {
  const workspaceRoot = normalizeWorkbenchBrowserPath(chat?.workspaceRoot || "");
  return workspaceRoot || commonWorkbenchRoot(files);
}

function relativeWorkbenchBrowserPath(filePath = "", root = "") {
  const normalized = normalizeWorkbenchBrowserPath(filePath);
  const normalizedRoot = normalizeWorkbenchBrowserPath(root);
  if (!normalizedRoot) {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  if (lower === lowerRoot) {
    return basenameForWorkbenchPath(normalized);
  }
  if (lower.startsWith(`${lowerRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

function countWorkbenchFolders(files = [], root = "") {
  const folderPaths = new Set();
  for (const file of files) {
    const parts = splitWorkbenchBrowserPath(relativeWorkbenchBrowserPath(file.path, root));
    for (let index = 0; index < parts.length - 1; index += 1) {
      folderPaths.add(parts.slice(0, index + 1).join("/").toLowerCase());
    }
  }
  return folderPaths.size;
}

function workbenchFileBrowserModel(files = [], currentPath = "", chat = currentChat()) {
  const root = workbenchBrowserRoot(files, chat);
  const currentParts = splitWorkbenchBrowserPath(currentPath);
  const foldersByPath = new Map();
  const visibleFiles = [];
  for (const file of files) {
    const displayPath = relativeWorkbenchBrowserPath(file.path, root) || basenameForWorkbenchPath(file.path);
    const parts = splitWorkbenchBrowserPath(displayPath);
    if (!parts.length) {
      continue;
    }
    const insideCurrent = currentParts.every((part, index) => parts[index]?.toLowerCase() === part.toLowerCase());
    if (!insideCurrent) {
      continue;
    }
    const remaining = parts.slice(currentParts.length);
    if (remaining.length > 1) {
      const folderName = remaining[0];
      const folderPath = [...currentParts, folderName].join("/");
      const previous = foldersByPath.get(folderPath) || {
        name: folderName,
        path: folderPath,
        count: 0,
        latest: 0
      };
      previous.count += 1;
      previous.latest = Math.max(previous.latest, Number(file.timestamp || 0));
      foldersByPath.set(folderPath, previous);
      continue;
    }
    visibleFiles.push({
      ...file,
      displayPath,
      displayName: parts.at(-1) || file.name || basenameForWorkbenchPath(file.path),
      folderPath: currentParts.join("/")
    });
  }

  const folders = [...foldersByPath.values()].sort((left, right) => {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  visibleFiles.sort((left, right) => {
    return String(left.displayName || "").localeCompare(String(right.displayName || ""), undefined, { sensitivity: "base" });
  });

  return {
    root,
    currentPath: currentParts.join("/"),
    folders,
    files: visibleFiles
  };
}

function fileBrowserBreadcrumb(currentPath = "") {
  const parts = splitWorkbenchBrowserPath(currentPath);
  const crumbs = [
    `<button type="button" class="file-browser-crumb ${parts.length ? "" : "is-active"}" data-workbench-breadcrumb="">Folders</button>`
  ];
  parts.forEach((part, index) => {
    const pathValue = parts.slice(0, index + 1).join("/");
    const active = index === parts.length - 1;
    crumbs.push(`
      <span class="file-browser-crumb-sep">/</span>
      <button type="button" class="file-browser-crumb ${active ? "is-active" : ""}" data-workbench-breadcrumb="${escapeHtml(pathValue)}">${escapeHtml(part)}</button>
    `);
  });
  return crumbs.join("");
}

function fileBrowserItemMeta(file = {}) {
  if (file.pending) return "gerando";
  if (file.ok === false) return "falhou";
  return file.meta || file.source || "arquivo";
}

function fileBrowserLanguageClass(language = "text") {
  return `file-lang-${normalizeFenceLanguage(language).replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "text"}`;
}

function renderWorkbenchChanges(chat = currentChat()) {
  const changes = collectChangeItems(chat);
  const activity = collectActivityItems(chat);
  const changesSignature = JSON.stringify(changes.map((item) => [item.type, item.path, item.ok, item.timestamp, item.summary, item.additions, item.deletions]));
  const activitySignature = JSON.stringify(activity.map((item) => [item.type, item.kind, item.ok, item.timestamp, item.path, item.imagePath, item.summary]));
  const added = changes.reduce((sum, item) => sum + Number(item.additions || 0), 0);
  const deleted = changes.reduce((sum, item) => sum + Number(item.deletions || 0), 0);

  elements.changeSummary.textContent = changes.length
    ? `${changes.length} arquivo${changes.length === 1 ? "" : "s"} +${added} -${deleted}`
    : "0 arquivos";
  elements.activitySummary.textContent = `${activity.length} aç${activity.length === 1 ? "ão" : "ões"}`;

  if (state.renderCache.changes !== changesSignature) {
    state.renderCache.changes = changesSignature;
    elements.changeFeed.innerHTML = changes.length
      ? changes
        .map((item) => `
            <div class="change-row">
              <span class="change-icon ${item.ok === false ? "is-failed" : ""}">${escapeHtml(item.ok === false ? "!" : "+")}</span>
              <div class="change-copy">
                <strong>${escapeHtml(item.name || item.path || item.type)}</strong>
                <span>${escapeHtml(shortText(item.path || item.summary || item.type, 110))}</span>
              </div>
              <span class="change-status ${item.ok === false ? "is-failed" : ""}">${escapeHtml(item.ok === false ? "falhou" : `+${item.additions || 0} -${item.deletions || 0}`)}</span>
            </div>
          `)
        .join("")
      : `<div class="workbench-empty"><strong>Nenhuma alteração ainda</strong><span>Arquivos criados, edits e scaffolds aparecem aqui quando o agente agir no workspace.</span></div>`;
  }

  if (state.renderCache.activity !== activitySignature) {
    state.renderCache.activity = activitySignature;
    elements.activityFeed.innerHTML = activity.length
      ? activity
        .map((item) => `
            <div class="activity-row activity-kind-${escapeHtml(item.kind || "tool")}">
              <span class="activity-dot ${item.ok === false ? "is-failed" : ""}">${escapeHtml(item.icon || "*")}</span>
              <div>
                <div class="activity-title-line">
                  <strong>${escapeHtml(item.label || item.type)}</strong>
                  <span>${escapeHtml(item.type)}</span>
                </div>
                <p>${escapeHtml(shortText(item.summary, 180))}</p>
                ${item.imagePath ? `<img class="activity-thumb" src="${escapeHtml(fileUrlFromPath(item.imagePath))}" alt="artifact" />` : ""}
              </div>
              <time>${escapeHtml(formatClock(item.timestamp))}</time>
            </div>
          `)
        .join("")
      : `<div class="workbench-empty"><strong>Sem atividade local</strong><span>A timeline de tools e verificações recentes fica nesta área.</span></div>`;
  }
}

function renderWorkbenchFiles(files = [], selectedPath = "") {
  if (!elements.filesSummary || !elements.filesSurface) {
    return;
  }
  const model = workbenchFileBrowserModel(files, state.workbenchFilesPath, currentChat());
  if (state.workbenchFilesPath && !model.folders.length && !model.files.length) {
    state.workbenchFilesPath = "";
    state.renderCache.files = "";
    renderWorkbenchFiles(files, selectedPath);
    return;
  }
  const totalFolders = countWorkbenchFolders(files, model.root);
  elements.filesSummary.textContent = `${files.length} arquivo${files.length === 1 ? "" : "s"}`;
  const signature = JSON.stringify(files.map((file) => [
    file.path,
    file.language,
    file.meta,
    file.ok,
    file.timestamp,
    String(file.content || "").length,
    file.pending
  ]).concat([["selected", selectedPath], ["path", model.currentPath], ["view", state.workbenchFilesView]]));
  if (state.renderCache.files === signature) {
    return;
  }
  state.renderCache.files = signature;
  const gridActive = state.workbenchFilesView !== "list";
  const folderMarkup = model.folders.map((folder) => `
    <button class="file-browser-item file-browser-folder" type="button" data-workbench-dir="${escapeHtml(folder.path)}" title="${escapeHtml(folder.path)}">
      <span class="file-browser-icon file-browser-folder-icon" aria-hidden="true"></span>
      <span class="file-browser-name">${escapeHtml(folder.name)}</span>
      <span class="file-browser-detail">${escapeHtml(`${folder.count} item${folder.count === 1 ? "" : "s"}`)}</span>
    </button>
  `).join("");
  const fileMarkup = model.files.map((file) => {
    const pathValue = String(file.path || "");
    const active = pathValue === selectedPath;
    const language = normalizeFenceLanguage(file.language || "text");
    return `
      <button class="file-browser-item file-browser-file ${active ? "is-active" : ""} ${fileBrowserLanguageClass(language)}" type="button" data-workbench-file="${escapeHtml(pathValue)}" title="${escapeHtml(pathValue)}">
        <span class="file-browser-icon file-browser-file-icon" aria-hidden="true"><span>${escapeHtml(shortText(language, 4).toUpperCase())}</span></span>
        <span class="file-browser-name">${escapeHtml(file.displayName || file.name || basenameForWorkbenchPath(pathValue))}</span>
        <span class="file-browser-detail">${escapeHtml(fileBrowserItemMeta(file))}</span>
      </button>
    `;
  }).join("");
  elements.filesSurface.innerHTML = files.length
    ? `
      <div class="file-browser-shell">
        <header class="file-browser-head">
          <div class="file-browser-title">
            <span class="file-browser-kicker">Workbench</span>
            <strong>${escapeHtml(model.currentPath ? basenameForWorkbenchPath(model.currentPath) : "Folders")}</strong>
          </div>
          <div class="file-browser-view-toggle" aria-label="Files view">
            <button type="button" class="file-browser-view-btn ${gridActive ? "" : "is-active"}" data-workbench-files-view="list" title="Lista" aria-label="Lista">
              <span class="file-view-icon file-view-icon-list" aria-hidden="true"></span>
            </button>
            <button type="button" class="file-browser-view-btn ${gridActive ? "is-active" : ""}" data-workbench-files-view="grid" title="Grid" aria-label="Grid">
              <span class="file-view-icon file-view-icon-grid" aria-hidden="true"></span>
            </button>
          </div>
        </header>
        <nav class="file-browser-breadcrumb" aria-label="Caminho dos arquivos">
          ${fileBrowserBreadcrumb(model.currentPath)}
        </nav>
        <div class="file-browser-stats">
          <span>${escapeHtml(`${model.folders.length} pasta${model.folders.length === 1 ? "" : "s"} nesta pasta`)}</span>
          <span>${escapeHtml(`${model.files.length} arquivo${model.files.length === 1 ? "" : "s"} nesta pasta`)}</span>
          <span>${escapeHtml(`${totalFolders} pasta${totalFolders === 1 ? "" : "s"} no total`)}</span>
        </div>
        <div class="file-browser-items ${gridActive ? "is-grid" : "is-list"}">
          ${folderMarkup || fileMarkup ? `${folderMarkup}${fileMarkup}` : `<div class="workbench-empty"><strong>Pasta vazia</strong><span>Volte pelo breadcrumb para ver outros arquivos do Workbench.</span></div>`}
        </div>
      </div>
    `
    : `<div class="workbench-empty"><strong>Nenhum arquivo ainda</strong><span>Arquivos criados, lidos ou editados pelo agente aparecem aqui.</span></div>`;
}

function patchExistingCodeEditorSurface(codePreview, displayValue = "", options = {}) {
  const card = elements.codeSurface?.querySelector(".code-editor");
  if (!codePreview || !card || card.dataset.codeKey !== state.codeEditor.key) {
    return false;
  }

  const input = card.querySelector(".code-input");
  const highlight = card.querySelector(".code-highlight");
  const gutter = card.querySelector(".code-gutter");
  if (!input || !highlight || !gutter) {
    return false;
  }

  const nextValue = String(displayValue || "");
  const hadFocus = document.activeElement === input;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  const scrollTop = input.scrollTop;
  const scrollLeft = input.scrollLeft;
  if (input.value !== nextValue && !state.codeEditor.dirty) {
    input.value = nextValue;
  }

  input.dataset.language = codePreview.language || "text";
  input.dataset.path = codePreview.path || "";
  const effectiveValue = input.value || "";
  highlight.className = `code-highlight language-${normalizeFenceLanguage(codePreview.language)}`;
  highlight.innerHTML = highlightCode(effectiveValue, codePreview.language);
  gutter.innerHTML = lineNumbersForCode(effectiveValue);

  const title = card.querySelector(".code-title-stack strong");
  const subtitle = card.querySelector(".code-title-stack span");
  const languagePill = card.querySelector(".code-language-pill");
  const dirtyBadge = card.querySelector("[data-code-dirty]");
  const saveButton = card.querySelector("[data-save-code]");
  if (title) {
    title.textContent = options.basename || codePreview.path || "";
  }
  if (subtitle) {
    subtitle.textContent = codePreview.path || "";
  }
  if (languagePill) {
    languagePill.textContent = languageLabel(codePreview.language);
  }
  if (dirtyBadge) {
    dirtyBadge.textContent = options.dirtyLabel || "";
  }
  if (saveButton) {
    saveButton.dataset.path = codePreview.path || "";
    saveButton.disabled = !options.canSave;
    saveButton.textContent = options.canSave ? "Salvar" : "Snippet";
  }

  input.scrollTop = scrollTop;
  input.scrollLeft = scrollLeft;
  if (hadFocus) {
    input.focus();
    try {
      input.setSelectionRange(selectionStart, selectionEnd);
    } catch {}
  }
  requestAnimationFrame(() => {
    syncCodeEditor();
    applyCodeShaderToEditor();
  });
  return true;
}

function renderWorkbenchPanel() {
  const chat = currentChat();
  if (state.selectedWorkbenchFileChatId !== (chat?.id || "")) {
    state.selectedWorkbenchFileChatId = chat?.id || "";
    state.selectedWorkbenchFilePath = "";
    state.workbenchFilesPath = "";
    state.renderCache.files = "";
  }
  const files = collectWorkbenchFiles(chat);
  if (state.selectedWorkbenchFilePath && !files.some((file) => file.path === state.selectedWorkbenchFilePath)) {
    state.selectedWorkbenchFilePath = "";
  }
  const baseTarget = previewTargetForChat(chat);
  const codePreview = buildCodePreview(chat, files);
  if (!state.selectedWorkbenchFilePath && codePreview?.path) {
    state.selectedWorkbenchFilePath = codePreview.path;
  }
  const codeFilePreviewTarget = codePreview?.path && codePreview.language === "html"
    ? {
        url: fileUrlFromPath(codePreview.path),
        title: codePreview.path.split(/[\\/]/).pop() || "Preview HTML",
        status: "arquivo",
        timestamp: codePreview.timestamp || 0,
        source: "code-file"
      }
    : null;
  const harnessTarget = previewHarnessBelongsToCurrentChat() && isWebUrl(state.previewHarness.url)
    ? {
        url: state.previewHarness.url,
        title: "Workbench browser",
        status: "live",
        timestamp: state.previewHarness.updatedAt || Date.now(),
        source: "preview-harness"
      }
    : null;
  const target = [harnessTarget, baseTarget, codeFilePreviewTarget]
    .filter(Boolean)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || null;
  const currentCodeKey = codeEditorKey(codePreview);
  if (codePreview && state.codeEditor.key !== currentCodeKey) {
    state.codeEditor = {
      key: currentCodeKey,
      value: String(codePreview.content || ""),
      dirty: false,
      savedAt: 0
    };
  } else if (codePreview && !state.codeEditor.dirty && state.codeEditor.value !== String(codePreview.content || "")) {
    state.codeEditor.value = String(codePreview.content || "");
  } else if (!codePreview && state.codeEditor.key) {
    state.codeEditor = {
      key: "",
      value: "",
      dirty: false,
      savedAt: 0
    };
    stopCodeTyping();
  }
  const changes = collectChangeItems(chat);
  const activity = collectActivityItems(chat);
  const terminals = state.app?.terminalSessions || [];
  const jobs = state.app?.backgroundProcesses || [];
  const codePreviewTimestamp = Number(codePreview?.timestamp || 0);
  const targetTimestamp = Number(target?.timestamp || 0);
  const preferInlinePreview = Boolean(codePreview?.inlinePreviewHtml) && (
    !target?.url ||
    !targetTimestamp ||
    codePreviewTimestamp >= targetTimestamp
  );
  const inlinePreviewHtml = preferInlinePreview ? codePreview.inlinePreviewHtml : "";
  const hasExternalPreview = Boolean(target?.url) && !preferInlinePreview;
  const hasImagePreview = Boolean(target?.kind === "image" && target?.imagePath) && !preferInlinePreview && !hasExternalPreview;
  const hasInlinePreview = Boolean(inlinePreviewHtml);
  const hasPreview = hasExternalPreview || hasInlinePreview || hasImagePreview;
  const mobilePreviewSupported = !hasImagePreview && canUseMobilePreview(target, inlinePreviewHtml);
  const effectivePreviewDeviceMode = mobilePreviewSupported ? state.previewDeviceMode : "desktop";
  const shouldUseMobilePreview = effectivePreviewDeviceMode === "mobile" && mobilePreviewSupported;
  const mobilePreviewPayload = shouldUseMobilePreview ? buildMobilePreviewPayload(target, inlinePreviewHtml) : null;
  if (shouldUseMobilePreview && !state.mobilePreview.service && !state.mobilePreview.loading) {
    ensureMobilePreviewService().catch(() => { });
  }
  const hasChanges = changes.length > 0 || activity.length > 0;
  const hasTerminal = terminals.length > 0 || jobs.length > 0;
  const hasFiles = files.length > 0;
  const isLiveCoding = Boolean(codePreview && (
    codePreview.pending ||
    String(chat?.status || "").toLowerCase() === "running"
  ));
  const validViews = new Set(["preview", "files", "code", "changes", "terminal"]);
  const defaultView = isLiveCoding && codePreview ? "code" : hasPreview ? "preview" : codePreview ? "code" : hasFiles ? "files" : hasTerminal ? "terminal" : hasChanges ? "changes" : "preview";
  if (isLiveCoding && state.workbenchView === "preview" && codePreview) {
    state.workbenchView = "code";
  } else if (!hasPreview && state.workbenchView === "preview" && codePreview) {
    state.workbenchView = "code";
  } else if (!isLiveCoding && hasInlinePreview && (state.workbenchView === "changes" || state.workbenchView === "terminal")) {
    state.workbenchView = "preview";
  } else if (!validViews.has(state.workbenchView)) {
    state.workbenchView = defaultView;
  } else if (!hasFiles && state.workbenchView === "files") {
    state.workbenchView = codePreview ? "code" : defaultView;
  } else if (!codePreview && state.workbenchView === "code") {
    state.workbenchView = hasPreview ? "preview" : defaultView;
  } else if (!hasPreview && !codePreview && state.workbenchView === "preview" && (hasChanges || hasTerminal)) {
    state.workbenchView = defaultView;
  }

  const signature = JSON.stringify([
    chat?.id || "none",
    state.previewHarness.ownerChatId || "",
    state.previewHarness.url || "",
    state.previewHarness.updatedAt || 0,
    target?.url || "",
    target?.imagePath || "",
    target?.status || "",
    state.selectedWorkbenchFilePath || "",
    files.map((item) => [item.path, item.language, item.meta, item.ok, item.timestamp, String(item.content || "").length, item.pending]),
    codePreview?.path || "",
    codePreview?.content || "",
    state.codeEditor.key,
    state.codeEditor.savedAt,
    inlinePreviewHtml,
    changes.map((item) => [item.type, item.path, item.ok, item.timestamp, item.additions, item.deletions]),
    activity.map((item) => [item.type, item.ok, item.timestamp, item.summary]),
    terminals.map((item) => [item.id, item.alive, item.updatedAt, item.currentCommand, item.stdoutTail, item.stderrTail]),
    jobs.map((item) => [item.id, item.status, item.updatedAt, item.stdoutTail, item.stderrTail]),
    state.workbenchView,
    state.previewDeviceMode,
    mobilePreviewPayload,
    state.mobilePreview.loading,
    state.mobilePreview.error,
    state.mobilePreview.service?.browserUrl || ""
  ]);
  if (state.renderCache.workbench === signature) {
    return;
  }

  state.renderCache.workbench = signature;
  if (state.appMode === "chat" && (hasPreview || codePreview || hasChanges || hasTerminal) && !state.panelOpen) {
    state.panelOpen = true;
    renderShell();
  }

  elements.previewDesktopButton?.classList.toggle("is-active", effectivePreviewDeviceMode === "desktop" || !mobilePreviewSupported);
  elements.previewMobileButton?.classList.toggle("is-active", shouldUseMobilePreview);
  elements.previewMobileButton.disabled = !mobilePreviewSupported;
  elements.workbenchState.textContent = shouldUseMobilePreview
    ? state.mobilePreview.loading
      ? "iniciando iPhone"
      : state.mobilePreview.error
        ? "mobile falhou"
        : "iPhone live"
    : hasExternalPreview
      ? target.status || "Preview"
      : hasImagePreview
        ? target.status || "imagem"
        : hasInlinePreview
          ? "snippet"
          : "Sem preview";
  elements.previewUrlLabel.textContent = hasExternalPreview
    ? target.url
    : hasImagePreview
      ? target.imagePath
      : hasInlinePreview
        ? "Preview inline do snippet HTML"
        : shouldUseMobilePreview
          ? "Safari iPhone ao vivo"
          : "Nenhum localhost detectado";
  elements.previewOpenButton.disabled = !hasExternalPreview;
  elements.previewRefreshButton.disabled = !(hasExternalPreview || hasInlinePreview || shouldUseMobilePreview);
  elements.previewOpenButton.dataset.previewUrl = hasExternalPreview ? target.url : "";
  elements.previewRefreshButton.dataset.previewUrl = hasExternalPreview ? target.url : "";
  elements.previewRefreshButton.dataset.previewMode = shouldUseMobilePreview
    ? "mobile"
    : hasExternalPreview
      ? "url"
      : hasInlinePreview
        ? "inline"
        : "";

  elements.workbenchPreviewTab?.classList.toggle("is-active", state.workbenchView === "preview");
  elements.workbenchFilesTab?.classList.toggle("is-active", state.workbenchView === "files");
  elements.workbenchCodeTab?.classList.toggle("is-active", state.workbenchView === "code");
  elements.workbenchChangesTab?.classList.toggle("is-active", state.workbenchView === "changes");
  elements.workbenchTerminalTab?.classList.toggle("is-active", state.workbenchView === "terminal");
  elements.workbenchPreviewTab.disabled = !hasPreview;
  elements.workbenchFilesTab.disabled = !hasFiles;
  elements.workbenchCodeTab.disabled = !codePreview;
  elements.workbenchChangesTab.disabled = false;
  elements.workbenchTerminalTab.disabled = false;
  elements.previewPanelSection.hidden = state.workbenchView !== "preview";
  elements.filesPanelSection.hidden = state.workbenchView !== "files";
  elements.codePanelSection.hidden = state.workbenchView !== "code";
  elements.changesPanelSection.hidden = state.workbenchView !== "changes";
  elements.terminalPanelSection.hidden = state.workbenchView !== "terminal";
  renderWorkbenchFiles(files, state.selectedWorkbenchFilePath);

  const isWorkbenchLivePreview = hasExternalPreview && target?.source === "preview-harness";
  const previewVersion = hasExternalPreview && !isWorkbenchLivePreview
    ? Number(target?.timestamp || codePreviewTimestamp || state.codeEditor.savedAt || 0)
    : 0;
  const externalPreviewSrc = hasExternalPreview
    ? isWorkbenchLivePreview
      ? target.url
      : previewUrlWithVersion(target.url, previewVersion)
    : "";
  const previewCacheKey = shouldUseMobilePreview
    ? state.mobilePreview.loading
      ? "mobile:loading"
      : state.mobilePreview.error
        ? `mobile:error:${state.mobilePreview.error}`
        : `mobile:${state.mobilePreview.service?.browserUrl || ""}`
    : hasExternalPreview
      ? `url:${target.url}:${isWorkbenchLivePreview ? "live" : previewVersion}`
      : hasImagePreview
        ? `image:${target.imagePath}`
        : hasInlinePreview
          ? `inline:${inlinePreviewHtml}`
          : "";
  if (state.renderCache.previewSrc !== previewCacheKey) {
    state.renderCache.previewSrc = previewCacheKey;
    elements.previewSurface.innerHTML = shouldUseMobilePreview
      ? state.mobilePreview.loading
        ? `<div class="preview-empty"><strong>Iniciando painel iPhone</strong><span>Subindo o Safari mobile local para este Workbench.</span></div>`
        : state.mobilePreview.error
          ? `<div class="preview-empty"><strong>Falha no preview mobile</strong><span>${escapeHtml(shortText(state.mobilePreview.error, 320))}</span></div>`
          : `<iframe class="preview-frame preview-frame-mobile" data-mobile-preview-frame src="${escapeHtml(state.mobilePreview.service?.browserUrl || "")}" title="Preview mobile iPhone"></iframe>`
      : hasExternalPreview
        ? `<webview class="preview-frame preview-webview" data-preview-version="${escapeHtml(previewVersion)}" data-preview-harness-owner-chat-id="${escapeHtml(state.previewHarness.ownerChatId || currentChatId())}" src="${escapeHtml(externalPreviewSrc)}" title="${escapeHtml(target.title || "Preview local")}" allowpopups autosize="on" minwidth="320" minheight="320" style="width:100%;height:100%;"></webview>`
        : hasImagePreview
          ? `<div class="preview-image-wrap"><img class="preview-image" src="${escapeHtml(fileUrlFromPath(target.imagePath))}" alt="${escapeHtml(target.title || "Screenshot")}"></div>`
          : hasInlinePreview
            ? `<iframe class="preview-frame" srcdoc="${escapeHtml(inlinePreviewHtml)}" title="Preview inline do snippet"></iframe>`
            : `<div class="preview-empty"><strong>Preview aparece aqui</strong><span>Quando houver localhost ativo ou snippet HTML na resposta, ele aparece neste painel.</span></div>`;
  }
  const previewWebview = activePreviewWebview();
  if (previewWebview) {
    bindPreviewWebviewTelemetry(previewWebview);
  }

  if (shouldUseMobilePreview && mobilePreviewPayload && state.mobilePreview.service?.origin) {
    const payloadSignature = JSON.stringify(mobilePreviewPayload);
    if (state.renderCache.mobilePreviewPayload !== payloadSignature) {
      state.renderCache.mobilePreviewPayload = payloadSignature;
    }
    const frame = elements.previewSurface.querySelector("[data-mobile-preview-frame]");
    syncMobilePreviewFrame(frame, mobilePreviewPayload, state.mobilePreview.service);
  } else {
    state.renderCache.mobilePreviewPayload = "";
  }

  elements.codeFileLabel.textContent = codePreview?.path
    ? shortText(codePreview.path.split(/[\\/]/).pop(), 30)
    : "sem código";
  if (codePreview) {
    const editableValue = state.codeEditor.value;
    const displayValue = codeTypingDisplayValue(codePreview, editableValue, chat);
    const isTypingCode = displayValue !== editableValue && !state.codeEditor.dirty;
    const canSave = canPersistCodePreview(codePreview);
    const basename = codePreview.path.split(/[\\/]/).pop();
    const dirtyLabel = state.codeEditor.dirty ? "editado" : isTypingCode ? "gerando" : codePreview.meta || codePreview.source || "arquivo";
    if (!patchExistingCodeEditorSurface(codePreview, displayValue, { basename, dirtyLabel, canSave })) {
      elements.codeSurface.innerHTML = `
        <div class="code-card code-editor" data-code-key="${escapeHtml(state.codeEditor.key)}">
          <div class="code-card-head code-toolbar">
            <div class="code-title-stack">
              <strong>${escapeHtml(basename || codePreview.path)}</strong>
              <span>${escapeHtml(codePreview.path)}</span>
            </div>
            <div class="code-editor-actions">
              <span class="code-language-pill">${escapeHtml(languageLabel(codePreview.language))}</span>
              <span class="nano-badge code-dirty-badge" data-code-dirty>${escapeHtml(dirtyLabel)}</span>
              <button class="ghost-btn code-tool-btn" type="button" data-copy-code>Copiar</button>
              <button class="ghost-btn code-tool-btn" type="button" data-save-code data-path="${escapeHtml(codePreview.path)}" ${canSave ? "" : "disabled"}>${canSave ? "Salvar" : "Snippet"}</button>
            </div>
          </div>
          <div class="code-editor-shell">
              <pre class="code-gutter" aria-hidden="true">${lineNumbersForCode(displayValue)}</pre>
            <div class="code-editor-stack">
              <canvas class="code-shader-canvas" data-code-shader aria-hidden="true"></canvas>
              <div class="code-caret-trail" aria-hidden="true"></div>
              <div class="code-caret-ripple" aria-hidden="true"></div>
              <pre class="code-highlight language-${escapeHtml(codePreview.language)}" aria-hidden="true">${highlightCode(displayValue, codePreview.language)}</pre>
              <textarea class="code-input" tabindex="0" spellcheck="false" autocomplete="off" autocapitalize="off" data-language="${escapeHtml(codePreview.language)}" data-path="${escapeHtml(codePreview.path)}" aria-label="Editor de código">${escapeHtml(displayValue)}</textarea>
            </div>
          </div>
        </div>
      `;
      requestAnimationFrame(() => {
        syncCodeEditor();
        applyCodeShaderToEditor();
      });
    }
  } else {
    stopCodeTyping();
    stopCodeShader();
    elements.codeSurface.innerHTML = `<div class="code-empty">Quando a resposta trouxer código ou o agente editar arquivos, o conteúdo aparece aqui.</div>`;
  }
  renderWorkbenchChanges(chat);
}

function renderRouteFeed() {
  const chat = currentChat();
  const route = chat?.activeRoute || null;
  const routingCatalog = state.app?.routingCatalog || "";
  const signature = JSON.stringify([chat?.id || "none", route?.id || "", route?.label || "", routingCatalog]);
  if (state.renderCache.route === signature) {
    return;
  }

  state.renderCache.route = signature;
  if (!route) {
    elements.routeFeed.innerHTML = `<p class="panel-copy">A rota sera definida quando voce enviar a proxima tarefa.</p>`;
    return;
  }

  elements.routeFeed.innerHTML = `
    <div class="stack-card">
      <strong>${escapeHtml(route.label || route.id || "General")}</strong>
      <p class="panel-copy">${escapeHtml(chat?.workspaceRoot || "-")}</p>
      <p class="panel-copy">${escapeHtml(route.id || "general-purpose")}</p>
      <pre class="stack-pre">${escapeHtml(routingCatalog)}</pre>
    </div>
  `;
}

function renderLspFeed() {
  const lspState = state.app?.lspState || { available: false, engine: "none", projects: [], lastError: null };
  const chat = currentChat();
  const signature = JSON.stringify([chat?.id || "none", chat?.workspaceRoot || "", lspState]);
  if (state.renderCache.lsp === signature) {
    return;
  }

  state.renderCache.lsp = signature;
  const projects = Array.isArray(lspState.projects) ? lspState.projects : [];
  elements.lspFeed.innerHTML = `
    <div class="stack-card">
      <div class="stack-head">
        <strong>${escapeHtml(lspState.available ? lspState.engine || "language-engine" : "indisponivel")}</strong>
        <span class="action-pill">${escapeHtml(lspState.available ? "ativo" : "off")}</span>
      </div>
      <p class="panel-copy">${escapeHtml(chat?.workspaceRoot || "-")}</p>
      ${projects.length
      ? projects
        .map(
          (project) => `
                <div class="stack-subsection">
                  <p class="panel-copy">${escapeHtml(project.root || "-")}</p>
                  <p class="panel-copy">${escapeHtml(project.configPath || "sem tsconfig/jsconfig")} :: ${escapeHtml(String(project.fileCount || 0))} arquivos</p>
                </div>
              `
        )
        .join("")
      : `<p class="panel-copy">Sem projeto JS/TS carregado para este workspace.</p>`}
      ${Array.isArray(lspState.externalServers) && lspState.externalServers.length
      ? `<div class="stack-subsection">
              <strong>servidores externos</strong>
              <pre class="stack-pre">${escapeHtml(
        lspState.externalServers
          .map((server) => `- ${server.id}: ${server.available ? `${server.candidate || server.command}` : "indisponivel"} [${(server.extensions || []).join(", ")}]`)
          .join("\n")
      )}</pre>
            </div>`
      : ""
    }
      ${Array.isArray(lspState.activeClients) && lspState.activeClients.length
      ? `<div class="stack-subsection">
              <strong>clientes ativos</strong>
              <pre class="stack-pre">${escapeHtml(
        lspState.activeClients
          .map((client) => `- ${client.id}: ${client.initialized ? "ready" : "starting"} :: ${client.executablePath}`)
          .join("\n")
      )}</pre>
            </div>`
      : ""
    }
      ${lspState.lastError ? `<pre class="stack-pre stack-pre-warn">${escapeHtml(lspState.lastError)}</pre>` : ""}
    </div>
  `;
}

function renderProjectFeed() {
  const projects = state.app?.projects || [];
  const signature = JSON.stringify(projects.map((project) => [
    project.id,
    project.status,
    project.path,
    project.url,
    project.port,
    project.job,
    project.chatId,
    project.lastObjective,
    project.lastVerifiedAt,
    project.lastError
  ]));
  if (state.renderCache.projects === signature) {
    return;
  }

  state.renderCache.projects = signature;
  elements.projectFeed.innerHTML = projects.length
    ? projects
      .slice(0, 6)
      .map((project) => {
        const statusClass = project.status === "verified" ? "ok-pill" : project.status === "blocked" ? "warn-pill" : "";
        return `
            <div class="stack-card">
              <div class="stack-head">
                <strong>${escapeHtml(project.name || project.slug || "Projeto")}</strong>
                <span class="action-pill ${statusClass}">${escapeHtml(project.status || "created")}</span>
              </div>
              <p class="panel-copy">${escapeHtml(project.path || "-")}</p>
              ${project.url ? `<p class="panel-copy">${escapeHtml(project.url)}</p>` : ""}
              ${project.lastObjective ? `<p class="panel-copy">objetivo: ${escapeHtml(shortText(project.lastObjective, 180))}</p>` : ""}
              ${project.chatId ? `<p class="panel-copy">chat: ${escapeHtml(project.chatId)}</p>` : ""}
              <div class="mini-actions">
                ${project.path ? `<button class="toolbar-button" type="button" data-project-path="${escapeHtml(project.path)}">Abrir projeto</button>` : ""}
                ${project.url ? `<button class="toolbar-button" type="button" data-project-url="${escapeHtml(project.url)}">Abrir URL</button>` : ""}
              </div>
              ${project.lastVerifiedAt ? `<p class="panel-copy">verificado: ${escapeHtml(formatClock(project.lastVerifiedAt))}</p>` : ""}
              ${project.lastError ? `<pre class="stack-pre stack-pre-warn">${escapeHtml(shortText(project.lastError, 900))}</pre>` : ""}
            </div>
          `;
      })
      .join("")
    : `<p class="panel-copy">Nenhum projeto local registrado ainda.</p>`;
}

function renderTodoFeed() {
  const todos = state.app?.todos || [];
  const signature = JSON.stringify(todos.map((todo) => [todo.id, todo.status, todo.priority, todo.text, todo.updatedAt]));
  if (state.renderCache.todos === signature) {
    return;
  }

  state.renderCache.todos = signature;
  elements.todoFeed.innerHTML = todos.length
    ? todos
      .slice(0, 8)
      .map((todo) => `
          <div class="stack-card">
            <div class="stack-head"><strong>${escapeHtml(todo.text)}</strong><span class="action-pill">${escapeHtml(todo.status)}</span></div>
            <p class="panel-copy">prioridade: ${escapeHtml(todo.priority)}</p>
          </div>
        `)
      .join("")
    : `<p class="panel-copy">Nenhum todo persistente.</p>`;
}

function renderTaskFeed() {
  const tasks = state.app?.tasks || [];
  const signature = JSON.stringify(tasks.map((task) => [task.id, task.status, task.title, task.updatedAt, task.result, task.worktreeBranch, task.worktreePath]));
  if (state.renderCache.tasks === signature) {
    return;
  }

  state.renderCache.tasks = signature;
  elements.taskFeed.innerHTML = tasks.length
    ? tasks
      .slice(0, 8)
      .map((task) => `
          <div class="stack-card">
            <div class="stack-head"><strong>${escapeHtml(task.title)}</strong><span class="action-pill">${escapeHtml(task.status)}</span></div>
            <p class="panel-copy">${escapeHtml(shortText(task.objective || "", 180))}</p>
            ${task.worktreeBranch ? `<p class="panel-copy">branch: ${escapeHtml(task.worktreeBranch)}</p>` : ""}
            ${task.worktreePath ? `<p class="panel-copy">worktree: ${escapeHtml(task.worktreePath)}</p>` : task.workspaceRoot ? `<p class="panel-copy">workspace: ${escapeHtml(task.workspaceRoot)}</p>` : ""}
            ${task.result ? `<pre class="stack-pre">${escapeHtml(shortText(task.result, 900))}</pre>` : ""}
          </div>
        `)
      .join("")
    : `<p class="panel-copy">Nenhuma tarefa persistente.</p>`;
}

function renderAgentFeed() {
  const agents = state.app?.agents || [];
  const signature = JSON.stringify(agents.map((agent) => [agent.id, agent.status, agent.name, agent.updatedAt, agent.summary, agent.worktreePath, agent.worktreeBranch]));
  if (state.renderCache.agents === signature) {
    return;
  }

  state.renderCache.agents = signature;
  elements.agentFeed.innerHTML = agents.length
    ? agents
      .slice(0, 8)
      .map((agent) => `
          <div class="stack-card">
            <div class="stack-head"><strong>${escapeHtml(agent.name)}</strong><span class="action-pill">${escapeHtml(agent.status)}</span></div>
            <p class="panel-copy">${escapeHtml(shortText(agent.objective || "", 180))}</p>
            ${agent.worktreeBranch ? `<p class="panel-copy">branch: ${escapeHtml(agent.worktreeBranch)}</p>` : ""}
            ${agent.worktreePath ? `<p class="panel-copy">worktree: ${escapeHtml(agent.worktreePath)}</p>` : agent.workspaceRoot ? `<p class="panel-copy">workspace: ${escapeHtml(agent.workspaceRoot)}</p>` : ""}
            ${agent.summary ? `<pre class="stack-pre">${escapeHtml(shortText(agent.summary, 900))}</pre>` : ""}
          </div>
        `)
      .join("")
    : `<p class="panel-copy">Nenhum subagente ativo ainda.</p>`;
}

function renderTerminalFeed() {
  const sessions = state.app?.terminalSessions || [];
  const signature = JSON.stringify(sessions.map((item) => [item.id, item.alive, item.promptState, item.transport, item.pid, item.updatedAt, item.currentCommand, item.currentCommandStartedAt, item.currentCommandTimeoutMs, item.currentCommandStallAfterMs, item.outputIdleMs, item.lastExitCode, item.stopReason, item.killResult, item.stdoutTail, item.stderrTail, item.history]));
  if (state.renderCache.terminals === signature) {
    return;
  }

  state.renderCache.terminals = signature;
  elements.terminalFeed.innerHTML = sessions.length
    ? sessions
      .slice(0, 4)
      .map((session) => `
          <div class="stack-card">
            <div class="stack-head">
              <strong>${escapeHtml(session.id)}</strong>
              <div class="stack-actions">
                <span class="action-pill">${escapeHtml(`${session.shell} ${session.promptState || (session.alive ? "idle" : "closed")}`)}</span>
                ${session.alive ? `<button class="toolbar-button danger-button mini-stop-button" type="button" data-close-terminal="${escapeHtml(session.id)}">Fechar</button>` : ""}
              </div>
            </div>
            <p class="panel-copy">${escapeHtml(session.cwd || "")}</p>
            <p class="panel-copy">${escapeHtml(`modo: ${session.transport || "spawn"}${session.pid ? ` · pid ${session.pid}` : ""}`)}</p>
            <p class="panel-copy">${escapeHtml(`estado: ${session.promptState || "desconhecido"} · sem saida ha ${formatDurationMs(session.outputIdleMs)}`)}</p>
            ${session.ptyFallbackReason ? `<p class="panel-copy">${escapeHtml(session.ptyFallbackReason)}</p>` : ""}
            ${session.currentCommand ? `<p class="panel-copy">rodando: ${escapeHtml(session.currentCommand)}</p>` : ""}
            ${session.currentCommandStartedAt ? `<p class="panel-copy">desde: ${escapeHtml(formatClock(session.currentCommandStartedAt))}</p>` : ""}
            ${session.currentCommandTimeoutMs
          ? `<p class="panel-copy">timeout: ${escapeHtml(formatDurationMs(session.currentCommandTimeoutMs))} · stall: ${escapeHtml(formatDurationMs(session.currentCommandStallAfterMs))}</p>`
          : ""
        }
            ${session.stallReason ? `<p class="panel-copy">travado: ${escapeHtml(session.stallReason)}</p>` : ""}
            ${session.lastExitCode !== null && session.lastExitCode !== undefined ? `<p class="panel-copy">ultimo exit code: ${escapeHtml(String(session.lastExitCode))}</p>` : ""}
            ${session.stopReason ? `<p class="panel-copy">parado por: ${escapeHtml(session.stopReason)}${session.stoppedAt ? ` em ${escapeHtml(formatClock(session.stoppedAt))}` : ""}</p>` : ""}
            ${session.killResult ? `<p class="panel-copy">kill tree: ${escapeHtml(session.killResult.ok ? "ok" : "falhou/nao necessario")} ${escapeHtml(session.killResult.method || "")}</p>` : ""}
            <div class="stack-subsection">
              <strong>stdout</strong>
              <pre class="stack-pre">${escapeHtml(shortText(session.stdoutTail || "(sem stdout ainda)", 2200))}</pre>
            </div>
            <div class="stack-subsection">
              <strong>stderr</strong>
              <pre class="stack-pre ${session.stderrTail ? "stack-pre-warn" : ""}">${escapeHtml(shortText(session.stderrTail || "(sem stderr)", 1400))}</pre>
            </div>
            ${Array.isArray(session.history) && session.history.length
          ? `<div class="stack-subsection">
                    <strong>historico</strong>
                    <pre class="stack-pre">${escapeHtml(
            session.history
              .map((entry) => `[${formatClock(entry.at)}] (${entry.code ?? "erro"}) ${entry.durationMs ? `${formatDurationMs(entry.durationMs)} ` : ""}${entry.command}\n${entry.stdout || entry.stderr || "(sem saida)"}`)
              .join("\n\n")
          )}</pre>
                  </div>`
          : ""
        }
          </div>
        `)
      .join("")
    : `<p class="panel-copy">Nenhuma sessao de terminal persistente ainda.</p>`;
}

function renderBackgroundFeed() {
  const jobs = state.app?.backgroundProcesses || [];
  const signature = JSON.stringify(jobs.map((item) => [item.id, item.status, item.readiness, item.pid, item.updatedAt, item.exitCode, item.runtimeMs, item.outputIdleMs, item.stopReason, item.killResult, item.stdoutTail, item.stderrTail]));
  if (state.renderCache.background === signature) {
    return;
  }

  state.renderCache.background = signature;
  elements.backgroundFeed.innerHTML = jobs.length
    ? jobs
      .slice(0, 6)
      .map((job) => `
          <div class="stack-card">
            <div class="stack-head">
              <strong>${escapeHtml(job.id)}</strong>
              <div class="stack-actions">
                <span class="action-pill">${escapeHtml(job.readiness || job.status)}</span>
                ${job.status === "running" ? `<button class="toolbar-button danger-button mini-stop-button" type="button" data-stop-job="${escapeHtml(job.id)}">Parar</button>` : ""}
              </div>
            </div>
            <p class="panel-copy">${escapeHtml(job.command)} ${escapeHtml((job.args || []).join(" "))}</p>
            <p class="panel-copy">${escapeHtml(job.cwd || "")}</p>
            <p class="panel-copy">${escapeHtml(`${job.pid ? `pid ${job.pid}` : "pid ?"}`)}${job.exitCode !== null && job.exitCode !== undefined ? ` · exit ${escapeHtml(String(job.exitCode))}` : ""}</p>
            <p class="panel-copy">${escapeHtml(`runtime: ${formatDurationMs(job.runtimeMs)} · sem saida ha ${formatDurationMs(job.outputIdleMs)}`)}</p>
            ${job.stopReason ? `<p class="panel-copy">parado por: ${escapeHtml(job.stopReason)}${job.stoppedAt ? ` em ${escapeHtml(formatClock(job.stoppedAt))}` : ""}</p>` : ""}
            ${job.killResult ? `<p class="panel-copy">kill tree: ${escapeHtml(job.killResult.ok ? "ok" : "falhou/nao necessario")} ${escapeHtml(job.killResult.method || "")}</p>` : ""}
            <pre class="stack-pre">${escapeHtml(shortText(job.stdoutTail || job.stderrTail || "(sem logs ainda)", 1200))}</pre>
          </div>
        `)
      .join("")
    : `<p class="panel-copy">Nenhum processo em background ativo.</p>`;
}

function renderMcpFeed() {
  const mcpState = state.app?.mcpState || { configured: [], connected: [] };
  const signature = JSON.stringify(mcpState);
  if (state.renderCache.mcp === signature) {
    return;
  }

  state.renderCache.mcp = signature;
  const configured = Array.isArray(mcpState.configured) ? mcpState.configured : [];
  const connected = Array.isArray(mcpState.connected) ? mcpState.connected : [];
  elements.mcpFeed.innerHTML = `
    <div class="stack-card">
      <strong>Configurados</strong>
      <pre class="stack-pre">${escapeHtml(configured.length ? configured.map((server) => `${server.name}: ${server.command} ${(server.args || []).join(" ")}`.trim()).join("\n") : "(nenhum)")}</pre>
      <strong>Conectados</strong>
      <pre class="stack-pre">${escapeHtml(connected.length ? connected.map((server) => `${server.name}: ${(server.tools || []).join(", ") || "sem tools"}`).join("\n") : "(nenhum)")}</pre>
    </div>
  `;
}

function renderComposerAttachments() {
  const signature = JSON.stringify(state.attachments.map((item) => [item.id, item.path, item.filename]));
  if (state.renderCache.attachments === signature) {
    return;
  }

  state.renderCache.attachments = signature;
  elements.attachmentList.hidden = !state.attachments.length;
  elements.attachmentList.innerHTML = state.attachments
    .map((attachment) => `<span class="attachment-chip"><span>${escapeHtml(attachment.filename)}</span><button type="button" data-remove-attachment="${escapeHtml(attachment.id)}">x</button></span>`)
    .join("");
}

function renderLocalModels() {
  if (!elements.localModelsList) {
    return;
  }
  const html = state.localModels.map((model) => `<option value="${escapeHtml(model.id)}"></option>`).join("");
  if (state.renderCache.models !== html) {
    state.renderCache.models = html;
    elements.localModelsList.innerHTML = html;
  }
}

function renderSupportedApps() {
  const apps = state.app?.supportedApps || [];
  const html = apps.map((app) => `<span class="action-pill">${escapeHtml(app.key)}</span>`).join("");
  if (state.renderCache.supportedApps !== html) {
    state.renderCache.supportedApps = html;
    if (elements.supportedAppsList) {
      elements.supportedAppsList.innerHTML = html;
    }
    if (elements.settingsSupportedAppsList) {
      elements.settingsSupportedAppsList.innerHTML = html;
    }
  }
}

function renderHermesCatalog() {
  const catalog = state.app?.hermesCatalog || {};
  const counts = catalog.counts || {};
  const skills = Array.isArray(catalog.skills) ? catalog.skills : [];
  const gateways = Array.isArray(catalog.gateways) ? catalog.gateways : [];
  const skillsHtml = [
    `<span class="action-pill">commands: ${escapeHtml(counts.commands || 0)}</span>`,
    `<span class="action-pill">providers: ${escapeHtml(counts.providers || 0)}</span>`,
    `<span class="action-pill">skills: ${escapeHtml(counts.skills || skills.length)}</span>`,
    ...skills.slice(0, 18).map((skill) =>
      `<span class="action-pill" title="${escapeHtml(skill.description || "")}">${escapeHtml(skill.name || skill.label)}</span>`
    )
  ].join("");
  const gatewaysHtml = gateways.length
    ? gateways.slice(0, 28).map((gateway) => {
        const env = Array.isArray(gateway.env) && gateway.env.length ? ` env: ${gateway.env.join(", ")}` : "";
        return `<span class="action-pill" title="${escapeHtml(env)}">${escapeHtml(gateway.label || gateway.id)}</span>`;
      }).join("")
    : `<span class="note">Nenhum gateway Hermes detectado.</span>`;
  const html = `${skillsHtml}|${gatewaysHtml}`;
  if (state.renderCache.hermesCatalog !== html) {
    state.renderCache.hermesCatalog = html;
    if (elements.hermesSkillSummary) {
      elements.hermesSkillSummary.innerHTML = skillsHtml;
    }
    if (elements.hermesGatewayList) {
      elements.hermesGatewayList.innerHTML = gatewaysHtml;
    }
  }
}

function renderAppSurface() {
  state.appMode = normalizeAppMode(state.appMode);
  setAperantProvider(state.aperantProvider || activeProvider());
  const mode = state.appMode;
  const isHome = mode === "home";
  const isChat = mode === "chat";
  const isKanban = mode === "kanban";
  const isTerminals = mode === "terminals";
  const isAperantMode = APERANT_APP_MODES.includes(mode);
  const isUtilityMode = isAperantMode && !isKanban && !isTerminals;
  if (!isChat && state.panelOpen) {
    state.panelOpen = false;
    renderShell();
  }
  const modeButtons = [
    [elements.appModeChatButton, "chat"],
    [elements.appModeKanbanButton, "kanban"],
    [elements.appModeTerminalsButton, "terminals"]
  ];

  for (const [button, buttonMode] of modeButtons) {
    if (!button) continue;
    const active = mode === buttonMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  elements.appShell?.classList.toggle("aperant-mode", isAperantMode);
  elements.appShell?.classList.toggle("aperant-kanban-mode", isKanban);
  elements.appShell?.classList.toggle("aperant-terminal-mode", isTerminals);
  elements.appShell?.classList.toggle("aperant-utility-mode", isUtilityMode);
  elements.appShell?.classList.toggle("home-mode", isHome);
  document.body.classList.toggle("home-mode", isHome);
  if (elements.homeScreen) {
    elements.homeScreen.hidden = false;
    elements.homeScreen.classList.toggle("is-visible", isHome);
  }
  if (isHome) {
    startHomeDashboard();
  } else {
    stopHomeDashboard();
  }
  renderAperantSidebar();

  if (!isChat) {
    elements.heroState.hidden = true;
    elements.transcript.hidden = true;
  }
  if (elements.composer) elements.composer.hidden = !isChat;
  if (elements.kanbanBoard) elements.kanbanBoard.hidden = !isKanban;
  if (elements.multiAgentDeck) elements.multiAgentDeck.hidden = !isTerminals;
  if (elements.aperantUtilityView) elements.aperantUtilityView.hidden = !isUtilityMode;

  if (isHome) {
    return;
  }

  if (isKanban) {
    elements.threadEyebrow.textContent = "Aperant Kanban";
    elements.chatTitle.textContent = "Kanban Hermes";
    elements.chatSubtitle.textContent = "Planeje, mova e dispare agentes sem sair da base Dream/Hermes.";
    renderKanbanBoard();
  } else if (isTerminals) {
    elements.threadEyebrow.textContent = "Aperant Multiagente";
    elements.chatTitle.textContent = "Agent Terminals";
    elements.chatSubtitle.textContent = "Execucao paralela com terminal_exec, agent_spawn e worktrees pelo Hermes.";
    renderMultiAgentDeck();
  } else if (isUtilityMode) {
    const meta = aperantUtilityMeta(mode);
    elements.threadEyebrow.textContent = meta.eyebrow;
    elements.chatTitle.textContent = meta.title;
    elements.chatSubtitle.textContent = meta.subtitle;
    renderAperantUtilityView();
  }
}

function aperantUtilityMeta(mode = state.appMode) {
  const map = {
    insights: {
      eyebrow: "Aperant Insights",
      title: "Insights",
      subtitle: "Resumo operacional das tasks, agentes, reviews e bloqueios.",
      action: "Generate insight"
    },
    roadmap: {
      eyebrow: "Aperant Roadmap",
      title: "Roadmap",
      subtitle: "Transforma o estado atual do projeto em proximos passos executaveis.",
      action: "Generate roadmap"
    },
    ideation: {
      eyebrow: "Aperant Ideation",
      title: "Ideation",
      subtitle: "Converte ideias soltas em cards e subagentes usando Hermes.",
      action: "Run ideation"
    },
    changelog: {
      eyebrow: "Aperant Changelog",
      title: "Changelog",
      subtitle: "Linha do tempo das alteracoes concluidas e prontas para review.",
      action: "Draft changelog"
    },
    context: {
      eyebrow: "Aperant Context",
      title: "Context",
      subtitle: "Contexto do workspace, provider e regras que todos os agentes recebem.",
      action: "Refresh context"
    },
    github: {
      eyebrow: "Aperant GitHub Issues",
      title: "GitHub Issues",
      subtitle: "Cria triagem e correcoes via Hermes, respeitando git/worktree quando ligado.",
      action: "Sync issues"
    },
    worktrees: {
      eyebrow: "Aperant Worktrees",
      title: "Worktrees",
      subtitle: "Mostra worktrees vinculados as tasks e fluxos de cleanup/PR.",
      action: "Audit worktrees"
    }
  };
  return map[mode] || map.insights;
}

function aperantTaskStatusCounts(tasks = state.app?.tasks || []) {
  return tasks.reduce((counts, task) => {
    const status = visualTaskStatus(task.status);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { planning: 0, in_progress: 0, ai_review: 0, human_review: 0, done: 0, archived: 0 });
}

function aperantMetric(label, value, detail = "") {
  return `
    <article class="aperant-metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

function aperantMiniTaskList(tasks, emptyText = "No tasks here.", limit = 5) {
  const visible = tasks.slice(0, limit);
  if (!visible.length) {
    return `<div class="kanban-empty aperant-utility-empty"><span class="kanban-empty-icon">+</span><strong>${escapeHtml(emptyText)}</strong></div>`;
  }
  return visible.map((task) => `
    <article class="aperant-mini-card">
      <div>
        <strong>${escapeHtml(task.title || "Untitled task")}</strong>
        <p>${escapeHtml(shortText(task.objective || task.result || "No objective registered.", 150))}</p>
      </div>
      <span class="kanban-status kanban-status-${escapeHtml(visualTaskStatus(task.status))}">${escapeHtml(statusLabel(task.status))}</span>
      <small>${escapeHtml(formatRelativeTime(task.updatedAt || task.createdAt))}</small>
    </article>
  `).join("");
}

function aperantUtilityObjective(mode, extra = "") {
  const tasks = state.app?.tasks || [];
  const counts = aperantTaskStatusCounts(tasks);
  const chat = currentChat();
  const project = projectForChat(chat) || (state.app?.projects || [])[0] || null;
  const root = chat?.workspaceRoot || project?.path || project?.root || project?.workspaceRoot || "C:\\Users\\Gabriel\\Documents\\Playground\\dream-server-hermes";
  const taskDigest = tasks.slice(0, 12).map((task) =>
    `- ${task.title || task.id}: ${statusLabel(task.status)} - ${shortText(task.objective || task.result || "", 140)}`
  ).join("\n") || "- No tasks yet.";
  const modePrompts = {
    insights: "Analyze current Kanban execution, agent health, stalled work, review load, and concrete next actions.",
    roadmap: "Create a practical roadmap from the current Kanban state. Convert vague items into ordered implementation cards.",
    ideation: "Turn the user's idea into concrete Dream-Hermes tasks with acceptance criteria and implementation order.",
    changelog: "Draft a changelog from completed work, PR-ready work, and recent task logs. Keep it concise and actionable.",
    context: "Audit project context for Hermes agents: workspace, provider, routes, constraints, risks, and missing configuration.",
    github: "Inspect or prepare GitHub issue triage for this workspace. If GitHub is not configured, produce setup steps and issue templates.",
    worktrees: "Audit task worktrees, branches, cleanup state, and PR readiness. Recommend safe cleanup or PR actions."
  };
  return [
    "Use only the Dream/Hermes runtime and the existing project base.",
    `Workspace: ${root}`,
    `Provider: ${selectedAperantProvider()}`,
    `Kanban counts: planning ${counts.planning}, in_progress ${counts.in_progress}, ai_review ${counts.ai_review}, human_review ${counts.human_review}, done ${counts.done}.`,
    modePrompts[mode] || modePrompts.insights,
    extra ? `User input: ${extra}` : "",
    "Current task digest:",
    taskDigest,
    "Update/create Kanban tasks through Hermes tools when useful. Do not bypass Hermes."
  ].filter(Boolean).join("\n");
}

async function runAperantUtilityTask(mode, extra = "") {
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  const provider = selectedAperantProvider();
  if (!ensureAperantProviderReady(provider)) {
    return null;
  }
  const meta = aperantUtilityMeta(mode);
  return await runHermesDirectAction({
    type: "agent_spawn",
    name: meta.title,
    objective: aperantUtilityObjective(mode, extra),
    routeId: mode === "github" || mode === "worktrees" ? "bugfix" : "research",
    provider,
    useGit: kanbanGitEnabled(),
    useWorktree: kanbanGitEnabled(),
    orchestrate: Boolean(state.app?.settings?.kanbanMultiAgentOrchestrationEnabled)
  }, {
    successMessage: `${meta.title} enviado ao Hermes.`
  });
}

function renderAperantUtilityView() {
  if (!elements.aperantUtilityView) return;
  const mode = state.appMode;
  const meta = aperantUtilityMeta(mode);
  const tasks = [...(state.app?.tasks || [])].sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0));
  const agents = state.app?.agents || [];
  const sessions = state.app?.terminalSessions || [];
  const counts = aperantTaskStatusCounts(tasks);
  const settings = state.app?.settings || {};
  const chat = currentChat();
  const project = projectForChat(chat) || (state.app?.projects || [])[0] || null;
  const root = chat?.workspaceRoot || project?.path || project?.root || project?.workspaceRoot || "C:\\Users\\Gabriel\\Documents\\Playground\\dream-server-hermes";
  const worktreeTasks = tasks.filter((task) => task.worktreePath || task.worktreeBranch);
  const reviewTasks = tasks.filter((task) => ["ai_review", "human_review"].includes(visualTaskStatus(task.status)));
  const doneTasks = tasks.filter((task) => visualTaskStatus(task.status) === "done");
  const activeTasks = tasks.filter((task) => visualTaskStatus(task.status) === "in_progress");
  const signature = JSON.stringify([
    mode,
    selectedAperantProvider(),
    state.app?.hasCloudApiKey,
    settings.fullAccessMode,
    settings.kanbanGitEnabled,
    settings.kanbanAutoSchedulerEnabled,
    settings.kanbanAutoRecoverEnabled,
    settings.kanbanAutoCleanupEnabled,
    settings.kanbanAutoPrEnabled,
    tasks.map((task) => [task.id, task.title, task.status, task.updatedAt, task.result, task.worktreePath, task.worktreeBranch, task.prUrl, task.cleanupState]),
    agents.map((agent) => [agent.id, agent.status, agent.taskId, agent.updatedAt]),
    sessions.map((session) => [session.id, session.alive, session.taskId, session.updatedAt])
  ]);
  if (state.renderCache.aperantUtility === signature) return;
  state.renderCache.aperantUtility = signature;

  const toolbar = `
    <div class="kanban-command-row aperant-utility-command-row">
      <div class="aperant-toolbar-spacer"></div>
      <div class="aperant-toolbar-actions">
        <button type="button" class="terminal-toolbar-btn" data-utility-run="${escapeHtml(mode)}">${escapeHtml(meta.action)}</button>
        <button type="button" class="terminal-toolbar-btn" data-aperant-mode="kanban">Kanban</button>
        <button type="button" class="terminal-toolbar-btn" data-open-settings="true">Settings</button>
      </div>
    </div>
  `;

  const metrics = `
    <div class="aperant-metric-grid">
      ${aperantMetric("Planning", counts.planning, "ready cards")}
      ${aperantMetric("In Progress", counts.in_progress, `${runningKanbanTaskCount()} active`)}
      ${aperantMetric("Review", counts.ai_review + counts.human_review, "AI + human")}
      ${aperantMetric("Done", counts.done, "completed")}
      ${aperantMetric("Agents", agents.length, `${sessions.filter((item) => item.alive).length} terminals`)}
      ${aperantMetric("Provider", selectedAperantProvider(), aperantProviderHealth(selectedAperantProvider()).label)}
    </div>
  `;

  const panels = {
    insights: `
      ${metrics}
      <div class="aperant-utility-grid">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Needs attention</strong><span>${reviewTasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(reviewTasks, "No review queue.")}</div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Recent activity</strong><span>${tasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(tasks, "No activity yet.", 7)}</div>
        </section>
      </div>
    `,
    roadmap: `
      ${metrics}
      <div class="aperant-roadmap-lanes">
        ${["planning", "in_progress", "ai_review", "human_review", "done"].map((status) => `
          <section class="aperant-utility-panel">
            <div class="view-list-head"><strong>${escapeHtml(kanbanColumnLabel(status))}</strong><span>${counts[status] || 0}</span></div>
            <div class="aperant-mini-list">${aperantMiniTaskList(tasks.filter((task) => visualTaskStatus(task.status) === status), "Empty lane.", 4)}</div>
          </section>
        `).join("")}
      </div>
    `,
    ideation: `
      <form class="aperant-idea-form" data-utility-form="ideation">
        <label class="aperant-task-field">
          <span>Idea</span>
          <textarea name="idea" rows="5" placeholder="Describe the feature or experiment. Hermes will turn it into an execution plan."></textarea>
        </label>
        <button type="submit" class="aperant-new-task-btn">Run ideation with Hermes</button>
      </form>
      <div class="aperant-utility-grid">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Source tasks</strong><span>${tasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(tasks, "Create a task first.", 7)}</div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Hermes routes</strong><span>4</span></div>
          <div class="aperant-chip-list"><span>frontend</span><span>bugfix</span><span>research</span><span>ios</span></div>
        </section>
      </div>
    `,
    changelog: `
      <div class="aperant-utility-grid">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Completed</strong><span>${doneTasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(doneTasks, "No completed tasks.", 9)}</div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>PR ready</strong><span>${tasks.filter((task) => task.prUrl || visualTaskStatus(task.status) === "ai_review").length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(tasks.filter((task) => task.prUrl || visualTaskStatus(task.status) === "ai_review"), "No PR-ready work.", 7)}</div>
        </section>
      </div>
    `,
    context: `
      <div class="aperant-context-stack">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Workspace</strong><span>C</span></div>
          <div class="aperant-context-row"><span>Root</span><strong title="${escapeHtml(root)}">${escapeHtml(root)}</strong></div>
          <div class="aperant-context-row"><span>Provider</span><strong>${escapeHtml(selectedAperantProvider())}</strong></div>
          <div class="aperant-context-row"><span>Health</span><strong>${escapeHtml(aperantProviderHealth(selectedAperantProvider()).label)}</strong></div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Hermes rules</strong><span>${settings.fullAccessMode ? "On" : "Off"}</span></div>
          <div class="aperant-chip-list">
            <span>${settings.fullAccessMode ? "full access" : "limited mode"}</span>
            <span>${kanbanGitEnabled() ? "git/worktree" : "PC workspace"}</span>
            <span>${settings.kanbanAutoSchedulerEnabled === false ? "scheduler off" : "scheduler on"}</span>
            <span>${settings.kanbanAutoRecoverEnabled === false ? "recover off" : "recover on"}</span>
            <span>${settings.kanbanAutoCleanupEnabled === false ? "cleanup off" : "cleanup on"}</span>
            <span>${settings.kanbanAutoPrEnabled ? "PR auto" : "PR manual"}</span>
          </div>
        </section>
      </div>
    `,
    github: `
      <div class="aperant-utility-grid">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Issue triage</strong><span>G</span></div>
          <p class="aperant-utility-copy">Hermes can create an issue-triage task, inspect repository context, prepare fixes, and route PR creation through the Kanban flow.</p>
          <div class="aperant-chip-list"><span>${kanbanGitEnabled() ? "git enabled" : "git disabled"}</span><span>${settings.fullAccessMode ? "actions enabled" : "actions limited"}</span><span>${selectedAperantProvider()}</span></div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Review queue</strong><span>${reviewTasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(reviewTasks, "No issue-related review queue.", 7)}</div>
        </section>
      </div>
    `,
    worktrees: `
      <div class="aperant-utility-grid">
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Worktrees</strong><span>${worktreeTasks.length}</span></div>
          <div class="aperant-mini-list">
            ${worktreeTasks.length ? worktreeTasks.map((task) => `
              <article class="aperant-mini-card aperant-worktree-card">
                <div>
                  <strong>${escapeHtml(task.title || task.id)}</strong>
                  <p>${escapeHtml(task.worktreePath || task.worktreeBranch || "No path")}</p>
                </div>
                <div class="kanban-card-actions">
                  ${task.worktreePath ? `<button type="button" class="kanban-card-btn" data-cleanup-task="${escapeHtml(task.id)}">Cleanup</button>` : ""}
                  <button type="button" class="kanban-card-btn" data-create-pr="${escapeHtml(task.id)}" ${kanbanGitEnabled() ? "" : "disabled"}>PR</button>
                </div>
              </article>
            `).join("") : `<div class="kanban-empty aperant-utility-empty"><span class="kanban-empty-icon">+</span><strong>No worktrees yet.</strong></div>`}
          </div>
        </section>
        <section class="aperant-utility-panel">
          <div class="view-list-head"><strong>Active builds</strong><span>${activeTasks.length}</span></div>
          <div class="aperant-mini-list">${aperantMiniTaskList(activeTasks, "No active builds.", 7)}</div>
        </section>
      </div>
    `
  };

  elements.aperantUtilityView.innerHTML = `
    ${toolbar}
    <div class="aperant-utility-body">
      ${panels[mode] || panels.insights}
    </div>
  `;
}

function taskOverallProgress(task, fallbackStatus) {
  const progress = Number(task?.executionProgress?.overallProgress);
  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }
  return kanbanProgress(fallbackStatus);
}

function taskHasCompletedResult(task) {
  const visual = visualTaskStatus(task?.status);
  const raw = String(task?.status || "").toLowerCase();
  return Boolean(task?.result && (["done", "archived"].includes(visual) || ["done", "pr_created", "archived"].includes(raw)));
}

function latestTaskLog(task) {
  const entries = ["planning", "coding", "validation"]
    .flatMap((phase) => Array.isArray(task?.logs?.[phase]) ? task.logs[phase].map((entry) => ({ ...entry, phase })) : [])
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
  return entries[0] || null;
}

function taskPhaseLogMarkup(task) {
  const phaseLabels = {
    planning: "Planning",
    coding: "Coding",
    validation: "Validation"
  };
  return `
    <details class="kanban-phase-log">
      <summary>Phase logs</summary>
      <div class="kanban-phase-grid">
        ${["planning", "coding", "validation"].map((phase) => {
          const entries = Array.isArray(task?.logs?.[phase]) ? task.logs[phase].slice(-4) : [];
          return `
            <section>
              <strong>${escapeHtml(phaseLabels[phase])}</strong>
              ${entries.length
                ? entries.map((entry) => `
                  <p><span>${escapeHtml(formatRelativeTime(entry.timestamp))}</span>${escapeHtml(shortText(entry.content || entry.type || "event", 120))}</p>
                `).join("")
                : `<p><span>-</span>sem logs</p>`}
            </section>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function taskLooksStale(task, agent, terminal) {
  const status = String(task?.status || "").toLowerCase();
  if (!["in_progress", "creating_pr"].includes(status)) return false;
  if (agent && ["pending", "running"].includes(String(agent.status || ""))) return false;
  if (terminal?.alive && (terminal.currentCommand || terminal.promptState === "running")) return false;
  const lastActivityAt = Number(task?.lastActivityAt || task?.updatedAt || task?.createdAt || 0);
  return Boolean(lastActivityAt && Date.now() - lastActivityAt > 60000);
}

function taskActionButtons(task, fullAccessMode, isStarting = false, isStale = false) {
  const status = visualTaskStatus(task.status);
  const moveButton = (nextStatus, label) =>
    `<button type="button" class="kanban-card-btn" data-task-status="${escapeHtml(nextStatus)}" data-task-id="${escapeHtml(task.id)}">${escapeHtml(label)}</button>`;
  const startButton = (label = "Start") =>
    `<button type="button" class="kanban-card-btn kanban-card-btn-agent" data-start-task="${escapeHtml(task.id)}" ${isStarting ? "disabled" : ""} ${fullAccessMode ? "" : "data-requires-full-access=\"true\" title=\"Ative acesso total para spawn de subagentes\""}>${escapeHtml(isStarting ? "Spawning" : label)}</button>`;
  const stopButton = () =>
    `<button type="button" class="kanban-card-btn" data-stop-task="${escapeHtml(task.id)}" ${fullAccessMode ? "" : "data-requires-full-access=\"true\" title=\"Ative acesso total para parar subagentes\""}>Stop</button>`;
  const recoverButton = (label = "Recover") =>
    `<button type="button" class="kanban-card-btn" data-recover-task="${escapeHtml(task.id)}" ${fullAccessMode ? "" : "data-requires-full-access=\"true\" title=\"Ative acesso total para recuperar a task\""}>${escapeHtml(label)}</button>`;
  const cleanupButton = () =>
    task.worktreePath
      ? `<button type="button" class="kanban-card-btn" data-cleanup-task="${escapeHtml(task.id)}" ${fullAccessMode ? "" : "data-requires-full-access=\"true\" title=\"Ative acesso total para limpar worktree\""}>Cleanup</button>`
      : "";
  const archiveButton = () => moveButton("archived", "Archive");
  const deleteButton = () =>
    `<button type="button" class="kanban-card-btn" data-delete-task="${escapeHtml(task.id)}" title="Delete this archived task">Delete</button>`;
  const prButton = () =>
    `<button type="button" class="kanban-card-btn" data-create-pr="${escapeHtml(task.id)}" ${fullAccessMode && kanbanGitEnabled() ? "" : "disabled data-requires-full-access=\"true\" title=\"Ative acesso total e git/worktree do Kanban para criar PR\""}>PR</button>`;

  if (status === "planning") {
    return [startButton("Start"), moveButton("human_review", "Review"), moveButton("done", "Done"), cleanupButton()].join("");
  }
  if (status === "in_progress") {
    return [isStale ? recoverButton() : "", moveButton("ai_review", "AI Review"), moveButton("human_review", "Human Review"), moveButton("done", "Done"), stopButton()].join("");
  }
  if (status === "ai_review") {
    return [prButton(), moveButton("human_review", "Human Review"), moveButton("done", "Done"), startButton("Resume"), cleanupButton()].join("");
  }
  if (status === "human_review") {
    return [recoverButton("Recover"), prButton(), startButton("Resume"), moveButton("done", "Done"), archiveButton(), cleanupButton()].join("");
  }
  if (status === "archived") {
    return [moveButton("backlog", "Restore"), deleteButton()].join("");
  }
  return [task.prUrl ? "" : prButton(), cleanupButton(), moveButton("backlog", "Reopen"), archiveButton()].join("");
}

function renderAperantSidebar() {
  const isAperant = APERANT_APP_MODES.includes(state.appMode);
  if (elements.aperantSidebar) {
    elements.aperantSidebar.hidden = !isAperant;
  }
  if (!isAperant) return;

  const chat = currentChat();
  const project = projectForChat(chat) || (state.app?.projects || [])[0] || null;
  const root = chat?.workspaceRoot || project?.path || project?.root || project?.workspaceRoot || "C:\\Users\\Gabriel\\Documents\\Playground\\dream-server-hermes";
  const name = project?.name || project?.slug || pathBaseName(root) || "autonomous-coding";
  const provider = selectedAperantProvider();
  const maxParallel = kanbanMaxParallelAgents();
  const runningCount = runningKanbanTaskCount();
  const pendingCount = pendingKanbanTasks().length;
  const taskCount = (state.app?.tasks || []).length;

  if (elements.aperantProjectName) elements.aperantProjectName.textContent = name;
  if (elements.aperantProjectPath) {
    elements.aperantProjectPath.textContent = root;
    elements.aperantProjectPath.title = root;
  }
  if (elements.aperantTaskCount) elements.aperantTaskCount.textContent = String(taskCount);
  if (elements.aperantProviderState) elements.aperantProviderState.textContent = `Hermes ${provider}`;
  if (elements.aperantAgentState) elements.aperantAgentState.textContent = `${runningCount}/${maxParallel} agents`;
  if (elements.aperantPendingState) elements.aperantPendingState.textContent = `${pendingCount} pending`;

  document.querySelectorAll("[data-aperant-mode]").forEach((button) => {
    const active = button.dataset.aperantMode === state.appMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function renderKanbanBoard() {
  if (!elements.kanbanColumns) return;
  const tasks = state.app?.tasks || [];
  const agents = state.app?.agents || [];
  const terminalSessions = state.app?.terminalSessions || [];
  const taskAgents = agentsByTaskId();
  const fullAccessMode = Boolean(state.app?.settings?.fullAccessMode);
  const settings = state.app?.settings || {};
  const maxParallel = kanbanMaxParallelAgents();
  const runningCount = runningKanbanTaskCount();
  const pendingCount = pendingKanbanTasks().length;
  const health = aperantProviderHealth(selectedAperantProvider());
  if (elements.kanbanQueueActiveInput) {
    elements.kanbanQueueActiveInput.checked = state.kanbanQueueActive;
  }
  if (elements.kanbanRuntimeBanner) {
    elements.kanbanRuntimeBanner.hidden = true;
    elements.kanbanRuntimeBanner.classList.remove("is-warning");
    elements.kanbanRuntimeBanner.replaceChildren();
  }
  const columns = ["planning", "in_progress", "ai_review", "human_review", "done"].concat(state.kanbanShowArchived ? ["archived"] : []);
  const signature = JSON.stringify([
    fullAccessMode,
    health,
    maxParallel,
    settings.kanbanGitEnabled,
    settings.kanbanAutoSchedulerEnabled,
    settings.kanbanAutoPrEnabled,
    settings.kanbanMultiAgentOrchestrationEnabled,
    state.kanbanQueueActive,
    state.kanbanShowArchived,
    [...state.kanbanStartingTaskIds],
    ...agents.map((agent) => [agent.id, agent.taskId, agent.status, agent.summary, agent.updatedAt]),
    ...terminalSessions.map((session) => [session.id, session.taskId, session.alive, session.promptState, session.currentCommand, session.updatedAt]),
    ...tasks.map((task) => [
      task.id,
      task.status,
      task.title,
      task.objective,
      task.updatedAt,
      task.result,
      task.agentId,
      task.terminalSessionId,
      task.worktreeBranch,
      task.worktreePath,
      task.lastActivityAt,
      task.stuckAt,
      task.reviewReason,
      task.prUrl,
      task.prState,
      task.cleanupState,
      task.executionProgress,
      task.logs
    ])
  ]);
  if (state.renderCache.kanban === signature) return;
  state.renderCache.kanban = signature;

  elements.kanbanColumns.innerHTML = columns.map((status) => {
    const columnTasks = tasks.filter((task) => visualTaskStatus(task.status) === status);
    const subtitle = {
      planning: "Ready to start",
      in_progress: "Active builds",
      ai_review: "Agent output ready",
      human_review: "Needs attention",
      done: "Finished work",
      archived: "Hidden history"
    }[status] || "Parked work";
    return `
      <section class="kanban-column" data-kanban-column="${escapeHtml(status)}">
        <div class="kanban-column-head">
          <div>
            <strong>${escapeHtml(kanbanColumnLabel(status))}</strong>
            <span class="kanban-column-subtitle">${escapeHtml(subtitle)}</span>
          </div>
          <span class="column-count-badge">${columnTasks.length}</span>
        </div>
        <div class="kanban-card-stack">
          ${columnTasks.length
            ? columnTasks.map((task) => {
                const agent = taskAgents.get(task.id) || (task.agentId ? agents.find((entry) => entry.id === task.agentId) : null);
                const terminal = terminalSessions.find((entry) =>
                  entry.taskId === task.id || (task.terminalSessionId && entry.id === task.terminalSessionId)
                );
                const isStarting = state.kanbanStartingTaskIds.has(task.id);
                const isStale = taskLooksStale(task, agent, terminal);
                const agentStatus = isStarting ? "pending" : String(agent?.status || "");
                const progress = taskOverallProgress(task, visualTaskStatus(task.status));
                const filledDots = Math.max(0, Math.min(10, Math.round(progress / 10)));
                const executionPhase = task.executionProgress?.phase || status;
                const executionMessage = task.executionProgress?.message || "";
                const latestLog = latestTaskLog(task);
                const dots = Array.from({ length: 10 }, (_, index) =>
                  `<span class="${index < filledDots ? "is-filled" : ""}"></span>`
                ).join("");
                return `
                <article class="kanban-card" draggable="true" data-task-card-id="${escapeHtml(task.id)}">
                  <div class="kanban-card-top">
                    <strong>${escapeHtml(task.title || "Untitled task")}</strong>
                    <div class="kanban-card-badges">
                      <span class="kanban-status kanban-status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
                      ${agentStatus ? `<span class="kanban-status kanban-status-${escapeHtml(agentStatus)}">Agent ${escapeHtml(statusLabel(agentStatus))}</span>` : ""}
                      ${visualTaskStatus(task.status) !== String(task.status || "").toLowerCase() ? `<span class="kanban-status kanban-status-${escapeHtml(String(task.status || ""))}">${escapeHtml(statusLabel(task.status))}</span>` : ""}
                      ${terminal?.alive ? `<span class="kanban-status kanban-status-running" title="PTY ${escapeHtml(terminal.id)}">PTY ${escapeHtml(compactKanbanId(terminal.id, 18))}</span>` : ""}
                      ${isStale || task.stuckAt ? `<span class="kanban-status kanban-status-error">Stuck</span>` : ""}
                      ${task.prUrl ? `<span class="kanban-status kanban-status-done">PR</span>` : ""}
                      ${task.cleanupState ? `<span class="kanban-status kanban-status-stopped">${escapeHtml(task.cleanupState)}</span>` : ""}
                      ${taskHasCompletedResult(task) ? `<span class="kanban-status kanban-status-done">Completed</span>` : ""}
                    </div>
                  </div>
                  <p>${escapeHtml(shortText(task.objective || task.result || "No objective registered.", 220))}</p>
                  <div class="kanban-card-meta">
                    ${kanbanMetaPill(task.routeId, 22)}
                    ${kanbanMetaPill(task.worktreeBranch, 26)}
                    ${kanbanMetaPill(task.terminalSessionId, 22)}
                    ${kanbanMetaPill(agent?.id || task.agentId, 24)}
                  </div>
                  ${task.worktreePath ? `<p class="kanban-path">${escapeHtml(task.worktreePath)}</p>` : ""}
                  ${task.prUrl ? `<a class="kanban-pr-link" href="${escapeHtml(task.prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(task.prUrl)}</a>` : ""}
                  <div class="kanban-execution-row">
                    <span>${escapeHtml(statusLabel(executionPhase))}</span>
                    <strong>${escapeHtml(shortText(executionMessage || latestLog?.content || "Hermes state machine", 90))}</strong>
                  </div>
                  ${latestLog ? `<p class="kanban-latest-log"><span>${escapeHtml(latestLog.phase || "log")}</span>${escapeHtml(shortText(latestLog.content || latestLog.type, 150))}</p>` : ""}
                  ${taskPhaseLogMarkup(task)}
                  <div class="kanban-progress-row"><span>Progress</span><strong>${progress}%</strong></div>
                  <div class="kanban-progress-track" style="--progress:${progress}%"><span></span></div>
                  <div class="kanban-progress-dots">${dots}${progress === 100 ? "" : `<em>+${Math.max(0, 10 - filledDots)}</em>`}</div>
                  <div class="kanban-card-footer">
                    <span class="kanban-time">${escapeHtml(formatRelativeTime(task.updatedAt || task.createdAt))}</span>
                    <div class="kanban-card-actions">${taskActionButtons(task, fullAccessMode, isStarting, isStale)}</div>
                  </div>
                </article>
              `;
              }).join("")
            : `<div class="kanban-empty"><span class="kanban-empty-icon">+</span><strong>Nothing here</strong><small>${status === "planning" ? "Create a task from New Task." : "Move work here when it reaches this stage."}</small></div>`
          }
        </div>
      </section>
    `;
  }).join("");
}

async function moveKanbanTask(taskId, status) {
  if (!taskId || !status) return null;
  return await runHermesDirectAction({
    type: "task_update",
    id: taskId,
    status
  }, {
    successMessage: "Card atualizado pelo Hermes."
  });
}

async function startKanbanTask(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  const provider = selectedAperantProvider();
  if (!ensureAperantProviderReady(provider)) {
    return null;
  }
  const visualStatus = visualTaskStatus(task.status);
  if (visualStatus === "in_progress" || state.kanbanStartingTaskIds.has(task.id)) {
    return null;
  }
  if (runningKanbanTaskCount() >= kanbanMaxParallelAgents()) {
    if (visualStatus !== "queue") {
      await moveKanbanTask(task.id, "queue");
    }
    setKanbanQueueActive(true);
    showToast("Capacidade cheia: card movido para Queue.");
    return null;
  }
  state.kanbanStartingTaskIds.add(task.id);
  state.renderCache.kanban = "";
  renderKanbanBoard();
  return await runHermesDirectAction({
    type: "agent_spawn",
    taskId: task.id,
    name: task.title,
    objective: task.objective || task.title,
    routeId: task.routeId || undefined,
    provider,
    useGit: kanbanGitEnabled(),
    useWorktree: kanbanGitEnabled(),
    orchestrate: Boolean(state.app?.settings?.kanbanMultiAgentOrchestrationEnabled)
  }, {
    successMessage: "Task enviada ao Hermes."
  }).finally(() => {
    state.kanbanStartingTaskIds.delete(task.id);
    state.renderCache.kanban = "";
    renderKanbanBoard();
  });
}

async function stopKanbanTask(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  return await runHermesDirectAction({
    type: "task_stop",
    id: task.id
  }, {
    successMessage: "Execucao interrompida pelo Hermes."
  });
}

async function recoverKanbanTask(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  const provider = selectedAperantProvider();
  if (!ensureAperantProviderReady(provider)) {
    return null;
  }
  return await runHermesDirectAction({
    type: "task_recover",
    id: task.id,
    autoRestart: true,
    force: true,
    provider
  }, {
    successMessage: "Recuperacao enviada ao Hermes."
  });
}

async function cleanupKanbanTask(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  return await runHermesDirectAction({
    type: "task_cleanup_worktree",
    id: task.id,
    force: false
  }, {
    successMessage: "Cleanup de worktree enviado ao Hermes."
  });
}

async function createKanbanTaskPr(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (!state.app?.settings?.fullAccessMode) {
    showKanbanAccessRequired();
    return null;
  }
  if (!kanbanGitEnabled()) {
    showToast("Ative git/worktree do Kanban nas configuracoes para criar PR.");
    openSettingsModal();
    return null;
  }
  return await runHermesDirectAction({
    type: "task_create_pr",
    id: task.id,
    title: task.title,
    body: task.result || task.objective || task.title,
    draft: true
  }, {
    successMessage: "Fluxo de PR enviado ao Hermes."
  });
}

async function deleteKanbanTask(taskId) {
  const task = (state.app?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    showToast("Tarefa nao encontrada.");
    return null;
  }
  if (visualTaskStatus(task.status) !== "archived") {
    showToast("Arquive o card antes de deletar.");
    return null;
  }
  return await runHermesDirectAction({
    type: "task_delete",
    id: task.id
  }, {
    successMessage: "Card deletado do Kanban."
  });
}

async function processKanbanQueue({ force = false } = {}) {
  if (state.kanbanQueueProcessing || (!force && !state.kanbanQueueActive)) {
    return;
  }
  if (!state.app?.settings?.fullAccessMode) {
    setKanbanQueueActive(false);
    showKanbanAccessRequired();
    return;
  }
  if (!ensureAperantProviderReady(selectedAperantProvider())) {
    setKanbanQueueActive(false);
    return;
  }
  const capacity = Math.max(0, kanbanMaxParallelAgents() - runningKanbanTaskCount());
  const candidates = pendingKanbanTasks();
  if (!candidates.length) {
    if (state.kanbanQueueActive && runningKanbanTaskCount() === 0) {
      setKanbanQueueActive(false);
      showToast("Fila Kanban concluida.");
      renderKanbanBoard();
    }
    return;
  }
  if (!capacity) {
    return;
  }
  state.kanbanQueueProcessing = true;
  try {
    const batch = candidates.slice(0, force ? Math.max(1, capacity) : capacity);
    for (const task of batch) {
      const result = await startKanbanTask(task.id);
      if (!result) {
        setKanbanQueueActive(false);
        break;
      }
    }
  } finally {
    state.kanbanQueueProcessing = false;
    state.renderCache.kanban = "";
    renderKanbanBoard();
  }
}

async function openHermesTerminal(session = nextTerminalSlot()) {
  if (!state.app?.settings?.fullAccessMode) {
    showToast("Ative acesso total para abrir terminais.");
    return null;
  }
  const settings = state.app?.settings || {};
  const routing = terminalHermesRouting(settings);
  const action = {
    type: "terminal_open",
    session,
    shell: fieldValue(elements.terminalShellInput, defaultTerminalShellValue()) || defaultTerminalShellValue(),
    cwd: fieldValue(elements.terminalCwdInput) || undefined,
    hermesCli: true,
    provider: routing.provider,
    baseUrl: routing.baseUrl,
    model: routing.model,
    apiKey: routing.apiKey
  };
  return await runHermesDirectAction(action, {
    successMessage: `Terminal ${session} aberto com Hermes Agent CLI.`
  });
}

async function openSixHermesTerminals() {
  if (!state.app?.settings?.fullAccessMode) {
    showToast("Ative acesso total para abrir terminais.");
    return null;
  }
  let lastResult = null;
  for (const session of APERANT_TERMINAL_SLOTS) {
    const current = (state.app?.terminalSessions || []).find((item) => item.id === session);
    if (current?.alive) continue;
    lastResult = await openHermesTerminal(session);
  }
  return lastResult;
}

function renderMultiAgentDeck() {
  if (!elements.multiAgentList || !elements.multiTerminalList) return;
  const fullAccessMode = Boolean(state.app?.settings?.fullAccessMode);
  const agents = state.app?.agents || [];
  const sessions = sortedTerminalSessions();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const terminalSlots = [
    ...APERANT_TERMINAL_SLOTS,
    ...sessions.filter((session) => !APERANT_TERMINAL_SLOTS.includes(session.id)).map((session) => session.id)
  ];
  const aliveTerminalCount = sessions.filter((session) => session.alive).length;
  const agentSignature = JSON.stringify([
    fullAccessMode,
    ...agents.map((agent) => [agent.id, agent.taskId, agent.status, agent.name, agent.objective, agent.summary, agent.updatedAt, agent.worktreePath, agent.worktreeBranch])
  ]);
  const terminalSignature = JSON.stringify([
    fullAccessMode,
    ...terminalSlots,
    ...sessions.map((session) => [session.id, session.taskId, session.alive, session.shell, session.promptState, session.cwd, session.currentCommand, session.stdoutTail, session.stderrTail, session.updatedAt])
  ]);

  if (elements.multiAgentCount) elements.multiAgentCount.textContent = String(agents.length);
  if (elements.multiTerminalCount) elements.multiTerminalCount.textContent = `${aliveTerminalCount} / 12`;

  if (state.renderCache.multiAgents !== agentSignature) {
    state.renderCache.multiAgents = agentSignature;
    elements.multiAgentList.innerHTML = [
      !fullAccessMode
    ? `<div class="agent-warning-card"><strong>Acesso total desligado</strong><span>Spawn de subagentes e terminais fica bloqueado ate habilitar em Settings > Hermes Desktop.</span></div>`
        : "",
      agents.length
        ? agents.map((agent) => `
            <article class="multiagent-card">
              <div class="multiagent-card-head">
                <div>
                  <strong>${escapeHtml(agent.name || agent.id)}</strong>
                  <span>${escapeHtml(agent.id)}</span>
                </div>
                <span class="kanban-status kanban-status-${escapeHtml(agent.status || "pending")}">${escapeHtml(statusLabel(agent.status))}</span>
              </div>
              <p>${escapeHtml(shortText(agent.objective || "No objective registered.", 260))}</p>
              ${agent.summary ? `<pre class="kanban-result">${escapeHtml(shortText(agent.summary, 700))}</pre>` : ""}
              <div class="kanban-card-meta">
                ${agent.provider ? `<span>${escapeHtml(agent.provider)}</span>` : ""}
                ${agent.taskId ? `<span>${escapeHtml(agent.taskId)}</span>` : ""}
                ${agent.routeId ? `<span>${escapeHtml(agent.routeId)}</span>` : ""}
                ${agent.worktreeBranch ? `<span>${escapeHtml(agent.worktreeBranch)}</span>` : ""}
              </div>
              ${agent.worktreePath ? `<p class="kanban-path">${escapeHtml(agent.worktreePath)}</p>` : ""}
              <div class="kanban-card-footer">
                <span class="kanban-time">${escapeHtml(formatRelativeTime(agent.updatedAt || agent.createdAt))}</span>
                <div class="kanban-card-actions">
                  ${["pending", "running"].includes(String(agent.status || "")) ? `<button type="button" class="kanban-card-btn" data-stop-agent="${escapeHtml(agent.id)}" ${fullAccessMode ? "" : "disabled"}>Stop</button>` : ""}
                  ${agent.chatId ? `<button type="button" class="kanban-card-btn" data-open-agent-chat="${escapeHtml(agent.chatId)}">Chat</button>` : ""}
                </div>
              </div>
            </article>
          `).join("")
        : `<div class="kanban-empty"><span class="kanban-empty-icon">+</span><strong>No agents yet</strong><small>Spawn one from the Hermes panel below.</small></div>`
    ].join("");
  }

  if (state.renderCache.multiTerminals !== terminalSignature) {
    state.renderCache.multiTerminals = terminalSignature;
    elements.multiTerminalList.innerHTML = terminalSlots.map((slot) => {
      const session = sessionsById.get(slot);
      if (!session) {
        return `
          <article class="multiagent-card terminal-panel terminal-slot-empty is-stopped">
            <div class="terminal-panel-head">
              <div class="terminal-panel-title">
                <span class="terminal-state-dot"></span>
                <span class="terminal-glyph" aria-hidden="true"></span>
                <strong>${escapeHtml(slot)}</strong>
                <span class="terminal-claude-badge">Hermes</span>
              </div>
              <span class="terminal-closed-label">empty</span>
            </div>
            <div class="terminal-panel-body terminal-empty-body">
              <button type="button" class="terminal-empty-action" data-open-terminal-slot="${escapeHtml(slot)}" ${fullAccessMode ? "" : "disabled"}>Open terminal</button>
              <p>Opens a CMD-backed Hermes Agent CLI session.</p>
            </div>
          </article>
        `;
      }
      return `
          <article class="multiagent-card terminal-panel ${session.alive ? "is-running" : "is-stopped"}">
            <div class="terminal-panel-head">
              <div class="terminal-panel-title">
                <span class="terminal-state-dot"></span>
                <span class="terminal-glyph" aria-hidden="true"></span>
                <strong>${escapeHtml(session.id)}</strong>
                <span class="terminal-claude-badge">Hermes</span>
                <span class="terminal-task-select">${escapeHtml(session.promptState || (session.alive ? "idle" : "closed"))}</span>
              </div>
              <div class="terminal-panel-actions">
                ${session.alive ? `<button type="button" class="terminal-close-btn" data-close-terminal="${escapeHtml(session.id)}" title="Close terminal">x</button>` : `<span class="terminal-closed-label">closed</span>`}
              </div>
            </div>
            <div class="terminal-panel-body">
              <p class="kanban-path">${escapeHtml(session.cwd || "")}</p>
              ${session.taskId ? `<div class="kanban-card-meta"><span>${escapeHtml(session.taskId)}</span></div>` : ""}
              ${session.currentCommand ? `<p class="terminal-running-command">${escapeHtml(`> ${session.currentCommand}`)}</p>` : ""}
              <div class="terminal-mini-log">
                <strong>stdout</strong>
                <pre>${escapeHtml(shortText(session.stdoutTail || "> waiting for output", 1200))}</pre>
              </div>
              ${session.stderrTail ? `<div class="terminal-mini-log is-warn"><strong>stderr</strong><pre>${escapeHtml(shortText(session.stderrTail, 640))}</pre></div>` : ""}
            </div>
          </article>
        `;
    }).join("");
  }
}

function renderShell() {
  elements.appShell?.classList.toggle("panel-open", state.panelOpen);
  elements.panelScrim.hidden = true;
  elements.headerPanelButton?.classList.toggle("is-active", state.panelOpen);
  if (elements.headerPanelButton) {
    elements.headerPanelButton.title = state.panelOpen ? "Ocultar painel direito" : "Mostrar painel direito";
  }
}

/* =================================================================
   SETTINGS v5 — abas + tema
   ================================================================= */
// themeState é declarado mais abaixo, mas já era usado por collectThemePayload.
// Declaramos o `let` aqui para evitar TDZ se collectThemePayload for chamado antes.
const THEME_PRESETS = [
  {
    id: "roxo",
    name: "Roxo",
    sub: "legado",
    accent: "#7c6cfc", accentHi: "#a89bff",
    stopA: "rgba(130, 50,255,0.80)",
    stopB: "rgba( 30, 60,240,0.75)",
    stopC: "rgba( 80, 10,210,0.50)",
    stopD: "rgba(210, 70,255,0.45)",
    stopE: "rgba( 50, 30,200,0.45)",
    base: "#04030b", tint: "#0a081c", blur: 30
  },
  {
    id: "azul",
    name: "Azul profundo",
    sub: "cool",
    accent: "#4a9eff", accentHi: "#8fc3ff",
    stopA: "rgba( 40,120,255,0.80)",
    stopB: "rgba( 10, 70,200,0.75)",
    stopC: "rgba( 20, 50,170,0.50)",
    stopD: "rgba( 80,150,255,0.45)",
    stopE: "rgba( 30, 80,210,0.45)",
    base: "#020611", tint: "#081222", blur: 30
  },
  {
    id: "esmeralda",
    name: "Esmeralda",
    sub: "fresco",
    accent: "#3dd68c", accentHi: "#8be9b5",
    stopA: "rgba( 50,220,140,0.70)",
    stopB: "rgba( 10,130, 90,0.70)",
    stopC: "rgba( 20, 90, 70,0.48)",
    stopD: "rgba(100,240,180,0.42)",
    stopE: "rgba( 30,120, 90,0.42)",
    base: "#02100a", tint: "#071a14", blur: 28
  },
  {
    id: "sunset",
    name: "Sunset",
    sub: "quente",
    accent: "#ff8a5b", accentHi: "#ffb693",
    stopA: "rgba(255,120, 80,0.72)",
    stopB: "rgba(220, 60,130,0.70)",
    stopC: "rgba(160, 40,100,0.50)",
    stopD: "rgba(255,160,100,0.44)",
    stopE: "rgba(180, 50, 90,0.44)",
    base: "#120405", tint: "#1b0a0d", blur: 30
  },
  {
    id: "rose",
    name: "Rose",
    sub: "default",
    accent: "#8a0000", accentHi: "#ff4b4b",
    stopA: "rgba(138,  0,  0,0.80)",
    stopB: "rgba( 86,  0,  0,0.75)",
    stopC: "rgba( 96,  0,  0,0.50)",
    stopD: "rgba(210, 28, 28,0.44)",
    stopE: "rgba( 70,  0,  0,0.45)",
    base: "#080202", tint: "#170505", blur: 30
  },
  {
    id: "grafite",
    name: "Grafite",
    sub: "neutro",
    accent: "#b4b4c0", accentHi: "#e0e0ea",
    stopA: "rgba(120,120,140,0.60)",
    stopB: "rgba( 60, 60, 80,0.58)",
    stopC: "rgba( 40, 40, 55,0.45)",
    stopD: "rgba(150,150,170,0.38)",
    stopE: "rgba( 70, 70, 90,0.40)",
    base: "#07070b", tint: "#0d0d14", blur: 32
  }
];

let themeState = null;
const DEFAULT_THEME_PRESET_ID = "rose";

const CODE_SHADER_PRESETS = Object.freeze({
  bar: "bar",
  block: "block",
  underline: "underline",
  outline: "outline"
});

const LEGACY_CODE_SHADER_PRESETS = Object.freeze({
  aurora: "bar",
  scanline: "block",
  manga: "underline",
  plasma: "outline"
});

const CODE_CURSOR_SHADERS = Object.freeze({
  blaze: "blaze",
  frozen: "frozen",
  rainbow: "rainbow",
  lastletter: "lastletter",
  sparks: "sparks",
  zoom: "zoom",
  shake: "shake",
  border: "border"
});

const CODE_WIDTH_PULSE_CURSOR_SHADERS = new Set();
const CODE_GHOSTTY_PLAYGROUND_SHADER_IDS = new Set([
  "rainbow",
  "blaze",
  "frozen",
  "border",
  "shake",
  "zoom",
  "sparks",
  "lastletter"
]);

const CODE_CURSOR_STYLES = Object.freeze({
  block: 0,
  outline: 1,
  bar: 2,
  underline: 3
});

const CODE_SHADER_VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const CODE_GHOSTTY_SHADER_PREFIX = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D iChannel0;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec3 iChannelResolution[4];
uniform vec4 iMouse;
uniform vec4 iCurrentCursor;
uniform vec4 iPreviousCursor;
uniform vec4 iCurrentCursorColor;
uniform vec4 iPreviousCursorColor;
uniform int iCurrentCursorStyle;
uniform int iPreviousCursorStyle;
uniform int iCursorVisible;
uniform float iTimeCursorChange;
uniform float iTimeFocus;
uniform int iFocus;
uniform vec3 iBackgroundColor;
uniform vec3 iForegroundColor;
uniform vec3 iCursorColor;
uniform vec3 iCursorText;
uniform vec3 iSelectionBackgroundColor;
uniform vec3 iSelectionForegroundColor;
uniform float iEffectIntensity;

#define CURSORSTYLE_BLOCK 0
#define CURSORSTYLE_BLOCK_HOLLOW 1
#define CURSORSTYLE_BAR 2
#define CURSORSTYLE_UNDERLINE 3
#define CURSORSTYLE_LOCK 4
#define texture2D texture

out vec4 fragColor;

float saturate(float v) { return clamp(v, 0.0, 1.0); }
vec2 saturate(vec2 v) { return clamp(v, vec2(0.0), vec2(1.0)); }

float easeOutCubic(float x) {
  x = saturate(x);
  return 1.0 - pow(1.0 - x, 3.0);
}

float easeOutQuart(float x) {
  x = saturate(x);
  float inv = 1.0 - x;
  return 1.0 - inv * inv * inv * inv;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}

vec4 sampleCode(vec2 fragCoord) {
  vec2 uv = saturate(fragCoord / iResolution.xy);
  return texture(iChannel0, uv);
}

float cursorRectMask(vec2 frag, vec4 cursor, int style, float feather) {
  vec2 size = max(cursor.zw, vec2(1.0));
  vec2 pos = cursor.xy;

  if (style == CURSORSTYLE_BAR) {
    size.x = max(2.0, min(size.x, size.y * 0.16));
  } else if (style == CURSORSTYLE_UNDERLINE) {
    size.y = max(2.0, size.y * 0.18);
  }

  vec2 center = pos + size * 0.5;
  vec2 d = abs(frag - center) - size * 0.5;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float filled = 1.0 - smoothstep(0.0, feather, outside);

  if (style == CURSORSTYLE_BLOCK_HOLLOW) {
    vec2 inner = max(size - vec2(max(2.0, size.y * 0.14)), vec2(0.0));
    vec2 di = abs(frag - center) - inner * 0.5;
    float innerOutside = length(max(di, 0.0)) + min(max(di.x, di.y), 0.0);
    float innerMask = 1.0 - smoothstep(0.0, feather, innerOutside);
    filled *= 1.0 - innerMask;
  }

  return filled;
}

vec4 cursorBase(vec2 frag) {
  if (iCursorVisible == 0) return vec4(0.0);
  float mask = cursorRectMask(frag, iCurrentCursor, iCurrentCursorStyle, 1.4);
  vec3 color = mix(iCurrentCursorColor.rgb, vec3(1.0), 0.12);
  return vec4(color, mask * (0.32 + 0.36 * iEffectIntensity));
}

vec4 over(vec4 base, vec4 top) {
  return vec4(mix(base.rgb, top.rgb, saturate(top.a)), 1.0);
}

vec4 addGlow(vec4 base, vec3 color, float amount) {
  return vec4(min(base.rgb + color * amount, vec3(1.0)), 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord);
void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}
`;

function codeGhosttyExternalShaderPrefix(cursorShader = "") {
  const webDefine = CODE_GHOSTTY_PLAYGROUND_SHADER_IDS.has(cursorShader) ? "#define WEB 1\n" : "";
  return `#version 300 es
${webDefine}#define HW_PERFORMANCE 1
#ifdef GL_ES
precision highp float;
precision highp int;
#endif

uniform sampler2D iChannel0;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec3 iChannelResolution[4];
uniform vec4 iMouse;
uniform vec4 iCurrentCursor;
uniform vec4 iPreviousCursor;
uniform vec4 iCurrentCursorColor;
uniform vec4 iPreviousCursorColor;
uniform int iCurrentCursorStyle;
uniform int iPreviousCursorStyle;
uniform int iCursorVisible;
uniform float iTimeCursorChange;
uniform float iTimeFocus;
uniform int iFocus;
uniform vec3 iBackgroundColor;
uniform vec3 iForegroundColor;
uniform vec3 iCursorColor;
uniform vec3 iCursorText;
uniform vec3 iSelectionBackgroundColor;
uniform vec3 iSelectionForegroundColor;
uniform float iEffectIntensity;

out vec4 fragColor;
`;
}

const CODE_GHOSTTY_EXTERNAL_SHADER_FOOTER = `
void main() {
  vec4 shaderColor = vec4(0.0);
  mainImage(shaderColor, gl_FragCoord.xy);
  vec4 baseColor = texture(iChannel0, gl_FragCoord.xy / iResolution.xy);
  fragColor = mix(baseColor, shaderColor, clamp(iEffectIntensity, 0.0, 1.0));
}
`;

const CODE_GHOSTTY_SHADER_FILES = Object.freeze({
  rainbow: "cursor_smear_rainbow.glsl",
  blaze: "cursor_blaze.glsl",
  frozen: "cursor_frozen.glsl",
  border: "cursor_border_1.glsl",
  shake: "shake.glsl",
  zoom: "zoom_and_aberration.glsl",
  sparks: "party_sparks.glsl",
  lastletter: "last_letter_zoom.glsl"
});

const codeGhosttyShaderSourceCache = new Map();

const CODE_GHOSTTY_SHADER_SOURCES = Object.freeze({
  none: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  fragColor = over(base, cursorBase(fragCoord));
}
`,
  tail: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 prev = iPreviousCursor.xy + iPreviousCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.24);
  float life = (1.0 - progress) * iEffectIntensity;
  float line = exp(-sdSegment(fragCoord, prev, cur) / max(iCurrentCursor.w * 0.42, 8.0));
  float head = exp(-distance(fragCoord, cur) / max(iCurrentCursor.w * 0.32, 6.0));
  float wake = line * life * 0.72 + head * (0.22 + 0.38 * iEffectIntensity);
  vec3 color = mix(iPreviousCursorColor.rgb, iCurrentCursorColor.rgb, 0.74);
  fragColor = addGlow(base, color, wake);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  sweep: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 prev = iPreviousCursor.xy + iPreviousCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = easeOutQuart(elapsed / 0.28);
  vec2 front = mix(prev, cur, progress);
  vec2 back = mix(prev, cur, max(0.0, progress - 0.46));
  float d = sdSegment(fragCoord, back, front);
  float blade = exp(-d / max(iCurrentCursor.w * 0.28, 5.0)) * (1.0 - saturate(progress * 0.64));
  vec3 color = mix(iPreviousCursorColor.rgb, iCurrentCursorColor.rgb, progress);
  fragColor = addGlow(base, color, blade * 0.92 * iEffectIntensity);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  ripple: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.42);
  float radius = easeOutCubic(progress) * max(iCurrentCursor.w * 4.8, 72.0);
  float ringWidth = max(3.0, iCurrentCursor.w * 0.16);
  float ring = exp(-pow((distance(fragCoord, cur) - radius) / ringWidth, 2.0));
  float heart = exp(-distance(fragCoord, cur) / max(iCurrentCursor.w * 0.45, 8.0));
  float amount = (ring * (1.0 - progress) * 0.82 + heart * 0.34) * iEffectIntensity;
  fragColor = addGlow(base, iCurrentCursorColor.rgb, amount);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  rectripple: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.38);
  vec2 center = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 size = iCurrentCursor.zw + vec2(1.0) * easeOutCubic(progress) * max(iCurrentCursor.w * 3.2, 58.0);
  vec2 d = abs(fragCoord - center) - size * 0.5;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float ring = exp(-pow(outside / max(2.6, iCurrentCursor.w * 0.12), 2.0)) * (1.0 - progress);
  fragColor = addGlow(base, iCurrentCursorColor.rgb, ring * 0.95 * iEffectIntensity);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  rectboom: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.30);
  vec2 center = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 size = iCurrentCursor.zw + vec2(1.0) * easeOutQuart(progress) * max(iCurrentCursor.w * 2.1, 42.0);
  vec2 d = abs(fragCoord - center) - size * 0.5;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float fill = (1.0 - smoothstep(0.0, 2.0, outside)) * pow(1.0 - progress, 1.55);
  fragColor = addGlow(base, mix(iCurrentCursorColor.rgb, vec3(1.0), 0.20), fill * 0.72 * iEffectIntensity);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  sonic: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.36);
  float radius = easeOutQuart(progress) * max(iCurrentCursor.w * 5.6, 86.0);
  float disk = 1.0 - smoothstep(radius - max(8.0, iCurrentCursor.w * 0.35), radius, distance(fragCoord, cur));
  float shock = exp(-pow((distance(fragCoord, cur) - radius) / max(4.0, iCurrentCursor.w * 0.14), 2.0));
  float amount = (disk * 0.22 + shock * 0.88) * pow(1.0 - progress, 1.35) * iEffectIntensity;
  fragColor = addGlow(base, mix(iCurrentCursorColor.rgb, vec3(1.0), 0.28), amount);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  warp: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 d = fragCoord - cur;
  float r = length(d);
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float life = 1.0 - saturate(elapsed / 0.34);
  float lens = exp(-r / max(iCurrentCursor.w * 1.45, 24.0)) * life * iEffectIntensity;
  vec2 dir = r > 0.001 ? d / r : vec2(0.0);
  float swirl = sin(atan(d.y, d.x) * 4.0 + iTime * 9.0) * 0.5 + 0.5;
  vec2 warped = fragCoord - dir * lens * (18.0 + 10.0 * swirl);
  vec4 base = sampleCode(warped);
  float glow = exp(-r / max(iCurrentCursor.w * 0.8, 14.0)) * (0.25 + lens);
  fragColor = addGlow(base, mix(iCurrentCursorColor.rgb, vec3(1.0), 0.16), glow);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  blaze: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 base = sampleCode(fragCoord);
  vec2 cur = iCurrentCursor.xy + vec2(iCurrentCursor.z * 0.5, iCurrentCursor.w * 0.12);
  vec2 prev = iPreviousCursor.xy + iPreviousCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float life = 1.0 - saturate(elapsed / 0.46);
  float streak = exp(-sdSegment(fragCoord, prev, cur) / max(iCurrentCursor.w * 0.36, 7.0)) * life;
  float sparks = 0.0;
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    vec2 seed = vec2(fi * 17.13, iTimeCursorChange * 31.7 + fi);
    float angle = hash12(seed) * 6.2831853;
    float speed = mix(18.0, 120.0, hash12(seed + 7.0));
    vec2 offset = vec2(cos(angle), sin(angle)) * speed * elapsed;
    offset.y -= 90.0 * elapsed * elapsed;
    vec2 p = cur - offset;
    float size = mix(2.0, 7.0, hash12(seed + 13.0));
    sparks += exp(-dot(fragCoord - p, fragCoord - p) / max(size * size, 1.0)) * life;
  }
  vec3 hot = mix(iCurrentCursorColor.rgb, vec3(1.0, 0.76, 0.42), 0.55);
  fragColor = addGlow(base, hot, (streak * 0.74 + sparks * 0.82) * iEffectIntensity);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`,
  zoom: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 cur = iCurrentCursor.xy + iCurrentCursor.zw * 0.5;
  vec2 prev = iPreviousCursor.xy + iPreviousCursor.zw * 0.5;
  float elapsed = max(0.0, iTime - iTimeCursorChange);
  float progress = saturate(elapsed / 0.30);
  vec2 center = mix(prev, cur, 0.45);
  vec2 d = fragCoord - center;
  float r = length(d);
  float zone = exp(-r / max(iCurrentCursor.w * 1.7, 30.0)) * (1.0 - progress) * iEffectIntensity;
  vec2 source = center + d * (1.0 - zone * 0.36);
  float chroma = zone * 2.2;
  vec4 base = sampleCode(source);
  base.r = sampleCode(source + vec2(chroma, 0.0)).r;
  base.b = sampleCode(source - vec2(chroma, 0.0)).b;
  fragColor = addGlow(base, iCurrentCursorColor.rgb, zone * 0.38);
  fragColor = over(fragColor, cursorBase(fragCoord));
}
`
});

const codeShaderRuntime = {
  canvas: null,
  gl: null,
  program: null,
  buffer: null,
  uniforms: null,
  sourceCanvas: null,
  sourceContext: null,
  sourceTexture: null,
  shaderKey: "",
  raf: 0,
  startedAt: 0,
  frame: 0,
  lastTimestamp: 0,
  mouse: [0.55, 0.42, 2, 18],
  prevMouse: [0.55, 0.42, 2, 18],
  cursorBox: [24, 24, 2, 18],
  previousCursorBox: [24, 24, 2, 18],
  cursorColor: [0.66, 0.61, 1, 1],
  previousCursorColor: [0.66, 0.61, 1, 1],
  cursorStyle: CODE_CURSOR_STYLES.bar,
  previousCursorStyle: CODE_CURSOR_STYLES.bar,
  cursorChangeTime: 0,
  focusTime: 0,
  hasFocus: false,
  sourceDirty: true,
  cell: [8, 18],
  pulse: 0,
  lastInputAt: 0,
  lastCaretChangeAt: 0,
  caretPx: null,
  resizeObserver: null,
  cleanupPointer: null
};

function hexToRgba(hex, alpha = 1) {
  const m = String(hex || "").trim().match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbaToHex(value) {
  const m = String(value || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return "#000000";
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function presetPreviewGradient(preset) {
  return [
    `radial-gradient(ellipse 90% 70% at 20% 10%, ${preset.stopA}, transparent 60%)`,
    `radial-gradient(ellipse 80% 60% at 90% 90%, ${preset.stopB}, transparent 60%)`,
    `radial-gradient(ellipse 60% 50% at 50% 50%, ${preset.stopC}, transparent 62%)`,
    preset.base
  ].join(",");
}

function selectedThemePresetId() {
  const current = themeState?.preset || DEFAULT_THEME_PRESET_ID;
  if (current !== "custom") {
    return current;
  }
  const accent = String(themeState?.accent || "").toLowerCase();
  const match = THEME_PRESETS.find((preset) => String(preset.accent || "").toLowerCase() === accent);
  return match?.id || current;
}

function deriveThemeFromAccent(theme, accentHex) {
  const next = { ...(theme || {}) };
  next.accent = accentHex;
  next.accentHi = hexToRgba(accentHex, 1);
  next.stopA = hexToRgba(accentHex, 0.72);
  next.stopB = hexToRgba(accentHex, 0.42);
  next.stopC = hexToRgba(accentHex, 0.28);
  next.stopD = hexToRgba(accentHex, 0.32);
  next.stopE = hexToRgba(accentHex, 0.22);
  if (!next.tint || next.preset !== "custom") {
    next.tint = accentHex;
  }
  return next;
}

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  const set = (key, value) => { if (value) root.style.setProperty(key, value); };
  set("--acc", theme.accent);
  set("--acc-hi", theme.accentHi);
  if (theme.accent) {
    const lo = hexToRgba(theme.accent, 0.14);
    const glo = hexToRgba(theme.accent, 0.07);
    if (lo) set("--acc-lo", lo);
    if (glo) set("--acc-glo", glo);
  }
  set("--bg-stop-a", theme.stopA);
  set("--bg-stop-b", theme.stopB);
  set("--bg-stop-c", theme.stopC);
  set("--bg-stop-d", theme.stopD);
  set("--bg-stop-e", theme.stopE);
  set("--bg-base", theme.base);
  set("--glass-tint", theme.tint);
  if (Number.isFinite(theme.blur)) {
    set("--glass-blur", `${theme.blur}px`);
  }
  markCodeShaderTextureDirty();
  requestAnimationFrame(() => applyCodeShaderToEditor());
  requestAnimationFrame(() => {
    drawThroughputChart();
    drawSignalChart();
  });
}

function renderThemeGrid() {
  if (!elements.themeGrid) return;
  const current = selectedThemePresetId();
  elements.themeGrid.innerHTML = THEME_PRESETS.map((p) => `
    <button type="button" class="theme-card ${p.id === current ? "is-selected" : ""}"
            data-theme="${p.id}"
            style="--preview-bg: ${presetPreviewGradient(p)}">
      <span class="tc-mark">✓</span>
      <span class="tc-name">${p.name}</span>
      <span class="tc-sub">${p.sub}</span>
    </button>
  `).join("");
  elements.themeGrid.querySelectorAll("[data-theme]").forEach((node) => {
    node.addEventListener("click", () => {
      const preset = THEME_PRESETS.find((p) => p.id === node.dataset.theme);
      if (!preset) return;
      themeState = { ...preset, preset: preset.id };
      applyTheme(themeState);
      syncThemePickersFromState();
      elements.themeGrid.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("is-selected"));
      node.classList.add("is-selected");
    });
  });
}

function syncThemePickersFromState() {
  if (!themeState) return;
  const bindHex = (picker, text, value) => {
    if (picker) picker.value = value;
    if (text) text.value = value;
  };
  bindHex(elements.themeAccPicker, elements.themeAccText, themeState.accent || "#8a0000");
  bindHex(elements.themeBasePicker, elements.themeBaseText, themeState.base || "#080202");
  bindHex(elements.themeTintPicker, elements.themeTintText, themeState.tint || "#170505");
  bindHex(elements.themeStopAPicker, elements.themeStopAText, rgbaToHex(themeState.stopA));
  bindHex(elements.themeStopBPicker, elements.themeStopBText, rgbaToHex(themeState.stopB));
  if (elements.themeBlurSlider) elements.themeBlurSlider.value = String(themeState.blur ?? 30);
  if (elements.themeBlurValue) elements.themeBlurValue.textContent = `${themeState.blur ?? 30}px`;
}

function bindColorField(picker, text, onChange) {
  if (!picker || !text) return;
  const push = (value) => {
    const normalized = /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : /^#[0-9a-f]{3}$/i.test(value)
        ? "#" + value.slice(1).split("").map((c) => c + c).join("")
        : null;
    if (!normalized) return;
    picker.value = normalized;
    text.value = normalized;
    onChange(normalized);
  };
  picker.addEventListener("input", () => push(picker.value));
  text.addEventListener("change", () => push(text.value.trim()));
}

function initSettingsUI() {
  if (!elements.settingsTabs || elements.settingsTabs.dataset.ready === "true") {
    // continua mesmo se tabs já inicializado — os bindings de tema precisam ser idempotentes
  } else if (elements.settingsTabs) {
    elements.settingsTabs.dataset.ready = "true";
    elements.settingsTabs.querySelectorAll(".d-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const id = tab.dataset.tab;
        if (!id) return;
        elements.settingsTabs.querySelectorAll(".d-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        document.querySelectorAll(".settings-dialog .pane").forEach((pane) => {
          pane.classList.toggle("is-visible", pane.dataset.pane === id);
        });
        if (elements.settingsDialogTitle) {
          elements.settingsDialogTitle.textContent = tab.dataset.label || tab.textContent.trim();
        }
        if (elements.settingsPaneEyebrow) {
          const eyebrows = {
            general: "Runtime Hermes",
            aperant: "Kanban e multiagente",
            cloud: "Provider remoto",
            local: "Provider local",
            desktop: "Desktop bridge",
            appearance: "Tela e tema",
            advanced: "Diagnóstico"
          };
          elements.settingsPaneEyebrow.textContent = eyebrows[id] || "Controle";
        }
      });
    });
  }

  document.querySelectorAll(".settings-dialog .group:not([data-subtopic-ready])").forEach((group) => {
    group.dataset.subtopicReady = "true";
    const header = group.querySelector(".group-hd");
    if (!header) return;
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.addEventListener("click", (event) => {
      if (event.target.closest("button,input,select,textarea,a")) return;
      group.classList.toggle("is-collapsed");
    });
    header.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      group.classList.toggle("is-collapsed");
    });
  });

  if (elements.themeGrid && elements.themeGrid.dataset.ready !== "true") {
    elements.themeGrid.dataset.ready = "true";
    renderThemeGrid();
    bindColorField(elements.themeAccPicker, elements.themeAccText, (hex) => {
      themeState = deriveThemeFromAccent(themeState, hex);
      themeState.preset = "custom";
      applyTheme(themeState);
      syncThemePickersFromState();
      updateCustomSelection();
    });
    bindColorField(elements.themeBasePicker, elements.themeBaseText, (hex) => {
      themeState = themeState || {};
      themeState.base = hex;
      themeState.preset = "custom";
      applyTheme(themeState);
      updateCustomSelection();
    });
    bindColorField(elements.themeTintPicker, elements.themeTintText, (hex) => {
      themeState = themeState || {};
      themeState.tint = hex;
      themeState.preset = "custom";
      applyTheme(themeState);
      updateCustomSelection();
    });
    bindColorField(elements.themeStopAPicker, elements.themeStopAText, (hex) => {
      themeState = themeState || {};
      themeState.stopA = hexToRgba(hex, 0.80);
      themeState.stopD = hexToRgba(hex, 0.45);
      themeState.preset = "custom";
      applyTheme(themeState);
      updateCustomSelection();
    });
    bindColorField(elements.themeStopBPicker, elements.themeStopBText, (hex) => {
      themeState = themeState || {};
      themeState.stopB = hexToRgba(hex, 0.75);
      themeState.stopE = hexToRgba(hex, 0.45);
      themeState.preset = "custom";
      applyTheme(themeState);
      updateCustomSelection();
    });
    if (elements.themeBlurSlider) {
      elements.themeBlurSlider.addEventListener("input", () => {
        const v = Number(elements.themeBlurSlider.value) || 30;
        themeState = themeState || {};
        themeState.blur = v;
        if (elements.themeBlurValue) elements.themeBlurValue.textContent = `${v}px`;
        applyTheme(themeState);
      });
    }
    if (elements.themeResetButton) {
      elements.themeResetButton.addEventListener("click", () => {
        const preset = THEME_PRESETS.find((item) => item.id === DEFAULT_THEME_PRESET_ID) || THEME_PRESETS[0];
        themeState = { ...preset, preset: preset.id };
        applyTheme(themeState);
        syncThemePickersFromState();
        renderThemeGrid();
      });
    }
  }
  bindCodeShaderSettings();
}

function updateCustomSelection() {
  if (!elements.themeGrid) return;
  elements.themeGrid.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("is-selected"));
}

function hydrateThemeFromState() {
  const savedTheme = state.app?.settings?.theme;
  if (savedTheme && !(savedTheme.preset === "roxo" && savedTheme.accent === "#7c6cfc")) {
    themeState = { ...savedTheme };
  } else if (!themeState) {
    const preset = THEME_PRESETS.find((item) => item.id === DEFAULT_THEME_PRESET_ID) || THEME_PRESETS[0];
    themeState = { ...preset, preset: preset.id };
  }
  applyTheme(themeState);
  if (elements.themeGrid?.dataset.ready === "true") {
    // se a grid já foi renderizada antes, só atualiza seleção + pickers
    const current = selectedThemePresetId();
    elements.themeGrid.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.theme === current);
    });
    syncThemePickersFromState();
  }
  applyCodeShaderSettings(state.app?.settings || {});
  requestAnimationFrame(() => applyCodeShaderToEditor());
}

function parseCssColorToRgb01(value, fallback = [0.49, 0.42, 0.99]) {
  const text = String(value || "").trim();
  const hex = text.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3) {
      raw = raw.split("").map((c) => c + c).join("");
    }
    return [
      parseInt(raw.slice(0, 2), 16) / 255,
      parseInt(raw.slice(2, 4), 16) / 255,
      parseInt(raw.slice(4, 6), 16) / 255
    ];
  }

  const rgba = text.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const parts = rgba[1].split(/[\s,\/]+/).map((part) => Number(part)).filter((part) => Number.isFinite(part));
    if (parts.length >= 3) {
      return [
        Math.max(0, Math.min(255, parts[0])) / 255,
        Math.max(0, Math.min(255, parts[1])) / 255,
        Math.max(0, Math.min(255, parts[2])) / 255
      ];
    }
  }

  return fallback;
}

function currentCodeShaderSettings(settings = state.app?.settings || {}) {
  const rawPreset = String(settings.codeShaderPreset ?? settings.preset ?? "bar").toLowerCase();
  const preset = LEGACY_CODE_SHADER_PRESETS[rawPreset] || rawPreset;
  const cursor = String(settings.codeCursorShader ?? settings.cursor ?? "blaze").toLowerCase();
  const intensity = Math.max(0, Math.min(100, Number(settings.codeShaderIntensity ?? settings.intensity ?? 100)));
  const enabled = settings.codeShaderForceOn === true
    ? true
    : settings.codeShaderEnabled === undefined
      ? settings.enabled !== false
      : settings.codeShaderEnabled !== false;
  return {
    enabled,
    preset: CODE_SHADER_PRESETS[preset] === undefined ? "bar" : preset,
    cursor: CODE_CURSOR_SHADERS[cursor] === undefined ? "blaze" : cursor,
    intensity
  };
}

function collectCodeShaderPayload(fallback = {}) {
  const settings = currentCodeShaderSettings(fallback);
  const rawPreset = fieldValue(elements.codeShaderPresetInput, settings.preset).toLowerCase();
  const preset = LEGACY_CODE_SHADER_PRESETS[rawPreset] || rawPreset;
  const cursor = fieldValue(elements.codeCursorShaderInput, settings.cursor).toLowerCase();
  const rawIntensity = Number(fieldValue(elements.codeShaderIntensityInput, settings.intensity));
  const intensity = Number.isFinite(rawIntensity)
    ? Math.max(0, Math.min(100, rawIntensity))
    : settings.intensity;
  return {
    codeShaderEnabled: fieldChecked(elements.codeShaderEnabledInput, settings.enabled),
    codeShaderPreset: CODE_SHADER_PRESETS[preset] === undefined ? settings.preset : preset,
    codeCursorShader: CODE_CURSOR_SHADERS[cursor] === undefined ? settings.cursor : cursor,
    codeShaderIntensity: intensity
  };
}

function syncCodeShaderControls(settings = state.app?.settings || {}) {
  const shader = currentCodeShaderSettings(settings);
  setCheckedIfPresent(elements.codeShaderEnabledInput, shader.enabled);
  setValueIfIdle(elements.codeShaderPresetInput, shader.preset);
  setValueIfIdle(elements.codeCursorShaderInput, shader.cursor);
  setValueIfIdle(elements.codeShaderIntensityInput, shader.intensity);
  if (elements.codeShaderIntensityValue) {
    elements.codeShaderIntensityValue.textContent = `${shader.intensity}%`;
  }
}

let codeShaderSettingsSaveTimer = 0;
let codeShaderSettingsSaveSerial = 0;

function scheduleCodeShaderSettingsSave() {
  if (!window.manusDesktop?.saveSettings) {
    return;
  }
  const serial = ++codeShaderSettingsSaveSerial;
  window.clearTimeout(codeShaderSettingsSaveTimer);
  codeShaderSettingsSaveTimer = window.setTimeout(async () => {
    try {
      const savedApp = await window.manusDesktop.saveSettings(collectSettingsPayload());
      if (serial === codeShaderSettingsSaveSerial) {
        state.app = savedApp;
        const savedSettings = state.app?.settings || {};
        syncCodeShaderControls(savedSettings);
        applyCodeShaderSettings(savedSettings);
        applyCodeShaderToEditor();
      }
    } catch (error) {
      console.warn("Could not persist code shader settings:", error);
    }
  }, 220);
}

function bindCodeShaderSettings() {
  const marker = elements.codeShaderPresetInput || elements.codeShaderEnabledInput;
  if (!marker || marker.dataset.ready === "true") {
    return;
  }
  marker.dataset.ready = "true";

  const update = () => {
    const settings = {
      ...(state.app?.settings || {}),
      ...collectCodeShaderPayload(state.app?.settings || {})
    };
    state.app = {
      ...(state.app || {}),
      settings
    };
    applyCodeShaderSettings(settings);
    applyCodeShaderToEditor();
    scheduleCodeShaderSettingsSave();
  };

  [
    elements.codeShaderEnabledInput,
    elements.codeShaderPresetInput,
    elements.codeCursorShaderInput
  ].forEach((element) => element?.addEventListener("change", update));

  elements.codeShaderIntensityInput?.addEventListener("input", () => {
    if (elements.codeShaderIntensityValue) {
      elements.codeShaderIntensityValue.textContent = `${elements.codeShaderIntensityInput.value}%`;
    }
    update();
  });
}

function getThemeUniformColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: parseCssColorToRgb01(styles.getPropertyValue("--acc"), [0.49, 0.42, 0.99]),
    accentHi: parseCssColorToRgb01(styles.getPropertyValue("--acc-hi"), [0.66, 0.61, 1.0]),
    base: parseCssColorToRgb01(styles.getPropertyValue("--bg-base"), [0.02, 0.02, 0.05])
  };
}

function getGhosttyCodeUniformColors() {
  return {
    background: [15 / 255, 15 / 255, 14 / 255],
    foreground: [232 / 255, 226 / 255, 204 / 255],
    cursor: [230 / 255, 199 / 255, 110 / 255],
    cursorText: [15 / 255, 15 / 255, 14 / 255],
    selectionBackground: [69 / 255, 80 / 255, 82 / 255],
    selectionForeground: [244 / 255, 239 / 255, 219 / 255]
  };
}

function codeShaderCursorUniformColor() {
  return [230 / 255, 199 / 255, 110 / 255, 1];
}

function applyCodeShaderSettings(settings = state.app?.settings || {}) {
  const shader = currentCodeShaderSettings({ ...settings, codeShaderForceOn: true });
  const opacity = shader.enabled ? 1 : 0;
  document.documentElement.style.setProperty("--code-shader-opacity", opacity.toFixed(2));
  codeShaderRuntime.settings = shader;
  codeShaderRuntime.cursorStyle = CODE_CURSOR_STYLES[shader.preset] ?? CODE_CURSOR_STYLES.bar;
  markCodeShaderTextureDirty();
  const editor = elements.codeSurface?.querySelector(".code-editor");
  const canvas = elements.codeSurface?.querySelector("[data-code-shader]");
  editor?.classList.toggle("code-shader-enabled", shader.enabled);
  if (canvas) {
    canvas.hidden = !shader.enabled;
  }
}

function compileCodeShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function readExternalCodeShaderSource(cursorShader = "blaze") {
  const shaderFile = CODE_GHOSTTY_SHADER_FILES[cursorShader];
  if (!shaderFile) {
    return "";
  }
  if (codeGhosttyShaderSourceCache.has(cursorShader)) {
    return codeGhosttyShaderSourceCache.get(cursorShader);
  }
  try {
    const xhr = new XMLHttpRequest();
    const url = new URL(`./shaders/ghostty/${shaderFile}`, document.baseURI);
    xhr.open("GET", url.href, false);
    xhr.send(null);
    const ok = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300);
    let source = ok
      ? String(xhr.responseText || "").replace(/vec4\s+TRAIL_COLOR\s*=\s*iCurrentCursorColor\s*;\s*(?:\/\/[^\n]*)?/g, "#define TRAIL_COLOR iCurrentCursorColor")
      : "";
    if (/\bvec2\s+normalize\s*\(\s*vec2\s+value\s*,\s*float\s+isPosition\s*\)/.test(source)) {
      source = source.replace(/\bnormalize\s*\(/g, "cursorNormalize(");
    }
    source = source.replace("vec2 direction = norm(end - start);", "vec2 direction = normalize(end - start);");
    codeGhosttyShaderSourceCache.set(cursorShader, source);
    return source;
  } catch (error) {
    console.warn("Could not load Ghostty shader source:", shaderFile, error);
    codeGhosttyShaderSourceCache.set(cursorShader, "");
    return "";
  }
}

function codeShaderFragmentSource(cursorShader = "blaze") {
  const externalSource = readExternalCodeShaderSource(cursorShader);
  if (externalSource) {
    return `${codeGhosttyExternalShaderPrefix(cursorShader)}\n${externalSource}\n${CODE_GHOSTTY_EXTERNAL_SHADER_FOOTER}`;
  }
  const source = CODE_GHOSTTY_SHADER_SOURCES[cursorShader] || CODE_GHOSTTY_SHADER_SOURCES.blaze || CODE_GHOSTTY_SHADER_SOURCES.tail;
  return `${CODE_GHOSTTY_SHADER_PREFIX}\n${source}`;
}

function createCodeShaderProgram(gl, cursorShader = "blaze") {
  const vertexShader = compileCodeShader(gl, gl.VERTEX_SHADER, CODE_SHADER_VERTEX_SOURCE);
  const fragmentShader = compileCodeShader(gl, gl.FRAGMENT_SHADER, codeShaderFragmentSource(cursorShader));
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "shader link failed";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

function codeShaderUniformLocations(gl, program) {
  return {
    position: gl.getAttribLocation(program, "a_position"),
    channel0: gl.getUniformLocation(program, "iChannel0"),
    resolution: gl.getUniformLocation(program, "iResolution"),
    time: gl.getUniformLocation(program, "iTime"),
    timeDelta: gl.getUniformLocation(program, "iTimeDelta"),
    frame: gl.getUniformLocation(program, "iFrame"),
    channelResolution0: gl.getUniformLocation(program, "iChannelResolution[0]"),
    mouse: gl.getUniformLocation(program, "iMouse"),
    currentCursor: gl.getUniformLocation(program, "iCurrentCursor"),
    previousCursor: gl.getUniformLocation(program, "iPreviousCursor"),
    currentCursorColor: gl.getUniformLocation(program, "iCurrentCursorColor"),
    previousCursorColor: gl.getUniformLocation(program, "iPreviousCursorColor"),
    currentCursorStyle: gl.getUniformLocation(program, "iCurrentCursorStyle"),
    previousCursorStyle: gl.getUniformLocation(program, "iPreviousCursorStyle"),
    cursorVisible: gl.getUniformLocation(program, "iCursorVisible"),
    timeCursorChange: gl.getUniformLocation(program, "iTimeCursorChange"),
    timeFocus: gl.getUniformLocation(program, "iTimeFocus"),
    focus: gl.getUniformLocation(program, "iFocus"),
    backgroundColor: gl.getUniformLocation(program, "iBackgroundColor"),
    foregroundColor: gl.getUniformLocation(program, "iForegroundColor"),
    cursorColor: gl.getUniformLocation(program, "iCursorColor"),
    cursorText: gl.getUniformLocation(program, "iCursorText"),
    selectionBackgroundColor: gl.getUniformLocation(program, "iSelectionBackgroundColor"),
    selectionForegroundColor: gl.getUniformLocation(program, "iSelectionForegroundColor"),
    effectIntensity: gl.getUniformLocation(program, "iEffectIntensity")
  };
}

function setUniform1f(gl, location, value) {
  if (location !== null && location !== undefined) gl.uniform1f(location, value);
}

function setUniform1i(gl, location, value) {
  if (location !== null && location !== undefined) gl.uniform1i(location, value);
}

function setUniform3f(gl, location, a, b, c) {
  if (location !== null && location !== undefined) gl.uniform3f(location, a, b, c);
}

function setUniform4fv(gl, location, value) {
  if (location !== null && location !== undefined) gl.uniform4fv(location, value);
}

function currentCodeShaderTime() {
  if (!codeShaderRuntime.startedAt) return 0;
  return Math.max(0, (performance.now() - codeShaderRuntime.startedAt) / 1000);
}

function markCodeShaderTextureDirty() {
  codeShaderRuntime.sourceDirty = true;
}

function resizeCodeShaderCanvas() {
  const { canvas, gl } = codeShaderRuntime;
  if (!canvas || !gl) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    markCodeShaderTextureDirty();
  }
  gl.viewport(0, 0, width, height);
}

function ensureCodeShaderSourceCanvas() {
  if (!codeShaderRuntime.sourceCanvas) {
    codeShaderRuntime.sourceCanvas = document.createElement("canvas");
    codeShaderRuntime.sourceContext = codeShaderRuntime.sourceCanvas.getContext("2d", { alpha: true });
  }
  return codeShaderRuntime.sourceCanvas;
}

const CODE_SHADER_CANVAS_TOKEN_COLORS = Object.freeze({
  "tok-keyword": "#e6c76e",
  "tok-string": "#8ec07c",
  "tok-template": "#8ec07c",
  "tok-number": "#d79967",
  "tok-comment": "#7c7769",
  "tok-function": "#83a598",
  "tok-tag": "#d3869b",
  "tok-attr": "#fabd2f",
  "tok-property": "#b8bb26",
  "tok-selector": "#d3869b",
  "tok-operator": "#d5c4a1",
  "tok-punctuation": "#d5c4a1",
  "tok-variable": "#ebdbb2",
  "tok-heading": "#e6c76e",
  "tok-link": "#83a598",
  "tok-diff-add": "#8ec07c",
  "tok-diff-del": "#fb4934",
  "tok-diff-hunk": "#e6c76e"
});

function codeShaderCanvasTokenColor(className = "") {
  const classes = String(className || "").split(/\s+/).filter(Boolean);
  for (const name of classes) {
    if (CODE_SHADER_CANVAS_TOKEN_COLORS[name]) {
      return CODE_SHADER_CANVAS_TOKEN_COLORS[name];
    }
  }
  return "";
}

function drawCodeShaderHighlightedLine(ctx, text, language, x, y, maxWidth) {
  const template = drawCodeShaderHighlightedLine.template || (drawCodeShaderHighlightedLine.template = document.createElement("template"));
  template.innerHTML = highlightCode(text || " ", language) || " ";
  let cursorX = x;
  const maxX = x + maxWidth;

  const drawNode = (node, inheritedColor) => {
    if (cursorX > maxX) {
      return;
    }
    if (node.nodeType === 3) {
      const rawText = node.nodeValue || "";
      if (!rawText) {
        return;
      }
      const drawableText = rawText.replace(/\t/g, "  ");
      ctx.fillStyle = inheritedColor;
      ctx.fillText(drawableText, cursorX, y);
      cursorX += ctx.measureText(drawableText).width;
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const color = codeShaderCanvasTokenColor(node.className) || inheritedColor;
    node.childNodes.forEach((child) => drawNode(child, color));
  };

  template.content.childNodes.forEach((child) => drawNode(child, "#e8e2cc"));
}

function drawCodeShaderSourceTexture(input) {
  const { canvas } = codeShaderRuntime;
  if (!canvas) return null;

  const sourceCanvas = ensureCodeShaderSourceCanvas();
  const ctx = codeShaderRuntime.sourceContext;
  if (!ctx) return null;

  if (sourceCanvas.width !== canvas.width || sourceCanvas.height !== canvas.height) {
    sourceCanvas.width = canvas.width;
    sourceCanvas.height = canvas.height;
  }

  const dprX = canvas.width / Math.max(1, canvas.getBoundingClientRect().width || canvas.width);
  const dprY = canvas.height / Math.max(1, canvas.getBoundingClientRect().height || canvas.height);
  const value = input?.value || "";
  const inputStyle = input ? getComputedStyle(input) : null;
  const paddingLeft = inputStyle ? (parseFloat(inputStyle.paddingLeft) || 0) * dprX : 14 * dprX;
  const paddingTop = inputStyle ? (parseFloat(inputStyle.paddingTop) || 0) * dprY : 14 * dprY;
  const lineHeightCss = inputStyle ? parseFloat(inputStyle.lineHeight) || 18 : 18;
  const lineHeight = lineHeightCss * dprY;
  const scrollTop = (input?.scrollTop || 0) * dprY;
  const scrollLeft = (input?.scrollLeft || 0) * dprX;
  const fontSize = inputStyle ? (parseFloat(inputStyle.fontSize) || 12) * dprY : 12 * dprY;
  const fontFamily = inputStyle?.fontFamily || "\"Dream JetBrains Mono\", \"JetBrains Mono\", Consolas, monospace";
  const fontWeight = inputStyle?.fontWeight || "400";
  const language = input?.dataset.language || "text";
  const lines = value.split("\n");
  const firstLine = Math.max(0, Math.floor(Math.max(0, scrollTop - paddingTop) / Math.max(1, lineHeight)) - 2);
  const visibleCount = Math.ceil(canvas.height / Math.max(1, lineHeight)) + 4;
  const lastLine = Math.min(lines.length, firstLine + visibleCount);

  ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.fillStyle = "rgba(15, 15, 14, 0.985)";
  ctx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "rgba(232, 226, 204, 0.045)";
  ctx.lineWidth = Math.max(1, dprY);
  for (let y = -scrollTop % lineHeight; y < sourceCanvas.height; y += lineHeight) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(sourceCanvas.width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";
  ctx.globalAlpha = 0.94;
  for (let index = firstLine; index < lastLine; index += 1) {
    const y = paddingTop + index * lineHeight - scrollTop;
    const text = lines[index] || " ";
    drawCodeShaderHighlightedLine(ctx, text, language, paddingLeft - scrollLeft, y, sourceCanvas.width * 1.8);
  }
  ctx.globalAlpha = 1;

  return sourceCanvas;
}

function uploadCodeShaderSourceTexture(input) {
  const { gl } = codeShaderRuntime;
  if (!gl) return null;
  const sourceCanvas = drawCodeShaderSourceTexture(input);
  if (!sourceCanvas) return null;

  if (!codeShaderRuntime.sourceTexture) {
    codeShaderRuntime.sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, codeShaderRuntime.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, codeShaderRuntime.sourceTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
  codeShaderRuntime.sourceDirty = false;
  return codeShaderRuntime.sourceTexture;
}

function disposeCodeShaderRuntime() {
  elements.codeSurface?.querySelector(".code-editor-stack")?.classList.remove("is-shader-active");
  if (codeShaderRuntime.raf) {
    cancelAnimationFrame(codeShaderRuntime.raf);
  }
  codeShaderRuntime.raf = 0;
  codeShaderRuntime.resizeObserver?.disconnect?.();
  codeShaderRuntime.resizeObserver = null;
  codeShaderRuntime.cleanupPointer?.();
  codeShaderRuntime.cleanupPointer = null;
  if (codeShaderRuntime.gl) {
    if (codeShaderRuntime.buffer) {
      codeShaderRuntime.gl.deleteBuffer(codeShaderRuntime.buffer);
    }
    if (codeShaderRuntime.program) {
      codeShaderRuntime.gl.deleteProgram(codeShaderRuntime.program);
    }
    if (codeShaderRuntime.sourceTexture) {
      codeShaderRuntime.gl.deleteTexture(codeShaderRuntime.sourceTexture);
    }
  }
  codeShaderRuntime.canvas = null;
  codeShaderRuntime.gl = null;
  codeShaderRuntime.program = null;
  codeShaderRuntime.buffer = null;
  codeShaderRuntime.uniforms = null;
  codeShaderRuntime.sourceTexture = null;
  codeShaderRuntime.shaderKey = "";
  codeShaderRuntime.startedAt = 0;
  codeShaderRuntime.frame = 0;
  codeShaderRuntime.lastTimestamp = 0;
  codeShaderRuntime.pulse = 0;
  codeShaderRuntime.lastInputAt = 0;
  codeShaderRuntime.lastCaretChangeAt = 0;
  codeShaderRuntime.caretPx = null;
  codeShaderRuntime.prevMouse = codeShaderRuntime.mouse || [0.55, 0.42];
  codeShaderRuntime.sourceDirty = true;
}

function rebuildCodeShaderProgram(cursorShader = "blaze") {
  const { gl } = codeShaderRuntime;
  if (!gl) return false;
  try {
    const program = createCodeShaderProgram(gl, cursorShader);
    if (codeShaderRuntime.program) {
      gl.deleteProgram(codeShaderRuntime.program);
    }
    codeShaderRuntime.program = program;
    codeShaderRuntime.uniforms = codeShaderUniformLocations(gl, program);
    codeShaderRuntime.shaderKey = cursorShader;
    markCodeShaderTextureDirty();
    return true;
  } catch (error) {
    console.warn("Code shader disabled:", error);
    return false;
  }
}

function mountCodeShader(canvas, cursorShader = "blaze") {
  disposeCodeShaderRuntime();
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false
  });
  if (!gl) {
    canvas.hidden = true;
    return false;
  }

  try {
    const program = createCodeShaderProgram(gl, cursorShader);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1
    ]), gl.STATIC_DRAW);

    codeShaderRuntime.canvas = canvas;
    codeShaderRuntime.gl = gl;
    codeShaderRuntime.program = program;
    codeShaderRuntime.buffer = buffer;
    codeShaderRuntime.uniforms = codeShaderUniformLocations(gl, program);
    codeShaderRuntime.shaderKey = cursorShader;

    // Intentionally no pointer-move listener: the caret position is driven by
    // real editing events (keydown, input, selectionchange, click, focus) via
    // updateCodeShaderFromCaret. Letting the pointer also drive iCurrentCursor made the
    // cursor effect slide away from the real textarea caret — the "weird thing"
    // that used to appear. Upstream ghostty shaders also follow only the real
    // terminal cursor, not the pointer.
    codeShaderRuntime.cleanupPointer = null;
    codeShaderRuntime.resizeObserver = new ResizeObserver(() => {
      resizeCodeShaderCanvas();
      updateCodeShaderFromCaret(elements.codeSurface?.querySelector(".code-input"), { pulse: false });
    });
    codeShaderRuntime.resizeObserver.observe(canvas);
    resizeCodeShaderCanvas();
    return true;
  } catch (error) {
    console.warn("Code shader disabled:", error);
    canvas.hidden = true;
    disposeCodeShaderRuntime();
    return false;
  }
}

function renderCodeShaderFrame(timestamp) {
  const { canvas, gl, program, buffer, uniforms } = codeShaderRuntime;
  if (!canvas || !gl || !program || !buffer || !uniforms || canvas.hidden) {
    elements.codeSurface?.querySelector(".code-editor-stack")?.classList.remove("is-shader-active");
    codeShaderRuntime.raf = 0;
    return;
  }
  const shader = currentCodeShaderSettings({
    ...(state.app?.settings || {}),
    ...(codeShaderRuntime.settings || {}),
    codeShaderForceOn: true
  });
  if (!shader.enabled) {
    elements.codeSurface?.querySelector(".code-editor-stack")?.classList.remove("is-shader-active");
    codeShaderRuntime.raf = 0;
    return;
  }

  if (!codeShaderRuntime.startedAt) {
    codeShaderRuntime.startedAt = timestamp;
    codeShaderRuntime.focusTime = 0;
  }
  resizeCodeShaderCanvas();
  const colors = getGhosttyCodeUniformColors();
  const time = (timestamp - codeShaderRuntime.startedAt) / 1000;
  const delta = codeShaderRuntime.lastTimestamp
    ? Math.max(0, Math.min(0.1, (timestamp - codeShaderRuntime.lastTimestamp) / 1000))
    : 0;
  codeShaderRuntime.lastTimestamp = timestamp;
  if (codeShaderRuntime.lastInputAt) {
    const age = Math.max(0, (performance.now() - codeShaderRuntime.lastInputAt) / 1000);
    codeShaderRuntime.pulse = Math.max(0, codeShaderRuntime.pulse * 0.92 - age * 0.002);
  }
  const stack = elements.codeSurface?.querySelector(".code-editor-stack");
  const shaderActive = shader.cursor !== "none";
  stack?.classList.toggle("is-shader-active", shaderActive);
  const currentCursorColor = codeShaderCursorUniformColor(shader.cursor, time);
  codeShaderRuntime.cursorColor = currentCursorColor;

  const input = elements.codeSurface?.querySelector(".code-input");
  if (codeShaderRuntime.sourceDirty || !codeShaderRuntime.sourceTexture) {
    uploadCodeShaderSourceTexture(input);
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(uniforms.position);
  gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, codeShaderRuntime.sourceTexture);
  setUniform1i(gl, uniforms.channel0, 0);
  setUniform3f(gl, uniforms.resolution, canvas.width, canvas.height, 1);
  setUniform1f(gl, uniforms.time, time);
  setUniform1f(gl, uniforms.timeDelta, delta);
  setUniform1i(gl, uniforms.frame, codeShaderRuntime.frame++);
  setUniform3f(gl, uniforms.channelResolution0, canvas.width, canvas.height, 1);
  setUniform4fv(gl, uniforms.mouse, [0, 0, 0, 0]);
  setUniform4fv(gl, uniforms.currentCursor, codeShaderRuntime.cursorBox);
  setUniform4fv(gl, uniforms.previousCursor, codeShaderRuntime.previousCursorBox);
  setUniform4fv(gl, uniforms.currentCursorColor, currentCursorColor);
  setUniform4fv(gl, uniforms.previousCursorColor, codeShaderRuntime.previousCursorColor);
  setUniform1i(gl, uniforms.currentCursorStyle, codeShaderRuntime.cursorStyle);
  setUniform1i(gl, uniforms.previousCursorStyle, codeShaderRuntime.previousCursorStyle);
  setUniform1i(gl, uniforms.cursorVisible, 1);
  setUniform1f(gl, uniforms.timeCursorChange, codeShaderRuntime.cursorChangeTime);
  setUniform1f(gl, uniforms.timeFocus, codeShaderRuntime.focusTime);
  setUniform1i(gl, uniforms.focus, codeShaderRuntime.hasFocus ? 1 : 0);
  setUniform3f(gl, uniforms.backgroundColor, colors.background[0], colors.background[1], colors.background[2]);
  setUniform3f(gl, uniforms.foregroundColor, colors.foreground[0], colors.foreground[1], colors.foreground[2]);
  setUniform3f(gl, uniforms.cursorColor, currentCursorColor[0], currentCursorColor[1], currentCursorColor[2]);
  setUniform3f(gl, uniforms.cursorText, colors.cursorText[0], colors.cursorText[1], colors.cursorText[2]);
  setUniform3f(gl, uniforms.selectionBackgroundColor, colors.selectionBackground[0], colors.selectionBackground[1], colors.selectionBackground[2]);
  setUniform3f(gl, uniforms.selectionForegroundColor, colors.selectionForeground[0], colors.selectionForeground[1], colors.selectionForeground[2]);
  setUniform1f(gl, uniforms.effectIntensity, Math.max(0, Math.min(1, shader.intensity / 100)));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  codeShaderRuntime.raf = requestAnimationFrame(renderCodeShaderFrame);
}

function startCodeShaderLoop() {
  if (!codeShaderRuntime.raf) {
    codeShaderRuntime.raf = requestAnimationFrame(renderCodeShaderFrame);
  }
}

function applyCodeShaderToEditor() {
  const canvas = elements.codeSurface?.querySelector("[data-code-shader]");
  const editor = elements.codeSurface?.querySelector(".code-editor");
  const shader = currentCodeShaderSettings({
    ...(state.app?.settings || {}),
    ...(codeShaderRuntime.settings || {}),
    codeShaderForceOn: true
  });
  editor?.classList.toggle("code-shader-enabled", shader.enabled);
  if (!canvas || !editor) {
    stopCodeShader();
    return;
  }
  canvas.hidden = !shader.enabled;
  codeShaderRuntime.settings = shader;
  if (!shader.enabled) {
    stopCodeShader(false);
    return;
  }
  if (codeShaderRuntime.canvas !== canvas && !mountCodeShader(canvas, shader.cursor)) {
    return;
  }
  if (codeShaderRuntime.canvas === canvas && codeShaderRuntime.shaderKey !== shader.cursor && !rebuildCodeShaderProgram(shader.cursor)) {
    canvas.hidden = true;
    return;
  }
  updateCodeShaderFromCaret(elements.codeSurface?.querySelector(".code-input"), { pulse: false });
  resizeCodeShaderCanvas();
  startCodeShaderLoop();
}

function stopCodeShader(dispose = true) {
  elements.codeSurface?.querySelector(".code-editor-stack")?.classList.remove("is-shader-active");
  if (dispose) {
    disposeCodeShaderRuntime();
    return;
  }
  if (codeShaderRuntime.raf) {
    cancelAnimationFrame(codeShaderRuntime.raf);
  }
  codeShaderRuntime.raf = 0;
}

function mountSettingsModal() {
  // v5: tudo já vive dentro do modal desde o boot.
  // Mantido como stub para não quebrar chamadas existentes.
  initSettingsUI();
}

function openSettingsModal() {
  if (!elements.settingsModal) {
    return;
  }
  initSettingsUI();
  elements.settingsModal.hidden = false;
  document.body.classList.add("settings-open");
  hydrateSettings(true);
  hydrateThemeFromState();
  requestAnimationFrame(() => {
    elements.settingsModal?.querySelector("input,select,textarea,button")?.focus?.();
  });
}

async function closeSettingsModal(options = {}) {
  if (!elements.settingsModal) {
    return;
  }
  const persist = options?.persist !== false;
  if (persist && state.app && window.manusDesktop?.saveSettings) {
    try {
      state.app = await window.manusDesktop.saveSettings(collectSettingsPayload());
    } catch (error) {
      showToast(error.message || "Nao consegui salvar as configuracoes.");
      return;
    }
  }
  elements.settingsModal.hidden = true;
  document.body.classList.remove("settings-open");
  renderAll({ forceSettings: true });
}

function renderAll(options = {}) {
  if (!state.app) {
    return;
  }
  ensurePreviewHarnessChatScope();
  syncPreviewDeviceModeFromApp();
  renderShell();
  renderSidebar();
  renderHeader();
  renderTranscript();
  renderAppSurface();
  renderWorkbenchPanel();
  renderRouteFeed();
  renderLspFeed();
  renderProjectFeed();
  renderTodoFeed();
  renderTaskFeed();
  renderAgentFeed();
  renderActionFeed();
  renderTerminalFeed();
  renderBackgroundFeed();
  renderMcpFeed();
  renderComposerAttachments();
  renderLocalModels();
  renderSupportedApps();
  renderHermesCatalog();
  hydrateSettings(Boolean(options.forceSettings));
  const chat = currentChat();
  const canStop = state.stopping || state.busy || String(chat?.status || "").toLowerCase() === "running";
  elements.stopButton.hidden = !canStop;
  elements.stopButton.disabled = state.stopping;
  elements.sendButton.hidden = canStop;
  elements.sendButton.disabled = state.busy || state.stopping;
  // Show/hide thinking indicator
  setThinkingVisible(state.busy || state.stopping);
  scheduleAutoRun();
  scheduleAperantLiveRefresh();
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.hidden = false;
  elements.toast.textContent = message;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function setThinkingVisible(visible) {
  const active = Boolean(visible);
  document.documentElement.classList.toggle("is-thinking", active);
  elements.appShell?.classList.toggle("is-thinking", active);
  if (elements.thinkingIndicator) {
    elements.thinkingIndicator.hidden = !active;
  }
}

function scheduleRuntimeRefresh(event) {
  rememberRuntimeActivity(event);
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(async () => {
    try {
      state.app = await window.manusDesktop.loadState();
      renderAll();
      if (event?.event?.type === "error") {
        showToast(event.event.message || "Falha na sessao.");
      }
    } catch (error) {
      showToast(error.message || "Falha ao atualizar a conversa.");
    }
  }, event?.event?.type === "text_delta" ? 50 : 10);
}

function scheduleAperantLiveRefresh() {
  clearTimeout(state.liveRefreshTimer);
  if (!hasAperantLiveActivity()) {
    return;
  }
  state.liveRefreshTimer = setTimeout(async () => {
    try {
      state.app = await window.manusDesktop.loadState();
      state.renderCache.kanban = "";
      state.renderCache.multiAgents = "";
      state.renderCache.multiTerminals = "";
      renderAll();
      await processKanbanQueue();
    } catch (error) {
      showToast(error.message || "Falha ao sincronizar Aperant.");
    }
  }, state.kanbanQueueActive ? 900 : 1800);
}

async function runAction(actionKey) {
  const chat = currentChat();
  const action = state.actionRegistry.get(actionKey);
  if (!chat || !action || state.runningActions.has(actionKey)) {
    return;
  }

  state.runningActions.add(actionKey);
  renderAll();
  try {
    const result = await window.manusDesktop.runDesktopAction({
      chatId: chat.id,
      actionKey,
      action
    });
    state.app = result.state;
    showToast(result.message);
  } catch (error) {
    showToast(error.message || "Falha ao executar a acao local.");
  } finally {
    state.runningActions.delete(actionKey);
    renderAll();
  }
}

async function ensureActionChat() {
  let chat = currentChat();
  if (chat) {
    return chat;
  }
  state.app = await window.manusDesktop.createChat();
  chat = currentChat();
  if (!chat) {
    throw new Error("Nao consegui criar uma sessao para executar a action Hermes.");
  }
  return chat;
}

async function runHermesDirectAction(action, options = {}) {
  const chat = await ensureActionChat();
  const actionKey = options.actionKey || `manual-${Date.now()}-${Math.random().toString(36).slice(2)}:0`;
  if (state.runningActions.has(actionKey)) {
    return null;
  }
  state.runningActions.add(actionKey);
  renderAll();
  try {
    const result = await window.manusDesktop.runDesktopAction({
      chatId: chat.id,
      actionKey,
      action
    });
    state.app = result.state;
    if (options.successMessage || result.message) {
      showToast(options.successMessage || result.message);
    }
    return result;
  } catch (error) {
    showToast(error.message || "Falha ao executar action Hermes.");
    return null;
  } finally {
    state.runningActions.delete(actionKey);
    renderAll();
  }
}

function scheduleAutoRun() {
  state.autoRunKey = null;
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fieldValue(element, fallback = "") {
  return element ? String(element.value || "").trim() : String(fallback || "").trim();
}

function fieldChecked(element, fallback = false) {
  return element ? Boolean(element.checked) : Boolean(fallback);
}

function collectSettingsPayload(providerMode = activeProvider()) {
  const settings = state.app?.settings || {};
  const managedAvailable = managedLlamaAvailable();
  const hermesProvider = normalizeHermesProvider(fieldValue(elements.hermesProviderInput, settings.hermesProvider || "custom"));
  const executionProvider = hermesProvider === "manus" ? "cloud" : "local";
  const localBaseUrl = effectiveBaseUrlForProvider(
    hermesProvider,
    fieldValue(elements.localBaseUrlInput, settings.localBaseUrl || "http://127.0.0.1:11435/v1")
  );
  const localModel = effectiveModelForProvider(
    hermesProvider,
    fieldValue(elements.localModelInput, settings.localModel || "default")
  );
  return {
    providerMode: executionProvider,
    apiKey: fieldValue(elements.apiKeyInput, settings.apiKey),
    agentProfile: fieldValue(elements.agentProfileSelect, settings.agentProfile || "manus-1.6"),
    locale: fieldValue(elements.localeInput, settings.locale || effectiveLocale()) || effectiveLocale(),
    localBaseUrl,
    localModel,
    localApiKey: fieldValue(elements.localApiKeyInput, settings.localApiKey || "not-needed"),
    hermesProvider,
    hermesApiMode: fieldValue(elements.hermesApiModeInput, settings.hermesApiMode || "auto") || "auto",
    hermesProvidersAllowed: parseList(fieldValue(elements.hermesProvidersAllowedInput, (settings.hermesProvidersAllowed || []).join(", "))),
    hermesProvidersIgnored: parseList(fieldValue(elements.hermesProvidersIgnoredInput, (settings.hermesProvidersIgnored || []).join(", "))),
    hermesProvidersOrder: parseList(fieldValue(elements.hermesProvidersOrderInput, (settings.hermesProvidersOrder || []).join(", "))),
    hermesProviderSort: fieldValue(elements.hermesProviderSortInput, settings.hermesProviderSort || ""),
    hermesProviderRequireParameters: fieldChecked(elements.hermesProviderRequireParametersInput, settings.hermesProviderRequireParameters),
    hermesProviderDataCollection: fieldValue(elements.hermesProviderDataCollectionInput, settings.hermesProviderDataCollection || ""),
    localThinkingEnabled: fieldChecked(elements.localThinkingEnabledInput, settings.localThinkingEnabled),
    localLlamaEnabled: managedAvailable && fieldChecked(elements.localLlamaEnabledInput, settings.localLlamaEnabled),
    localLlamaAutoStart: managedAvailable && fieldChecked(elements.localLlamaAutoStartInput, settings.localLlamaAutoStart),
    localLlamaPort: fieldValue(elements.localLlamaPortInput, settings.localLlamaPort || 11435),
    localLlamaContextSize: fieldValue(elements.localLlamaContextSizeInput, settings.localLlamaContextSize || 16384),
    localLlamaGpuLayers: fieldValue(elements.localLlamaGpuLayersInput, settings.localLlamaGpuLayers ?? 999),
    localLlamaBatchSize: fieldValue(elements.localLlamaBatchSizeInput, settings.localLlamaBatchSize || 1024),
    localLlamaModelDir: fieldValue(elements.localLlamaModelDirInput, settings.localLlamaModelDir || ""),
    localLlamaModelPath: fieldValue(elements.localLlamaModelPathInput, settings.localLlamaModelPath || ""),
    hermesDesktopIntegrationEnabled: fieldChecked(elements.hermesDesktopIntegrationEnabledInput, settings.hermesDesktopIntegrationEnabled),
    trustMode: fieldValue(elements.trustModeInput, settings.trustMode || "ask"),
    interactiveMode: fieldChecked(elements.interactiveModeInput, settings.interactiveMode),
    desktopBridgeEnabled: fieldChecked(elements.desktopBridgeEnabledInput, settings.desktopBridgeEnabled),
    fullAccessMode: fieldChecked(elements.fullAccessModeInput, settings.fullAccessMode),
    kanbanGitEnabled: fieldChecked(elements.kanbanGitEnabledInput, settings.kanbanGitEnabled),
    kanbanAutoSchedulerEnabled: fieldChecked(elements.kanbanAutoSchedulerEnabledInput, settings.kanbanAutoSchedulerEnabled !== false),
    kanbanAutoRecoverEnabled: fieldChecked(elements.kanbanAutoRecoverEnabledInput, settings.kanbanAutoRecoverEnabled !== false),
    kanbanAutoCleanupEnabled: fieldChecked(elements.kanbanAutoCleanupEnabledInput, settings.kanbanAutoCleanupEnabled !== false),
    kanbanAutoPrEnabled: fieldChecked(elements.kanbanAutoPrEnabledInput, settings.kanbanAutoPrEnabled),
    kanbanMultiAgentOrchestrationEnabled: fieldChecked(
      elements.kanbanMultiAgentOrchestrationEnabledInput,
      settings.kanbanMultiAgentOrchestrationEnabled
    ),
    kanbanMaxParallelAgents: fieldValue(elements.kanbanMaxParallelAgentsInput, settings.kanbanMaxParallelAgents || APERANT_MAX_PARALLEL_TASKS),
    kanbanSchedulerIntervalMs: fieldValue(elements.kanbanSchedulerIntervalMsInput, settings.kanbanSchedulerIntervalMs || 2500),
    backgroundMediaPath: String(settings.backgroundMediaPath || ""),
    connectorIds: parseList(fieldValue(elements.connectorIdsInput, (settings.connectorIds || []).join(", "))),
    enableSkillIds: parseList(fieldValue(elements.enableSkillsInput, (settings.enableSkillIds || []).join(", "))),
    forceSkillIds: parseList(fieldValue(elements.forceSkillsInput, (settings.forceSkillIds || []).join(", "))),
    ...collectCodeShaderPayload(settings),
    theme: collectThemePayload(settings.theme)
  };
}

function collectThemePayload(fallback = {}) {
  const defaults = {
    preset: fallback.preset || DEFAULT_THEME_PRESET_ID,
    accent: fallback.accent || "#8a0000",
    accentHi: fallback.accentHi || "#ff4b4b",
    stopA: fallback.stopA || "rgba(138,  0,  0,0.80)",
    stopB: fallback.stopB || "rgba( 86,  0,  0,0.75)",
    stopC: fallback.stopC || "rgba( 96,  0,  0,0.50)",
    stopD: fallback.stopD || "rgba(210, 28, 28,0.44)",
    stopE: fallback.stopE || "rgba( 70,  0,  0,0.45)",
    base: fallback.base || "#080202",
    tint: fallback.tint || "#170505",
    blur: Number.isFinite(fallback.blur) ? fallback.blur : 30
  };
  if (!themeState) return defaults;
  return {
    preset: themeState.preset || defaults.preset,
    accent: themeState.accent || defaults.accent,
    accentHi: themeState.accentHi || defaults.accentHi,
    stopA: themeState.stopA || defaults.stopA,
    stopB: themeState.stopB || defaults.stopB,
    stopC: themeState.stopC || defaults.stopC,
    stopD: themeState.stopD || defaults.stopD,
    stopE: themeState.stopE || defaults.stopE,
    base: themeState.base || defaults.base,
    tint: themeState.tint || defaults.tint,
    blur: Number.isFinite(themeState.blur) ? themeState.blur : defaults.blur
  };
}

async function ensureChat() {
  if (currentChat()) {
    return currentChat();
  }
  state.app = await window.manusDesktop.createChat();
  renderAll();
  return currentChat();
}

async function switchProviderMode(mode) {
  const hermesProvider = mode === "cloud" ? "manus" : "custom";
  if (elements.hermesProviderInput) {
    elements.hermesProviderInput.value = hermesProvider;
  }
  const providerMode = hermesProvider === "manus" ? "cloud" : "local";
  state.app = await window.manusDesktop.saveSettings({
    ...collectSettingsPayload(providerMode),
    hermesProvider,
    providerMode
  });
  if (currentChat()) {
    state.app = await window.manusDesktop.setChatProvider({
      chatId: currentChat().id,
      providerMode
    });
  }
  renderAll({ forceSettings: true });
}

async function sendMessage() {
  if (state.busy || state.stopping) {
    return;
  }

  const text = elements.promptInput.value.trim();
  const attachmentPaths = state.attachments.map((item) => item.path);
  if (!text && !attachmentPaths.length) {
    return;
  }

  state.busy = true;
  renderAll();
  try {
    const chat = await ensureChat();
    const response = await window.manusDesktop.sendMessage({
      chatId: chat.id,
      text,
      attachmentPaths
    });
    state.app = response.state;
    if (!response.aborted) {
      elements.promptInput.value = "";
      state.attachments = [];
      hideSlashCommandMenu();
      resizeComposer();
    }
  } catch (error) {
    showToast(error.message || "Falha ao enviar a mensagem.");
  } finally {
    state.busy = false;
    renderAll();
  }
}

async function stopActiveChat() {
  const chat = currentChat();
  if (!chat) {
    return;
  }

  state.stopping = true;
  renderAll();
  try {
    const response = await window.manusDesktop.stopChat(chat.id);
    state.app = response.state;
    showToast("Execucao interrompida.");
  } catch (error) {
    showToast(error.message || "Nao consegui interromper a execucao.");
  } finally {
    state.busy = false;
    state.stopping = false;
    renderAll();
  }
}

async function stopAllLocalActivity() {
  state.stopping = true;
  renderAll();
  try {
    const response = await window.manusDesktop.stopAllLocalActivity();
    state.app = response.state;
    showToast(response.message || "Atividade local interrompida.");
  } catch (error) {
    showToast(error.message || "Nao consegui parar a atividade local.");
  } finally {
    state.busy = false;
    state.stopping = false;
    renderAll();
  }
}

async function stopBackgroundJob(jobId) {
  if (!jobId) {
    return;
  }
  try {
    const response = await window.manusDesktop.stopBackgroundJob(jobId);
    state.app = response.state;
    showToast(response.message || "Job interrompido.");
  } catch (error) {
    showToast(error.message || "Nao consegui parar o job.");
  } finally {
    renderAll();
  }
}

async function closeTerminalSession(sessionId) {
  if (!sessionId) {
    return;
  }
  await runHermesDirectAction({
    type: "terminal_close",
    session: sessionId
  }, {
    successMessage: "Terminal fechado pelo Hermes."
  });
}

async function refreshLocalModels() {
  try {
    state.localModels = await window.manusDesktop.listLocalModels();
    if (state.localModels.length && elements.localModelInput && !elements.localModelInput.value.trim()) {
      elements.localModelInput.value = state.localModels[0].id;
    }
    renderAll();
    showToast(state.localModels.length ? "Modelos locais detectados." : "Nenhum modelo retornado pelo endpoint local.");
  } catch (error) {
    showToast(error.message || "Nao consegui listar os modelos locais.");
  }
}

async function startLocalLlama() {
  try {
    state.app = await window.manusDesktop.saveSettings(collectSettingsPayload("local"));
    state.app = await window.manusDesktop.startLocalLlama({ forceRestart: false });
    renderAll({ forceSettings: true });
    showToast("llama.cpp local iniciado.");
  } catch (error) {
    showToast(error.message || "Nao consegui iniciar o llama.cpp local.");
    renderAll({ forceSettings: true });
  }
}

async function stopLocalLlama() {
  try {
    state.app = await window.manusDesktop.stopLocalLlama();
    renderAll({ forceSettings: true });
    showToast("llama.cpp local parado.");
  } catch (error) {
    showToast(error.message || "Nao consegui parar o llama.cpp local.");
  }
}

function showSetupOverlay(message = "") {
  if (!elements.setupOverlay) {
    return;
  }
  elements.setupOverlay.hidden = false;
  if (elements.setupActions) {
    elements.setupActions.hidden = true;
  }
  if (elements.setupIcon) {
    elements.setupIcon.className = "setup-card__icon";
  }
  if (elements.setupSub) {
    elements.setupSub.textContent = message || "Preparando ambiente Hermes Agent...";
  }
}

function setupOverlayAddLog(message = "") {
  if (!elements.setupLog || !message) {
    return;
  }
  const item = document.createElement("li");
  item.textContent = message;
  elements.setupLog.appendChild(item);
  while (elements.setupLog.children.length > 8) {
    elements.setupLog.removeChild(elements.setupLog.firstElementChild);
  }
}

function resolveSetupOverlay(message = "") {
  if (elements.setupIcon) {
    elements.setupIcon.className = "setup-card__icon is-done";
  }
  if (elements.setupSub) {
    elements.setupSub.textContent = message || "Hermes Agent pronto.";
  }
  setTimeout(() => {
    if (elements.setupOverlay) {
      elements.setupOverlay.hidden = true;
    }
  }, 700);
}

function errorSetupOverlay(message = "") {
  if (!elements.setupOverlay) {
    return;
  }
  elements.setupOverlay.hidden = false;
  if (elements.setupIcon) {
    elements.setupIcon.className = "setup-card__icon is-error";
  }
  if (elements.setupSub) {
    elements.setupSub.textContent = "Nao foi possivel preparar o Hermes Agent.";
  }
  if (elements.setupLog) {
    const item = document.createElement("li");
    item.className = "is-error";
    item.textContent = message || "Falha desconhecida durante o setup.";
    elements.setupLog.appendChild(item);
  }
  if (elements.setupHint) {
    elements.setupHint.textContent = [
      "Verifique a conexao, Python 3.10+ e permissao de escrita no diretorio de dados do app.",
      "No Windows, instale Git for Windows ou configure HERMES_GIT_BASH_PATH."
    ].join("\n");
  }
  if (elements.setupActions) {
    elements.setupActions.hidden = false;
  }
}

async function init() {
  state.app = await window.manusDesktop.loadState();
  syncPreviewDeviceModeFromApp();
  initSettingsUI();
  hydrateThemeFromState();
  startThinkingAnimationLoop();
  elements.setupRetryBtn?.addEventListener("click", async () => {
    if (elements.setupActions) {
      elements.setupActions.hidden = true;
    }
    if (elements.setupLog) {
      elements.setupLog.innerHTML = "";
    }
    if (elements.setupIcon) {
      elements.setupIcon.className = "setup-card__icon";
    }
    if (elements.setupSub) {
      elements.setupSub.textContent = "Tentando novamente...";
    }
    await window.manusDesktop.setupHermes();
  });
  window.manusDesktop.onRuntimeEvent((event) => {
    const type = event?.event?.type;
    const message = event?.event?.message || "";
    if (type === "hermes_setup_required") {
      showSetupOverlay(message);
      return;
    }
    if (type === "hermes_setup_progress") {
      setupOverlayAddLog(message);
      return;
    }
    if (type === "hermes_setup_done") {
      resolveSetupOverlay(message);
      return;
    }
    if (type === "hermes_setup_error") {
      errorSetupOverlay(message);
      return;
    }
    updateHomeTokenTelemetryFromRuntimeEvent(event);
    scheduleRuntimeRefresh(event);
  });
  window.manusDesktop.onPreviewHarnessCommand?.(async (payload) => {
    try {
      const result = await runPreviewHarnessCommand(payload?.command || {});
      await window.manusDesktop.completePreviewHarnessCommand({
        id: payload?.id,
        ok: true,
        result
      });
    } catch (error) {
      await window.manusDesktop.completePreviewHarnessCommand({
        id: payload?.id,
        ok: false,
        error: error.message || String(error)
      });
    }
  });
  renderAll({ forceSettings: true });
  resizeComposer();

  elements.newChatButton.addEventListener("click", async () => {
    state.app = await window.manusDesktop.createChat();
    renderAll();
  });
  elements.headerNewChatButton?.addEventListener("click", async () => {
    state.app = await window.manusDesktop.createChat();
    renderAll();
  });
  elements.appModeChatButton?.addEventListener("click", () => setAppMode("chat"));
  elements.appModeKanbanButton?.addEventListener("click", () => setAppMode("kanban"));
  elements.appModeTerminalsButton?.addEventListener("click", () => setAppMode("terminals"));
  Array.from(elements.homeDock?.querySelectorAll(".home-dock-app") || []).forEach((dockApp, index) => {
    dockApp.addEventListener("mouseenter", () => updateHomeDockMagnification(index));
    dockApp.addEventListener("focus", () => updateHomeDockMagnification(index));
    dockApp.addEventListener("mouseleave", () => updateHomeDockMagnification(-1));
    dockApp.addEventListener("blur", () => updateHomeDockMagnification(-1));
  });
  elements.homeDock?.addEventListener("mouseleave", () => updateHomeDockMagnification(-1));
  elements.homeDock?.addEventListener("click", (event) => {
    const dockApp = event.target.closest("[data-home-target]");
    if (!dockApp) {
      return;
    }
    openHomeTarget(dockApp.dataset.homeTarget);
  });
  elements.aperantSidebar?.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-aperant-mode]");
    if (modeButton) {
      setAppMode(modeButton.dataset.aperantMode);
      return;
    }
    if (event.target.closest("[data-open-settings]")) {
      openSettingsModal();
      return;
    }
  });
  elements.kanbanProviderInput?.addEventListener("change", () => setAperantProvider(elements.kanbanProviderInput.value));
  elements.multiAgentProviderSelect?.addEventListener("change", () => setAperantProvider(elements.multiAgentProviderSelect.value));
  elements.agentProviderInput?.addEventListener("change", () => setAperantProvider(elements.agentProviderInput.value));
  elements.kanbanQueueActiveInput?.addEventListener("change", async () => {
    setKanbanQueueActive(Boolean(elements.kanbanQueueActiveInput.checked));
    state.renderCache.kanban = "";
    renderKanbanBoard();
    if (state.kanbanQueueActive) {
      await processKanbanQueue({ force: true });
    }
  });
  elements.kanbanShowArchivedInput?.addEventListener("change", () => {
    setKanbanShowArchived(Boolean(elements.kanbanShowArchivedInput.checked));
    state.renderCache.kanban = "";
    renderKanbanBoard();
  });
  elements.kanbanQueueAllButton?.addEventListener("click", async () => {
    setKanbanQueueActive(true);
    state.renderCache.kanban = "";
    renderKanbanBoard();
    await processKanbanQueue({ force: true });
  });
  elements.kanbanRuntimeBanner?.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-settings]")) {
      openSettingsModal();
    }
  });
  elements.aperantUtilityView?.addEventListener("click", async (event) => {
    const modeButton = event.target.closest("[data-aperant-mode]");
    if (modeButton) {
      setAppMode(modeButton.dataset.aperantMode);
      return;
    }
    if (event.target.closest("[data-open-settings]")) {
      openSettingsModal();
      return;
    }
    const runButton = event.target.closest("[data-utility-run]");
    if (runButton) {
      await runAperantUtilityTask(runButton.dataset.utilityRun || state.appMode);
      return;
    }
    const cleanupButton = event.target.closest("[data-cleanup-task]");
    if (cleanupButton && !cleanupButton.disabled) {
      await cleanupKanbanTask(cleanupButton.dataset.cleanupTask);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-task]");
    if (deleteButton && !deleteButton.disabled) {
      await deleteKanbanTask(deleteButton.dataset.deleteTask);
      return;
    }
    const prButton = event.target.closest("[data-create-pr]");
    if (prButton && !prButton.disabled) {
      await createKanbanTaskPr(prButton.dataset.createPr);
    }
  });
  elements.aperantUtilityView?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-utility-form]");
    if (!form) return;
    event.preventDefault();
    const payload = new FormData(form);
    const idea = String(payload.get("idea") || "").trim();
    if (!idea) {
      showToast("Informe uma ideia para o Hermes transformar em plano.");
      return;
    }
    await runAperantUtilityTask(form.dataset.utilityForm || state.appMode, idea);
    form.reset();
  });

  elements.chatList.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-chat]");
    if (deleteButton) {
      state.app = await window.manusDesktop.deleteChat(deleteButton.dataset.deleteChat);
      renderAll();
      return;
    }

    const row = event.target.closest("[data-chat-id]");
    if (row) {
      state.app = await window.manusDesktop.selectChat(row.dataset.chatId);
      renderAll();
    }
  });

  elements.transcript.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action-key]");
    if (button) {
      runAction(button.dataset.actionKey);
    }
  });

  elements.actionFeed.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action-key]");
    if (button) {
      runAction(button.dataset.actionKey);
    }
  });

  elements.kanbanTaskForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = fieldValue(elements.kanbanTaskTitleInput);
    const objective = fieldValue(elements.kanbanTaskObjectiveInput);
    if (!title || !objective) {
      showToast("Informe titulo e objetivo para criar o card.");
      return;
    }
    const routeId = fieldValue(elements.kanbanRouteInput);
    const result = await runHermesDirectAction({
      type: "task_create",
      title,
      objective,
      routeId: routeId || undefined
    }, {
      successMessage: "Card criado pelo Hermes."
    });
    if (result) {
      elements.kanbanTaskTitleInput.value = "";
      elements.kanbanTaskObjectiveInput.value = "";
      if (elements.kanbanRouteInput) elements.kanbanRouteInput.value = "";
      elements.kanbanTaskForm.closest("details")?.removeAttribute("open");
    }
  });

  elements.kanbanColumns?.addEventListener("click", async (event) => {
    const statusButton = event.target.closest("[data-task-status]");
    if (statusButton) {
      await moveKanbanTask(statusButton.dataset.taskId, statusButton.dataset.taskStatus);
      return;
    }

    const startButton = event.target.closest("[data-start-task]");
    if (startButton) {
      if (startButton.disabled) return;
      await startKanbanTask(startButton.dataset.startTask);
      return;
    }

    const stopButton = event.target.closest("[data-stop-task]");
    if (stopButton) {
      if (stopButton.disabled) return;
      await stopKanbanTask(stopButton.dataset.stopTask);
      return;
    }

    const recoverButton = event.target.closest("[data-recover-task]");
    if (recoverButton) {
      if (recoverButton.disabled) return;
      await recoverKanbanTask(recoverButton.dataset.recoverTask);
      return;
    }

    const cleanupButton = event.target.closest("[data-cleanup-task]");
    if (cleanupButton) {
      if (cleanupButton.disabled) return;
      await cleanupKanbanTask(cleanupButton.dataset.cleanupTask);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-task]");
    if (deleteButton) {
      if (deleteButton.disabled) return;
      await deleteKanbanTask(deleteButton.dataset.deleteTask);
      return;
    }

    const prButton = event.target.closest("[data-create-pr]");
    if (prButton) {
      if (prButton.disabled) return;
      await createKanbanTaskPr(prButton.dataset.createPr);
    }
  });

  elements.kanbanColumns?.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-task-card-id]");
    if (!card) return;
    state.kanbanDragTaskId = card.dataset.taskCardId || "";
    event.dataTransfer?.setData("text/plain", state.kanbanDragTaskId);
    event.dataTransfer?.setDragImage?.(card, 16, 16);
  });

  elements.kanbanColumns?.addEventListener("dragover", (event) => {
    const column = event.target.closest("[data-kanban-column]");
    if (!column) return;
    event.preventDefault();
    column.classList.add("is-drop-target");
  });

  elements.kanbanColumns?.addEventListener("dragleave", (event) => {
    const column = event.target.closest("[data-kanban-column]");
    if (column && !column.contains(event.relatedTarget)) {
      column.classList.remove("is-drop-target");
    }
  });

  elements.kanbanColumns?.addEventListener("drop", async (event) => {
    const column = event.target.closest("[data-kanban-column]");
    if (!column) return;
    event.preventDefault();
    column.classList.remove("is-drop-target");
    const taskId = event.dataTransfer?.getData("text/plain") || state.kanbanDragTaskId;
    const status = column.dataset.kanbanColumn === "planning" ? "backlog" : column.dataset.kanbanColumn;
    const task = (state.app?.tasks || []).find((item) => item.id === taskId);
    state.kanbanDragTaskId = "";
    if (!task || !status || task.status === status) return;
    await moveKanbanTask(task.id, status);
  });

  elements.kanbanColumns?.addEventListener("dragend", () => {
    state.kanbanDragTaskId = "";
    elements.kanbanColumns.querySelectorAll(".is-drop-target").forEach((column) => column.classList.remove("is-drop-target"));
  });

  elements.kanbanRefreshButton?.addEventListener("click", async () => {
    state.app = await window.manusDesktop.loadState();
    state.renderCache.kanban = "";
    renderAll();
    showToast("Kanban sincronizado.");
  });

  elements.agentSpawnForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const objective = fieldValue(elements.agentObjectiveInput);
    if (!objective) {
      showToast("Informe o objetivo do subagente.");
      return;
    }
    if (!ensureAperantProviderReady(selectedAperantProvider())) {
      return;
    }
    const action = {
      type: "agent_spawn",
      name: fieldValue(elements.agentNameInput) || undefined,
      objective,
      provider: selectedAperantProvider(),
      routeId: fieldValue(elements.agentRouteInput) || undefined,
      useWorktree: fieldChecked(elements.agentWorktreeInput, true),
      branchName: fieldValue(elements.agentBranchInput) || undefined
    };
    const result = await runHermesDirectAction(action, {
      successMessage: "Subagente iniciado pelo Hermes."
    });
    if (result) {
      elements.agentObjectiveInput.value = "";
      elements.agentBranchInput.value = "";
    }
  });

  elements.multiAgentNewTerminalButton?.addEventListener("click", async () => {
    await openHermesTerminal(nextTerminalSlot());
  });

  elements.multiAgentList?.addEventListener("click", async (event) => {
    const stopButton = event.target.closest("[data-stop-agent]");
    if (stopButton && !stopButton.disabled) {
      await runHermesDirectAction({
        type: "agent_stop",
        id: stopButton.dataset.stopAgent
      }, {
        successMessage: "Subagente interrompido pelo Hermes."
      });
      return;
    }

    const openChatButton = event.target.closest("[data-open-agent-chat]");
    if (openChatButton) {
      state.app = await window.manusDesktop.selectChat(openChatButton.dataset.openAgentChat);
      setAppMode("chat");
    }
  });

  elements.multiTerminalList?.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-open-terminal-slot]");
    if (openButton && !openButton.disabled) {
      await openHermesTerminal(openButton.dataset.openTerminalSlot);
      return;
    }

    const closeButton = event.target.closest("[data-close-terminal]");
    if (closeButton) {
      await closeTerminalSession(closeButton.dataset.closeTerminal);
    }
  });

  elements.multiAgentSettingsButton?.addEventListener("click", openSettingsModal);

  elements.projectFeed.addEventListener("click", (event) => {
    const pathButton = event.target.closest("[data-project-path]");
    if (pathButton) {
      window.manusDesktop.openExternal(fileUrl(pathButton.dataset.projectPath));
      return;
    }
    const urlButton = event.target.closest("[data-project-url]");
    if (urlButton) {
      window.manusDesktop.openExternal(urlButton.dataset.projectUrl);
    }
  });

  elements.previewOpenButton.addEventListener("click", () => {
    const url = elements.previewOpenButton.dataset.previewUrl;
    if (url) {
      window.manusDesktop.openExternal(url);
    }
  });
  elements.previewDesktopButton?.addEventListener("click", async () => {
    setPreviewDeviceMode("desktop");
    state.renderCache.previewSrc = "";
    state.renderCache.workbench = "";
    renderWorkbenchPanel();
    try {
      const response = await window.manusDesktop.setPreviewMode({
        mode: "desktop",
        source: "ui"
      });
      state.app = response.state;
      syncPreviewDeviceModeFromApp();
      state.renderCache.previewSrc = "";
      renderWorkbenchPanel();
    } catch (error) {
      showToast(error.message || "Falha ao ativar o preview desktop.");
    }
  });
  elements.previewMobileButton?.addEventListener("click", async () => {
    if (elements.previewMobileButton.disabled) {
      return;
    }
    setPreviewDeviceMode("mobile");
    state.renderCache.previewSrc = "";
    state.renderCache.workbench = "";
    renderWorkbenchPanel();
    try {
      const response = await window.manusDesktop.setPreviewMode({
        mode: "mobile",
        source: "ui"
      });
      state.app = response.state;
      syncPreviewDeviceModeFromApp();
      state.renderCache.previewSrc = "";
      renderWorkbenchPanel();
    } catch (error) {
      showToast(error.message || "Falha ao iniciar o preview mobile.");
    }
  });
  elements.previewRefreshButton.addEventListener("click", async () => {
    const url = elements.previewRefreshButton.dataset.previewUrl;
    const mode = elements.previewRefreshButton.dataset.previewMode;
    if (mode === "mobile") {
      state.renderCache.previewSrc = "";
      try {
        await ensureMobilePreviewService(true);
      } catch (error) {
        showToast(error.message || "Falha ao atualizar o preview mobile.");
      }
      renderWorkbenchPanel();
      return;
    }
    if (mode === "inline") {
      state.renderCache.previewSrc = "";
      renderWorkbenchPanel();
      return;
    }
    if (!url) {
      return;
    }
    state.renderCache.previewSrc = "";
    const refreshedUrl = previewUrlWithVersion(url, Date.now());
    elements.previewSurface.innerHTML = `<webview class="preview-frame preview-webview" data-preview-version="${escapeHtml(Date.now())}" data-preview-harness-owner-chat-id="${escapeHtml(currentChatId())}" src="${escapeHtml(refreshedUrl)}" title="Preview local" allowpopups autosize="on" minwidth="320" minheight="320" style="width:100%;height:100%;"></webview>`;
  });

  elements.codeSurface.addEventListener("beforeinput", (event) => {
    const input = event.target.closest(".code-input");
    if (!input) {
      return;
    }
    updateCodeShaderFromCaret(input, { pulse: true, amount: 0.28 });
  });

  elements.codeSurface.addEventListener("input", (event) => {
    const input = event.target.closest(".code-input");
    if (!input) {
      return;
    }
    stopCodeTyping();
    state.codeEditor.value = input.value;
    state.codeEditor.dirty = true;
    const dirtyBadge = elements.codeSurface.querySelector("[data-code-dirty]");
    if (dirtyBadge) {
      dirtyBadge.textContent = "editado";
    }
    const previousCaret = codeShaderRuntime.caretPx ? [...codeShaderRuntime.caretPx] : null;
    const previousCursorBox = codeShaderRuntime.cursorBox ? [...codeShaderRuntime.cursorBox] : null;
    syncCodeEditor();
    if (previousCaret) {
      codeShaderRuntime.caretPx = previousCaret;
    }
    updateCodeShaderFromCaret(input, { pulse: true, previousCursorBox });
  });

  elements.codeSurface.addEventListener("keydown", (event) => {
    const input = event.target.closest(".code-input");
    if (!input) {
      return;
    }
    const handled = handleCodeEditorKeydown(event, input);
    if (handled) {
      return;
    }
    const key = event.key || "";
    const caretKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown"
    ]);
    if (caretKeys.has(key)) {
      queueCodeShaderFromCaret(input, { pulse: true, amount: 0.42 });
    }
  });

  elements.codeSurface.addEventListener("keyup", (event) => {
    const input = event.target.closest(".code-input");
    if (input) {
      updateCodeShaderFromCaret(input, { pulse: false });
    }
  });

  elements.codeSurface.addEventListener("focusin", (event) => {
    const input = event.target.closest(".code-input");
    if (input) {
      codeShaderRuntime.hasFocus = true;
      codeShaderRuntime.focusTime = currentCodeShaderTime();
      updateCodeShaderFromCaret(input, { pulse: true, amount: 0.45 });
    }
  });

  elements.codeSurface.addEventListener("focusout", (event) => {
    if (event.target.closest(".code-input")) {
      codeShaderRuntime.hasFocus = false;
      codeShaderRuntime.focusTime = currentCodeShaderTime();
    }
  });

  elements.codeSurface.addEventListener("click", (event) => {
    const input = event.target.closest(".code-input");
    if (input) {
      updateCodeShaderFromCaret(input, { pulse: true });
    }
  }, true);

  elements.codeSurface.addEventListener("scroll", (event) => {
    if (event.target?.classList?.contains("code-input")) {
      syncCodeEditor();
      updateCodeShaderFromCaret(event.target, { pulse: false });
    }
  }, true);

  document.addEventListener("selectionchange", () => {
    const input = elements.codeSurface?.querySelector(".code-input");
    if (input && document.activeElement === input) {
      updateCodeShaderFromCaret(input, { pulse: false });
    }
  });

  elements.codeSurface.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-code]");
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(state.codeEditor.value || "");
        showToast("Código copiado.");
      } catch {
        showToast("Não consegui copiar o código.");
      }
      return;
    }

    const saveButton = event.target.closest("[data-save-code]");
    if (!saveButton || saveButton.disabled) {
      return;
    }
    const chat = currentChat();
    try {
      const response = await window.manusDesktop.saveCodeFile({
        chatId: chat?.id,
        path: saveButton.dataset.path,
        content: state.codeEditor.value || ""
      });
      state.app = response.state || state.app;
      state.codeEditor.dirty = false;
      state.codeEditor.savedAt = Date.now();
      showToast("Arquivo salvo.");
      renderAll();
    } catch (error) {
      showToast(error.message || "Falha ao salvar o arquivo.");
    }
  });

  elements.terminalFeed.addEventListener("click", (event) => {
    const button = event.target.closest("[data-close-terminal]");
    if (button) {
      closeTerminalSession(button.dataset.closeTerminal);
    }
  });

  elements.backgroundFeed.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stop-job]");
    if (button) {
      stopBackgroundJob(button.dataset.stopJob);
    }
  });

  elements.attachmentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-attachment]");
    if (!button) {
      return;
    }
    state.attachments = state.attachments.filter((item) => item.id !== button.dataset.removeAttachment);
    renderAll();
  });

  elements.heroState.addEventListener("click", (event) => {
    const example = event.target.closest("[data-example]");
    if (!example) {
      return;
    }
    elements.promptInput.value = example.dataset.example || "";
    resizeComposer();
    elements.promptInput.focus();
  });

  elements.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });

  elements.promptInput.addEventListener("input", () => {
    resizeComposer();
    updateSlashCommandMenu();
  });
  elements.promptInput.addEventListener("keydown", (event) => {
    if (handleSlashCommandKeydown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      hideSlashCommandMenu();
      sendMessage();
    }
  });
  elements.slashCommandMenu?.addEventListener("mousedown", (event) => {
    const button = event.target.closest("[data-slash-index]");
    if (!button) {
      return;
    }
    event.preventDefault();
    const index = Number(button.dataset.slashIndex);
    applySlashCommand(state.slashMenu.items[index]);
  });
  elements.stopButton.addEventListener("click", stopActiveChat);
  elements.stopAllLocalButton.addEventListener("click", stopAllLocalActivity);

  elements.attachButton.addEventListener("click", async () => {
    const picked = await window.manusDesktop.pickAttachments();
    const known = new Set(state.attachments.map((item) => item.path));
    state.attachments = [...state.attachments, ...picked.filter((item) => !known.has(item.path))];
    renderAll();
  });

  elements.pickBackgroundButton?.addEventListener("click", async () => {
    try {
      const picked = await window.manusDesktop.pickBackgroundMedia();
      if (!picked?.path) {
        return;
      }
      const payload = {
        ...collectSettingsPayload(),
        backgroundMediaPath: picked.path
      };
      state.app = await window.manusDesktop.saveSettings(payload);
      applyAmbientBackground(picked.path);
      renderAll({ forceSettings: true });
      showToast("Background atualizado.");
    } catch (error) {
      showToast(error.message || "Falha ao escolher background.");
    }
  });

  elements.clearBackgroundButton?.addEventListener("click", async () => {
    try {
      state.app = await window.manusDesktop.saveSettings({
        ...collectSettingsPayload(),
        backgroundMediaPath: ""
      });
      applyAmbientBackground("");
      renderAll({ forceSettings: true });
      showToast("Background padrao restaurado.");
    } catch (error) {
      showToast(error.message || "Falha ao restaurar background.");
    }
  });

  elements.settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.app = await window.manusDesktop.saveSettings(collectSettingsPayload());
    renderAll({ forceSettings: true });
    hydrateThemeFromState();
    applyCodeShaderSettings(state.app?.settings || {});
    applyCodeShaderToEditor();
    showToast("Configuracoes salvas.");
  });

  elements.clearApiKeyButton?.addEventListener("click", async () => {
    state.app = await window.manusDesktop.clearApiKey();
    if (elements.apiKeyInput) {
      elements.apiKeyInput.value = "";
    }
    renderAll({ forceSettings: true });
    showToast("Chave cloud apagada.");
  });

elements.cloudProviderButton?.addEventListener("click", () => switchProviderMode("cloud"));
elements.localProviderButton?.addEventListener("click", () => switchProviderMode("local"));
  elements.hermesProviderInput?.addEventListener("change", () => {
    syncProviderSpecificSettings({
      ...(state.app?.settings || {}),
      hermesProvider: elements.hermesProviderInput.value
    }, { applyDefaults: true, providerChanged: true });
  });
  elements.localLlamaEnabledInput?.addEventListener("change", () => {
    syncPlatformSettingsHints({
      ...(state.app?.settings || {}),
      localLlamaEnabled: Boolean(elements.localLlamaEnabledInput.checked)
    });
  });
  elements.refreshLocalModelsButton?.addEventListener("click", refreshLocalModels);
  elements.startLocalLlamaButton?.addEventListener("click", startLocalLlama);
  elements.stopLocalLlamaButton?.addEventListener("click", stopLocalLlama);
  elements.togglePanelButton?.addEventListener("click", () => {
    openSettingsModal();
  });
  elements.settingsCloseButton?.addEventListener("click", () => {
    void closeSettingsModal();
  });
  elements.settingsBackdrop?.addEventListener("click", () => {
    void closeSettingsModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (elements.settingsModal && !elements.settingsModal.hidden) {
      event.preventDefault();
      void closeSettingsModal();
      return;
    }
    if (state.appMode !== "home") {
      event.preventDefault();
      setAppMode("home");
    }
  });
  elements.headerPanelButton?.addEventListener("click", () => {
    state.panelOpen = !state.panelOpen;
    renderShell();
  });
  elements.headerTerminalButton?.addEventListener("click", () => {
    state.panelOpen = true;
    state.workbenchView = "terminal";
    renderShell();
    renderWorkbenchPanel();
  });
  elements.workbenchPreviewTab?.addEventListener("click", () => {
    state.workbenchView = "preview";
    renderWorkbenchPanel();
  });
  elements.workbenchFilesTab?.addEventListener("click", () => {
    state.workbenchView = "files";
    renderWorkbenchPanel();
  });
  elements.workbenchCodeTab?.addEventListener("click", () => {
    state.workbenchView = "code";
    renderWorkbenchPanel();
  });
  elements.workbenchChangesTab?.addEventListener("click", () => {
    state.workbenchView = "changes";
    renderWorkbenchPanel();
  });
  elements.workbenchTerminalTab?.addEventListener("click", () => {
    state.workbenchView = "terminal";
    renderWorkbenchPanel();
  });
  elements.filesSurface?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-workbench-files-view]");
    if (viewButton) {
      state.workbenchFilesView = viewButton.dataset.workbenchFilesView === "list" ? "list" : "grid";
      localStorage.setItem("dream.workbench.filesView", state.workbenchFilesView);
      state.renderCache.files = "";
      renderWorkbenchPanel();
      return;
    }
    const crumbButton = event.target.closest("[data-workbench-breadcrumb]");
    if (crumbButton) {
      state.workbenchFilesPath = normalizeWorkbenchBrowserPath(crumbButton.dataset.workbenchBreadcrumb || "");
      state.renderCache.files = "";
      renderWorkbenchPanel();
      return;
    }
    const dirButton = event.target.closest("[data-workbench-dir]");
    if (dirButton) {
      state.workbenchFilesPath = normalizeWorkbenchBrowserPath(dirButton.dataset.workbenchDir || "");
      state.renderCache.files = "";
      renderWorkbenchPanel();
      return;
    }
    const row = event.target.closest("[data-workbench-file]");
    if (!row) {
      return;
    }
    state.selectedWorkbenchFileChatId = currentChatId();
    state.selectedWorkbenchFilePath = row.dataset.workbenchFile || "";
    state.workbenchView = "code";
    state.renderCache.workbench = "";
    renderWorkbenchPanel();
  });
  elements.closePanelButton.addEventListener("click", () => {
    state.panelOpen = false;
    renderShell();
  });
  elements.panelScrim.addEventListener("click", () => {
    state.panelOpen = false;
    renderShell();
  });
  elements.openTaskButton.addEventListener("click", () => {
    const url = currentChat()?.taskUrl;
    if (url) {
      window.manusDesktop.openExternal(url);
    }
  });
}

init().catch((error) => {
  elements.toast.hidden = false;
  elements.toast.textContent = error.message || "Falha ao inicializar a interface.";
});
