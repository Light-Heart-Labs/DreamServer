const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { HermesBackend, defaultHermesRoot, DEFAULT_DOCTOR_TIMEOUT_MS } = require("./backend");
const { resolveHermesRoutingSettings } = require("../providers/hermes");
const { DEFAULT_LOCAL_BASE_URL, DEFAULT_LOCAL_MODEL } = require("../state");
const { ensureLocalLlamaServer } = require("../local-llama");

const GATEWAY_PLATFORMS = Object.freeze([
  { id: "discord", label: "Discord", requiredSecrets: ["botToken"], secretEnv: { botToken: "DISCORD_BOT_TOKEN" }, fields: { homeChannel: "DISCORD_HOME_CHANNEL", replyToMode: "DISCORD_REPLY_TO_MODE" } },
  { id: "telegram", label: "Telegram", requiredSecrets: ["botToken"], secretEnv: { botToken: "TELEGRAM_BOT_TOKEN" }, fields: { homeChannel: "TELEGRAM_HOME_CHANNEL", replyToMode: "TELEGRAM_REPLY_TO_MODE" } },
  { id: "slack", label: "Slack", requiredSecrets: ["botToken"], secretEnv: { botToken: "SLACK_BOT_TOKEN" }, fields: { homeChannel: "SLACK_HOME_CHANNEL", replyToMode: "SLACK_REPLY_TO_MODE" } },
  { id: "matrix", label: "Matrix", requiredFields: ["homeserver"], secretEnv: { accessToken: "MATRIX_ACCESS_TOKEN", password: "MATRIX_PASSWORD" }, fields: { homeserver: "MATRIX_HOMESERVER", userId: "MATRIX_USER_ID", deviceId: "MATRIX_DEVICE_ID", homeChannel: "MATRIX_HOME_CHANNEL" }, anySecret: ["accessToken", "password"] },
  { id: "mattermost", label: "Mattermost", requiredFields: ["serverUrl"], requiredSecrets: ["token"], secretEnv: { token: "MATTERMOST_TOKEN" }, fields: { serverUrl: "MATTERMOST_URL", homeChannel: "MATTERMOST_HOME_CHANNEL" } },
  { id: "signal", label: "Signal", requiredFields: ["httpUrl", "account"], fields: { httpUrl: "SIGNAL_HTTP_URL", account: "SIGNAL_ACCOUNT", homeChannel: "SIGNAL_HOME_CHANNEL" } },
  {
    id: "whatsapp",
    label: "WhatsApp",
    recommendedFields: ["homeChannel"],
    fields: {
      homeChannel: "WHATSAPP_HOME_CHANNEL",
      dmPolicy: "WHATSAPP_DM_POLICY",
      groupPolicy: "WHATSAPP_GROUP_POLICY",
      allowedUsers: "WHATSAPP_ALLOWED_USERS",
      groupAllowedUsers: "WHATSAPP_GROUP_ALLOWED_USERS",
      freeResponseChats: "WHATSAPP_FREE_RESPONSE_CHATS",
      mentionPatterns: "WHATSAPP_MENTION_PATTERNS"
    },
    enabledEnv: "WHATSAPP_ENABLED"
  },
  { id: "homeassistant", label: "Home Assistant", requiredSecrets: ["token"], secretEnv: { token: "HASS_TOKEN" }, fields: { url: "HASS_URL" } },
  { id: "email", label: "Email", requiredFields: ["address", "imapHost", "smtpHost"], requiredSecrets: ["password"], secretEnv: { password: "EMAIL_PASSWORD" }, fields: { address: "EMAIL_ADDRESS", imapHost: "EMAIL_IMAP_HOST", smtpHost: "EMAIL_SMTP_HOST", homeAddress: "EMAIL_HOME_ADDRESS" } },
  { id: "sms", label: "SMS/Twilio", requiredSecrets: ["accountSid", "authToken"], secretEnv: { accountSid: "TWILIO_ACCOUNT_SID", authToken: "TWILIO_AUTH_TOKEN" }, fields: { homeChannel: "SMS_HOME_CHANNEL" } },
  { id: "api_server", label: "API Server", fields: { host: "API_SERVER_HOST", port: "API_SERVER_PORT", modelName: "API_SERVER_MODEL_NAME" }, secretEnv: { apiKey: "API_SERVER_KEY" }, enabledEnv: "API_SERVER_ENABLED" },
  { id: "webhook", label: "Webhook", fields: { port: "WEBHOOK_PORT" }, secretEnv: { secret: "WEBHOOK_SECRET" }, enabledEnv: "WEBHOOK_ENABLED" },
  { id: "dingtalk", label: "DingTalk", requiredSecrets: ["clientId", "clientSecret"], secretEnv: { clientId: "DINGTALK_CLIENT_ID", clientSecret: "DINGTALK_CLIENT_SECRET" }, fields: { homeChannel: "DINGTALK_HOME_CHANNEL" } },
  { id: "feishu", label: "Feishu", requiredSecrets: ["appId", "appSecret"], secretEnv: { appId: "FEISHU_APP_ID", appSecret: "FEISHU_APP_SECRET" }, fields: { homeChannel: "FEISHU_HOME_CHANNEL" } },
  { id: "wecom", label: "WeCom", fields: { homeChannel: "WECOM_HOME_CHANNEL" } },
  { id: "weixin", label: "Weixin", fields: { homeChannel: "WEIXIN_HOME_CHANNEL" } },
  { id: "bluebubbles", label: "BlueBubbles", fields: { serverUrl: "BLUEBUBBLES_SERVER_URL", homeChannel: "BLUEBUBBLES_HOME_CHANNEL" }, secretEnv: { password: "BLUEBUBBLES_PASSWORD" } },
  { id: "qqbot", label: "QQ Bot", fields: { homeChannel: "QQBOT_HOME_CHANNEL" } },
  { id: "yuanbao", label: "Yuanbao", fields: { homeChannel: "YUANBAO_HOME_CHANNEL" } }
]);

const GATEWAY_PLATFORM_SETUPS = Object.freeze({
  discord: {
    authMode: "Bot token + bot invite + Hermes DM approval",
    connectionMode: "discord_bot_api",
    usesQr: false,
    usesPairingApproval: true,
    directApi: true,
    summary: "Discord usa um bot instalado no servidor. Nao existe QR; o bot precisa de token, permissao no servidor e canal alvo.",
    nextAction: "Configure o botToken, convide o bot ao servidor, inicie o gateway e use guilds/channels para escolher o canal."
  },
  telegram: {
    authMode: "BotFather token + Hermes DM approval",
    connectionMode: "telegram_bot_api",
    usesQr: false,
    usesPairingApproval: true,
    directApi: true,
    summary: "Telegram usa Bot API. Nao existe QR; o token vem do BotFather e codigos curtos sao aprovacao Hermes de usuario.",
    nextAction: "Configure o botToken, inicie o gateway, envie /start ao bot e aprove o codigo curto quando ele aparecer."
  },
  slack: {
    authMode: "Slack bot token",
    connectionMode: "slack_gateway_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Slack roda pelo adaptador do Hermes Gateway com bot token e canal alvo. O Electron ainda nao expoe chamadas diretas Slack.",
    nextAction: "Configure botToken e homeChannel, inicie o gateway e valide por status/logs."
  },
  matrix: {
    authMode: "Homeserver + access token or password",
    connectionMode: "matrix_gateway_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Matrix usa homeserver e credencial da conta/bot. Nao usa QR.",
    nextAction: "Configure homeserver, userId e accessToken ou password; depois inicie o gateway."
  },
  mattermost: {
    authMode: "Mattermost server URL + token",
    connectionMode: "mattermost_gateway_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Mattermost usa URL do servidor e token da conta/bot.",
    nextAction: "Configure serverUrl, token e homeChannel; depois inicie o gateway."
  },
  signal: {
    authMode: "signal-cli REST API",
    connectionMode: "signal_rest_bridge",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Signal depende de uma bridge signal-cli-rest-api ja autenticada fora do formulario.",
    nextAction: "Configure httpUrl e account da bridge Signal; depois inicie o gateway."
  },
  whatsapp: {
    authMode: "WhatsApp bridge QR pairing",
    connectionMode: "whatsapp_bridge",
    usesQr: true,
    usesPairingApproval: false,
    directApi: true,
    summary: "WhatsApp e o unico gateway aqui que usa QR. O QR vem da bridge vendorizada do Hermes, nao do WhatsApp Web no preview.",
    nextAction: "Habilite WhatsApp, inicie o gateway e escaneie o QR emitido no chat/status."
  },
  homeassistant: {
    authMode: "Home Assistant long-lived token",
    connectionMode: "homeassistant_api",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Home Assistant usa URL/ambiente do servidor e token de longa duracao.",
    nextAction: "Configure token e URL quando aplicavel; depois inicie o gateway."
  },
  email: {
    authMode: "IMAP/SMTP credentials",
    connectionMode: "email_imap_smtp",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Email usa IMAP para entrada e SMTP para saida. Nao usa QR nem pairing por codigo curto.",
    nextAction: "Configure address, imapHost, smtpHost, password e homeAddress; depois inicie o gateway."
  },
  sms: {
    authMode: "Twilio credentials",
    connectionMode: "twilio_sms_api",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "SMS usa credenciais Twilio e numero/canal alvo.",
    nextAction: "Configure accountSid, authToken e homeChannel; depois inicie o gateway."
  },
  api_server: {
    authMode: "Local HTTP API key",
    connectionMode: "api_server",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "API Server expoe um endpoint HTTP local do gateway; nao e chat e nao usa QR.",
    nextAction: "Configure host, port, modelName e apiKey quando exigido; depois inicie o gateway."
  },
  webhook: {
    authMode: "Webhook secret",
    connectionMode: "webhook_receiver",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Webhook e entrada HTTP assinada por secret. Nao lista chats e nao usa QR.",
    nextAction: "Configure port e secret; depois inicie o gateway e aponte o servico externo para a URL do webhook."
  },
  dingtalk: {
    authMode: "DingTalk client credentials",
    connectionMode: "dingtalk_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "DingTalk usa clientId/clientSecret do app corporativo.",
    nextAction: "Configure clientId, clientSecret e homeChannel; depois inicie o gateway."
  },
  feishu: {
    authMode: "Feishu app credentials",
    connectionMode: "feishu_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Feishu usa appId/appSecret do bot/app.",
    nextAction: "Configure appId, appSecret e homeChannel; depois inicie o gateway."
  },
  wecom: {
    authMode: "WeCom adapter credentials",
    connectionMode: "wecom_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "WeCom roda via adaptador Hermes e configuracao corporativa.",
    nextAction: "Configure homeChannel e credenciais exigidas pelo adaptador Hermes; depois inicie o gateway."
  },
  weixin: {
    authMode: "Weixin adapter credentials",
    connectionMode: "weixin_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Weixin roda via adaptador Hermes. Nao reutiliza o QR do WhatsApp.",
    nextAction: "Configure homeChannel e credenciais exigidas pelo adaptador Hermes; depois inicie o gateway."
  },
  bluebubbles: {
    authMode: "BlueBubbles server credentials",
    connectionMode: "bluebubbles_server",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "BlueBubbles depende de um servidor BlueBubbles ja configurado para iMessage.",
    nextAction: "Configure serverUrl, password e homeChannel; depois inicie o gateway."
  },
  qqbot: {
    authMode: "QQ Bot adapter credentials",
    connectionMode: "qqbot_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "QQ Bot roda pelo adaptador Hermes e nao usa QR do WhatsApp.",
    nextAction: "Configure homeChannel e credenciais exigidas pelo adaptador Hermes; depois inicie o gateway."
  },
  yuanbao: {
    authMode: "Yuanbao adapter credentials",
    connectionMode: "yuanbao_adapter",
    usesQr: false,
    usesPairingApproval: false,
    directApi: false,
    summary: "Yuanbao roda pelo adaptador Hermes; midia/proto/sticker sao capacidades internas do adaptador.",
    nextAction: "Configure homeChannel e credenciais exigidas pelo adaptador Hermes; depois inicie o gateway."
  }
});

const PROVIDER_RUNTIME_ENV = Object.freeze({
  lmstudio: { apiKeys: ["LM_API_KEY"], baseUrl: "LM_BASE_URL" },
  copilot: { apiKeys: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"], baseUrl: "COPILOT_API_BASE_URL" },
  gemini: { apiKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"], baseUrl: "GEMINI_BASE_URL" },
  zai: { apiKeys: ["GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"], baseUrl: "GLM_BASE_URL" },
  "kimi-coding": { apiKeys: ["KIMI_API_KEY", "KIMI_CODING_API_KEY"], baseUrl: "KIMI_BASE_URL" },
  "kimi-coding-cn": { apiKeys: ["KIMI_CN_API_KEY"], baseUrl: "" },
  stepfun: { apiKeys: ["STEPFUN_API_KEY"], baseUrl: "STEPFUN_BASE_URL" },
  arcee: { apiKeys: ["ARCEEAI_API_KEY"], baseUrl: "ARCEE_BASE_URL" },
  gmi: { apiKeys: ["GMI_API_KEY"], baseUrl: "GMI_BASE_URL" },
  minimax: { apiKeys: ["MINIMAX_API_KEY"], baseUrl: "MINIMAX_BASE_URL" },
  anthropic: { apiKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"], baseUrl: "ANTHROPIC_BASE_URL" },
  alibaba: { apiKeys: ["DASHSCOPE_API_KEY"], baseUrl: "DASHSCOPE_BASE_URL" },
  "alibaba-coding-plan": { apiKeys: ["ALIBABA_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY"], baseUrl: "ALIBABA_CODING_PLAN_BASE_URL" },
  "minimax-cn": { apiKeys: ["MINIMAX_CN_API_KEY"], baseUrl: "MINIMAX_CN_BASE_URL" },
  deepseek: { apiKeys: ["DEEPSEEK_API_KEY"], baseUrl: "DEEPSEEK_BASE_URL" },
  xai: { apiKeys: ["XAI_API_KEY"], baseUrl: "XAI_BASE_URL" },
  nvidia: { apiKeys: ["NVIDIA_API_KEY"], baseUrl: "NVIDIA_BASE_URL" },
  "ai-gateway": { apiKeys: ["AI_GATEWAY_API_KEY"], baseUrl: "AI_GATEWAY_BASE_URL" },
  "opencode-zen": { apiKeys: ["OPENCODE_ZEN_API_KEY"], baseUrl: "OPENCODE_ZEN_BASE_URL" },
  "opencode-go": { apiKeys: ["OPENCODE_GO_API_KEY"], baseUrl: "OPENCODE_GO_BASE_URL" },
  huggingface: { apiKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY"], baseUrl: "HUGGINGFACE_BASE_URL" },
  kilocode: { apiKeys: ["KILOCODE_API_KEY"], baseUrl: "KILOCODE_BASE_URL" },
  "ollama-cloud": { apiKeys: ["OLLAMA_API_KEY"], baseUrl: "OLLAMA_BASE_URL" },
  "azure-foundry": { apiKeys: ["AZURE_FOUNDRY_API_KEY"], baseUrl: "AZURE_FOUNDRY_BASE_URL" },
  openrouter: { apiKeys: ["OPENROUTER_API_KEY"], baseUrl: "OPENROUTER_BASE_URL" }
});

function platformMap() {
  return new Map(GATEWAY_PLATFORMS.map((platform) => [platform.id, platform]));
}

function clean(value) {
  return String(value || "").trim();
}

function sanitizeGatewayLogText(value = "") {
  return String(value || "")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "***")
    .replace(/(token|botToken|bot_token|authorization)\s*[:=]\s*['"]?[^'"\s]+/gi, "$1=***");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function gatewayPlatformSettings(settings = {}, id) {
  const platforms = settings.gatewayPlatforms && typeof settings.gatewayPlatforms === "object"
    ? settings.gatewayPlatforms
    : {};
  return platforms[id] && typeof platforms[id] === "object" ? platforms[id] : {};
}

function configuredState(settings = {}, secrets = {}, platform) {
  const config = gatewayPlatformSettings(settings, platform.id);
  const platformSecrets = secrets?.[platform.id] || {};
  const missing = [];
  const missingRecommended = [];
  for (const field of platform.requiredFields || []) {
    if (!clean(config[field])) {
      missing.push(field);
    }
  }
  for (const field of platform.recommendedFields || []) {
    if (!clean(config[field])) {
      missingRecommended.push(field);
    }
  }
  for (const field of platform.requiredSecrets || []) {
    if (!clean(platformSecrets[field])) {
      missing.push(field);
    }
  }
  if (platform.anySecret?.length && !platform.anySecret.some((field) => clean(platformSecrets[field]))) {
    missing.push(platform.anySecret.join("|"));
  }
  const configured = missing.length === 0;
  return { enabled: Boolean(config.enabled), configured, missing, missingRecommended };
}

function gatewayRuntimeRouting(settings = {}) {
  try {
    return resolveHermesRoutingSettings(settings);
  } catch {
    return {
      provider: clean(settings.hermesProvider || "custom") || "custom",
      baseUrl: clean(settings.localBaseUrl),
      model: clean(settings.localModel),
      apiKey: clean(settings.localApiKey),
      apiMode: clean(settings.hermesApiMode).toLowerCase() || null
    };
  }
}

function buildGatewayRuntimeConfig(settings = {}) {
  const routing = gatewayRuntimeRouting(settings);
  const model = {};
  if (clean(routing.model)) {
    model.default = clean(routing.model);
  }
  if (clean(routing.provider) && clean(routing.provider) !== "auto") {
    model.provider = clean(routing.provider);
  }
  if (clean(routing.baseUrl)) {
    model.base_url = clean(routing.baseUrl);
  }
  if (clean(routing.apiMode)) {
    model.api_mode = clean(routing.apiMode);
  }
  return {
    model,
    provider: clean(routing.provider),
    baseUrl: clean(routing.baseUrl),
    apiKey: clean(routing.apiKey),
    apiMode: clean(routing.apiMode)
  };
}

function buildGatewayProviderEnv(settings = {}) {
  const runtime = buildGatewayRuntimeConfig(settings);
  const env = {};
  const provider = clean(runtime.provider);
  const baseUrl = clean(runtime.baseUrl);
  const apiKey = clean(runtime.apiKey);

  if (provider && provider !== "auto") {
    env.HERMES_INFERENCE_PROVIDER = provider;
  }
  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl;
    env.CUSTOM_BASE_URL = baseUrl;
  }
  if (apiKey && apiKey !== "not-needed") {
    env.OPENAI_API_KEY = apiKey;
    const providerEnv = PROVIDER_RUNTIME_ENV[provider];
    for (const envName of providerEnv?.apiKeys || []) {
      env[envName] = apiKey;
    }
    if (providerEnv?.baseUrl && baseUrl) {
      env[providerEnv.baseUrl] = baseUrl;
    }
  } else if (provider === "custom") {
    env.OPENAI_API_KEY = "no-key-required";
  }
  return env;
}

function normalizeGatewayBaseUrl(value = "") {
  const source = clean(value);
  if (!source) {
    return "";
  }
  let normalized = source.replace(/#.*$/, "").replace(/\/+$/, "");
  if (!/\/v1$/i.test(normalized)) {
    normalized = normalized.replace(/\/chat(?:\/.*)?$/i, "");
    normalized = normalized.replace(/\/v1\/.*$/i, "/v1");
    if (!/\/v1$/i.test(normalized)) {
      normalized = `${normalized}/v1`;
    }
  }
  return normalized;
}

function isLocalGatewayBaseUrl(value = "") {
  return /^(https?:\/\/)?(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(clean(value));
}

function gatewayLocalBaseUrlCandidates(settings = {}) {
  const seen = new Set();
  const configured = clean(settings.localBaseUrl);
  const host = clean(settings.localLlamaHost || "127.0.0.1") || "127.0.0.1";
  const port = Number(settings.localLlamaPort || 11435);
  const managed = Number.isInteger(port) && port > 0 && port < 65536
    ? `http://${host}:${port}/v1`
    : "";
  return [
    configured,
    managed,
    DEFAULT_LOCAL_BASE_URL,
    "http://localhost:11434/v1",
    "http://localhost:8080/v1",
    "http://localhost:4000/v1"
  ]
    .map(normalizeGatewayBaseUrl)
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function gatewayLocalProviderHeaders(settings = {}) {
  const headers = { "Content-Type": "application/json" };
  const apiKey = clean(settings.localApiKey || "not-needed") || "not-needed";
  headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildGatewayEnv(settings = {}, secrets = {}) {
  const env = {
    ...buildGatewayProviderEnv(settings),
    DREAM_HOST_PLATFORM: process.platform,
    DREAM_HOST_OS_RELEASE: os.release(),
    DREAM_HERMES_ROOT: defaultHermesRoot(),
    HERMES_GATEWAY_PLATFORM_CONNECT_TIMEOUT: String(settings.gatewayPlatformConnectTimeoutSeconds || 360),
    WHATSAPP_BRIDGE_INSTALL_TIMEOUT: String(settings.whatsappBridgeInstallTimeoutSeconds || 300),
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };
  for (const platform of GATEWAY_PLATFORMS) {
    const config = gatewayPlatformSettings(settings, platform.id);
    const platformSecrets = secrets?.[platform.id] || {};
    const state = configuredState(settings, secrets, platform);
    if (!config.enabled || !state.configured) {
      continue;
    }
    if (platform.enabledEnv) {
      env[platform.enabledEnv] = "true";
    }
    for (const [field, envName] of Object.entries(platform.fields || {})) {
      const value = clean(config[field]);
      if (value) {
        env[envName] = value;
      }
    }
    for (const [field, envName] of Object.entries(platform.secretEnv || {})) {
      const value = clean(platformSecrets[field]);
      if (value) {
        env[envName] = value;
      }
    }
  }
  return env;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function gatewaySettingsSignature(settings = {}, secrets = {}) {
  return stableHash({
    enabled: Boolean(settings.gatewayEnabled),
    autoStart: Boolean(settings.gatewayAutoStart),
    env: buildGatewayEnv(settings, secrets)
  });
}

const PAIRING_OPERATIONS = new Set(["pairing_status", "approve_pairing", "revoke_pairing", "clear_pairing"]);

class HermesGatewayManager {
  constructor(options = {}) {
    this.hermesRoot = path.resolve(options.hermesRoot || defaultHermesRoot());
    this.backend = options.backend || new HermesBackend({ hermesRoot: this.hermesRoot });
    this.child = null;
    this.starting = null;
    this.startedAt = null;
    this.lastError = "";
    this.logs = [];
    this.settingsSignature = null;
    this.effectiveEnvSignature = null;
  }

  status(settings = {}, secrets = {}) {
    const platforms = GATEWAY_PLATFORMS.map((platform) => {
      const config = gatewayPlatformSettings(settings, platform.id);
      const state = configuredState(settings, secrets, platform);
      return {
        id: platform.id,
        label: platform.label,
        enabled: state.enabled,
        configured: state.configured,
        missing: state.missing,
        missingRecommended: state.missingRecommended,
        hasSecret: Object.keys(platform.secretEnv || {}).some((field) => clean(secrets?.[platform.id]?.[field])),
        homeChannel: clean(config.homeChannel || config.homeAddress || ""),
        knownChannels: this._knownChannels(platform.id, settings).slice(0, 12),
        sessionActivity: this._platformSessionActivity(platform.id),
        setup: platformSetup(platform.id),
        operations: platformOperationSummary(platform.id)
      };
    });
    return {
      enabled: Boolean(settings.gatewayEnabled),
      autoStart: Boolean(settings.gatewayAutoStart),
      running: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid || null,
      startedAt: this.startedAt,
      lastError: this.lastError,
      logs: this.logs.slice(-40),
      platforms,
      configuredCount: platforms.filter((entry) => entry.enabled && entry.configured).length,
      enabledCount: platforms.filter((entry) => entry.enabled).length
    };
  }

  async ensure(settings = {}, secrets = {}) {
    if (!settings.gatewayEnabled) {
      await this.stop();
      return this.status(settings, secrets);
    }
    if (!this.status(settings, secrets).configuredCount) {
      this.lastError = "Nenhum gateway habilitado possui configuracao minima.";
      await this.stop();
      return this.status(settings, secrets);
    }
    if (!settings.gatewayAutoStart && !(this.child && !this.child.killed)) {
      return this.status(settings, secrets);
    }
    return await this.start(settings, secrets, { reconcile: true });
  }

  async start(settings = {}, secrets = {}, options = {}) {
    const desiredSignature = gatewaySettingsSignature(settings, secrets);
    if (this.child && !this.child.killed) {
      const shouldReconcile = options.reconcile !== false;
      if (shouldReconcile && this.settingsSignature && this.settingsSignature !== desiredSignature) {
        await this.stop();
      } else {
        return this.status(settings, secrets);
      }
    }
    if (this.starting) {
      await this.starting;
      return this.status(settings, secrets);
    }
    if (!this.status(settings, secrets).configuredCount) {
      this.lastError = "Habilite e configure pelo menos um gateway antes de iniciar.";
      return this.status(settings, secrets);
    }
    this.starting = this._start(settings, secrets, desiredSignature);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    return this.status(settings, secrets);
  }

  async _start(settings, secrets, desiredSignature = gatewaySettingsSignature(settings, secrets)) {
    const doctor = await this.backend.doctor({
      timeoutMs: Number(settings.gatewayDoctorTimeoutMs || settings.hermesDoctorTimeoutMs || DEFAULT_DOCTOR_TIMEOUT_MS)
    });
    if (!doctor.ok) {
      this.lastError = doctor.error || "Hermes Python indisponivel para gateway.";
      return;
    }
    const runtimePreparation = await this._prepareRuntimeSettings(settings);
    if (!runtimePreparation.ok) {
      this.lastError = runtimePreparation.error || "Runtime do gateway indisponivel.";
      return;
    }
    const gatewaySettings = runtimePreparation.settings || settings;
    const gatewayEnv = buildGatewayEnv(gatewaySettings, secrets);
    const runtimeSync = await this._syncRuntimeConfig(doctor, gatewaySettings, gatewayEnv);
    if (!runtimeSync.ok) {
      this.lastError = runtimeSync.error || "Nao foi possivel sincronizar a configuracao de runtime do gateway.";
      return;
    }
    const env = {
      ...process.env,
      ...gatewayEnv
    };
    const args = [...(doctor.args || []), "-m", "gateway.run", "--verbose"];
    const child = spawn(doctor.command, args, {
      cwd: this.hermesRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    this.startedAt = Date.now();
    this.lastError = "";
    this.settingsSignature = desiredSignature;
    this.effectiveEnvSignature = stableHash(gatewayEnv);
    const pushLog = (stream, chunk) => {
      const text = sanitizeGatewayLogText(String(chunk || "").replace(/\r/g, "").trim());
      if (!text) {
        return;
      }
      this.logs.push({ time: Date.now(), stream, text: text.slice(-2000) });
      this.logs = this.logs.slice(-80);
    };
    child.stdout.on("data", (chunk) => pushLog("stdout", chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => pushLog("stderr", chunk.toString("utf8")));
    child.on("error", (error) => {
      this.lastError = error.message || String(error);
    });
    child.on("close", (code) => {
      if (this.child === child) {
        this.child = null;
        this.settingsSignature = null;
        this.effectiveEnvSignature = null;
      }
      if (code !== 0 && code !== null) {
        const detail = this._recentLogText(1600);
        this.lastError = `Gateway finalizou com exit code ${code}.${detail ? ` ${detail}` : ""}`;
      }
    });
    const probeMs = Math.max(500, Math.min(Number(settings.gatewayStartupProbeMs || 2500), 10000));
    await sleep(probeMs);
    if (this.child !== child || child.killed) {
      return;
    }
    if (child.exitCode !== null) {
      this.child = null;
      const detail = this._recentLogText(1600);
      this.lastError = `Gateway finalizou com exit code ${child.exitCode}.${detail ? ` ${detail}` : ""}`;
    }
  }

  async _prepareRuntimeSettings(settings = {}) {
    const runtime = buildGatewayRuntimeConfig(settings);
    if (runtime.provider !== "custom" || !isLocalGatewayBaseUrl(runtime.baseUrl || settings.localBaseUrl)) {
      return { ok: true, settings };
    }

    const prepared = {
      ...settings,
      gatewayRuntimeDiagnostics: undefined
    };
    if (prepared.localLlamaEnabled && prepared.localLlamaAutoStart) {
      try {
        const llama = await ensureLocalLlamaServer(prepared, { reason: "gateway_start" });
        if (llama?.baseUrl) {
          prepared.localBaseUrl = llama.baseUrl;
        }
        if (llama?.model) {
          prepared.localModel = llama.model;
        }
      } catch (error) {
        return {
          ok: false,
          error: `Runtime local do gateway nao iniciou: ${error?.message || error}. Configure outro provider/base URL nas Settings ou inicie um servidor OpenAI-compatible.`
        };
      }
    }

    const probe = await this._findReachableLocalRuntime(prepared);
    if (!probe.ok) {
      return {
        ok: false,
        error: `Runtime local do gateway indisponivel. Testei: ${probe.checked.join(", ")}. Ajuste Settings > Runtime/Provider para a URL correta ou habilite o servidor local gerenciado.`
      };
    }
    prepared.localBaseUrl = probe.baseUrl;
    if (probe.model && (!clean(prepared.localModel) || clean(prepared.localModel) === DEFAULT_LOCAL_MODEL)) {
      prepared.localModel = probe.model;
    }
    return { ok: true, settings: prepared, runtime: buildGatewayRuntimeConfig(prepared), probe };
  }

  async _findReachableLocalRuntime(settings = {}) {
    const checked = [];
    for (const baseUrl of gatewayLocalBaseUrlCandidates(settings)) {
      checked.push(baseUrl);
      const response = await requestJson(`${baseUrl}/models`, Number(settings.gatewayRuntimeProbeTimeoutMs || 2500), {
        headers: gatewayLocalProviderHeaders(settings)
      });
      if (!response.ok) {
        continue;
      }
      const models = Array.isArray(response.data?.data) ? response.data.data : [];
      const modelIds = models.map((entry) => clean(entry?.id)).filter(Boolean);
      const configuredModel = clean(settings.localModel);
      const selectedModel = modelIds.includes(configuredModel) ? configuredModel : (modelIds[0] || configuredModel);
      return { ok: true, baseUrl, model: selectedModel, models: modelIds, checked };
    }
    return { ok: false, checked };
  }

  async _syncRuntimeConfig(doctor, settings = {}, gatewayEnv = {}) {
    const payload = buildGatewayRuntimeConfig(settings);
    if (!Object.keys(payload.model || {}).length) {
      return { ok: true, skipped: true };
    }
    const response = await runGatewayPythonJson(doctor, this.hermesRoot, GATEWAY_RUNTIME_CONFIG_SCRIPT, {
      ...process.env,
      ...gatewayEnv,
      DREAM_GATEWAY_RUNTIME_CONFIG: JSON.stringify(payload)
    }, Number(settings.gatewayConfigSyncTimeoutMs || 10000));
    if (!response.ok) {
      return response;
    }
    if (response.data?.ok === false) {
      return { ok: false, error: response.data.error || "Falha ao gravar config.yaml do Hermes.", data: response.data };
    }
    return { ok: true, data: response.data };
  }

  async stop() {
    if (!this.child) {
      return;
    }
    const child = this.child;
    this.child = null;
    this.settingsSignature = null;
    this.effectiveEnvSignature = null;
    try {
      child.kill("SIGTERM");
    } catch {}
  }

  hasPlatform(platformId) {
    return GATEWAY_PLATFORMS.some((platform) => platform.id === String(platformId || ""));
  }

  async restart(settings = {}, secrets = {}) {
    await this.stop();
    return await this.start(settings, secrets);
  }

  _recentLogText(maxChars = 1600) {
    const text = this.logs
      .slice(-8)
      .map((entry) => `${entry.stream}: ${entry.text}`)
      .join("\n")
      .trim();
    if (!text) {
      return "";
    }
    return `Logs recentes:\n${tailText(text, maxChars)}`;
  }

  async waitForPlatformConnection(platformId = "", settings = {}, secrets = {}, options = {}) {
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
    const pollMs = Math.max(500, Number(options.pollMs || 1500));
    const deadline = Date.now() + timeoutMs;
    let snapshot = await this.statusForPlatformAsync(platformId, settings, secrets);
    while (timeoutMs > 0 && Date.now() < deadline) {
      if (snapshot?.diagnostics?.connectedDetected) {
        return { ...snapshot, pairingCompleted: true, pairingTimedOut: false, pairingAwaitingScan: false };
      }
      if (options.returnOnQr && snapshot?.diagnostics?.qrDetected) {
        return { ...snapshot, pairingCompleted: false, pairingTimedOut: false, pairingAwaitingScan: true };
      }
      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      snapshot = await this.statusForPlatformAsync(platformId, settings, secrets);
    }
    return {
      ...snapshot,
      pairingCompleted: Boolean(snapshot?.diagnostics?.connectedDetected),
      pairingTimedOut: !snapshot?.diagnostics?.connectedDetected,
      pairingAwaitingScan: Boolean(snapshot?.diagnostics?.qrDetected && !snapshot?.diagnostics?.connectedDetected)
    };
  }

  async platformGroups(platformId = "", settings = {}, secrets = {}) {
    return await this.platformOperation("groups", platformId, {}, settings, secrets);
  }

  async platformOperation(command = "", platformId = "", params = {}, settings = {}, secrets = {}) {
    const operation = String(command || "").trim().toLowerCase();
    const id = String(platformId || "").trim().toLowerCase();
    const snapshot = await this.statusForPlatformAsync(id, settings, secrets);
    const safeParams = params && typeof params === "object" ? params : {};
    if (PAIRING_OPERATIONS.has(operation)) {
      return await this._pairingOperation(operation, id, snapshot, safeParams, settings);
    }
    if (!platformMap().has(id)) {
      return this._operationError(snapshot, operation, `Gateway desconhecido: ${id || "(vazio)"}.`);
    }
    if (operation === "capabilities") {
      return this._operationSuccess(snapshot, operation, gatewayCapabilities(id));
    }
    if (operation === "status") {
      return this._operationSuccess(snapshot, operation, {
        platform: id,
        setup: platformSetup(id),
        state: snapshot.platform || null,
        diagnostics: snapshot.diagnostics || null
      });
    }
    if (id === "whatsapp") {
      return await this._whatsappOperation(operation, snapshot, safeParams, settings);
    }
    if (id === "telegram") {
      return await this._telegramOperation(operation, snapshot, safeParams, settings, secrets);
    }
    if (id === "discord") {
      return await this._discordOperation(operation, snapshot, safeParams, settings, secrets);
    }
    return this._operationError(snapshot, operation, unsupportedGatewayOperationMessage(id, operation), gatewayCapabilities(id));
  }

  async _whatsappOperation(operation, snapshot, safeParams, settings = {}) {
    const connected = Boolean(snapshot?.diagnostics?.connectedDetected);
    const needsConnection = !["capabilities", "chat"].includes(operation);
    if (needsConnection && !connected) {
      return {
        ...snapshot,
        operation,
        operationResult: null,
        operationError: "WhatsApp ainda nao esta pareado/conectado."
      };
    }

    let response;
    if (operation === "capabilities") {
      response = await this._whatsappBridgeRequest("/capabilities", settings, 5000);
    } else if (operation === "groups") {
      response = await this._whatsappBridgeRequest("/groups", settings, 10000);
    } else if (operation === "chats") {
      response = await this._whatsappBridgeRequest("/chats", settings, 10000);
    } else if (operation === "recent_messages") {
      const limit = Math.max(1, Math.min(100, Number(safeParams.limit || 50)));
      response = await this._whatsappBridgeRequest(`/recent-messages?limit=${encodeURIComponent(String(limit))}`, settings, 10000);
    } else if (operation === "chat") {
      const chatId = clean(safeParams.chatId || safeParams.id);
      if (!chatId) {
        return { ...snapshot, operation, operationResult: null, operationError: "chatId e obrigatorio." };
      }
      response = await this._whatsappBridgeRequest(`/chat/${encodeURIComponent(chatId)}`, settings, 10000);
    } else if (operation === "send") {
      const chatId = clean(safeParams.chatId);
      const message = String(safeParams.message || "");
      if (!chatId || !message.trim()) {
        return { ...snapshot, operation, operationResult: null, operationError: "chatId e message sao obrigatorios." };
      }
      response = await this._whatsappBridgeRequest("/send", settings, 30000, { method: "POST", body: { chatId, message, replyTo: safeParams.replyTo } });
    } else if (operation === "edit") {
      const chatId = clean(safeParams.chatId);
      const messageId = clean(safeParams.messageId);
      const message = String(safeParams.message || "");
      if (!chatId || !messageId || !message.trim()) {
        return { ...snapshot, operation, operationResult: null, operationError: "chatId, messageId e message sao obrigatorios." };
      }
      response = await this._whatsappBridgeRequest("/edit", settings, 30000, { method: "POST", body: { chatId, messageId, message } });
    } else if (operation === "send_media") {
      const chatId = clean(safeParams.chatId);
      const filePath = clean(safeParams.filePath);
      if (!chatId || !filePath) {
        return { ...snapshot, operation, operationResult: null, operationError: "chatId e filePath sao obrigatorios." };
      }
      response = await this._whatsappBridgeRequest("/send-media", settings, 120000, {
        method: "POST",
        body: {
          chatId,
          filePath,
          mediaType: clean(safeParams.mediaType),
          caption: String(safeParams.caption || ""),
          fileName: clean(safeParams.fileName)
        }
      });
    } else if (operation === "typing") {
      const chatId = clean(safeParams.chatId);
      if (!chatId) {
        return { ...snapshot, operation, operationResult: null, operationError: "chatId e obrigatorio." };
      }
      response = await this._whatsappBridgeRequest("/typing", settings, 10000, { method: "POST", body: { chatId } });
    } else {
      return { ...snapshot, operation, operationResult: null, operationError: `Operacao de gateway invalida: ${operation || "(vazia)"}.` };
    }

    if (!response.ok) {
      return {
        ...snapshot,
        operation,
        operationResult: response.data || null,
        operationError: response.error || response.data?.error || "Falha na operacao do bridge."
      };
    }
    return {
      ...snapshot,
      operation,
      operationResult: response.data,
      operationError: ""
    };
  }

  async _telegramOperation(operation, snapshot, safeParams, settings = {}, secrets = {}) {
    const token = clean(secrets?.telegram?.botToken);
    if (operation === "capabilities") {
      return this._operationSuccess(snapshot, operation, {
        platform: "telegram",
        operations: telegramCapabilities()
      });
    }
    if (operation === "chats" || operation === "groups") {
      const chats = this._knownChannels("telegram", settings);
      return this._operationSuccess(snapshot, operation, {
        platform: "telegram",
        chats: operation === "groups" ? chats.filter((chat) => isGroupLike(chat)) : chats,
        groups: chats.filter((chat) => isGroupLike(chat)),
        note: "A Telegram Bot API nao permite enumerar todos os chats/grupos. Esta lista vem do diretorio/sessoes do Hermes e do Home channel configurado."
      });
    }
    if (!token) {
      return this._operationError(snapshot, operation, "Telegram precisa de botToken configurado.");
    }
    if (operation === "identity" || operation === "status") {
      const response = await telegramApiRequest(token, "getMe", {}, 10000);
      return this._operationFromResponse(snapshot, operation, response);
    }
    if (operation === "chat") {
      const chatId = this._resolveTarget("telegram", safeParams, settings);
      if (!chatId) {
        return this._operationError(snapshot, operation, "chatId e obrigatorio.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await telegramApiRequest(token, "getChat", { chat_id: target.chatId }, 10000);
      return this._operationFromResponse(snapshot, operation, response, normalizeTelegramChat);
    }
    if (operation === "send") {
      const chatId = this._resolveTarget("telegram", safeParams, settings);
      const message = String(safeParams.message || "");
      if (!chatId || !message.trim()) {
        return this._operationError(snapshot, operation, "chatId e message sao obrigatorios.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const body = { chat_id: target.chatId, text: message };
      if (target.threadId) {
        body.message_thread_id = target.threadId;
      }
      if (clean(safeParams.replyTo)) {
        body.reply_to_message_id = clean(safeParams.replyTo);
      }
      const response = await telegramApiRequest(token, "sendMessage", body, 30000);
      return this._operationFromResponse(snapshot, operation, response, telegramMessageResult);
    }
    if (operation === "edit") {
      const chatId = this._resolveTarget("telegram", safeParams, settings);
      const messageId = clean(safeParams.messageId);
      const message = String(safeParams.message || "");
      if (!chatId || !messageId || !message.trim()) {
        return this._operationError(snapshot, operation, "chatId, messageId e message sao obrigatorios.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await telegramApiRequest(token, "editMessageText", { chat_id: target.chatId, message_id: messageId, text: message }, 30000);
      return this._operationFromResponse(snapshot, operation, response, telegramMessageResult);
    }
    if (operation === "typing") {
      const chatId = this._resolveTarget("telegram", safeParams, settings);
      if (!chatId) {
        return this._operationError(snapshot, operation, "chatId e obrigatorio.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const body = { chat_id: target.chatId, action: "typing" };
      if (target.threadId) {
        body.message_thread_id = target.threadId;
      }
      const response = await telegramApiRequest(token, "sendChatAction", body, 10000);
      return this._operationFromResponse(snapshot, operation, response, (data) => ({ success: Boolean(data?.ok ?? true) }));
    }
    if (operation === "send_media") {
      const chatId = this._resolveTarget("telegram", safeParams, settings);
      const filePath = clean(safeParams.filePath);
      if (!chatId || !filePath) {
        return this._operationError(snapshot, operation, "chatId e filePath sao obrigatorios.");
      }
      const response = await telegramSendMedia(token, {
        ...parseThreadTarget(chatId, clean(safeParams.threadId)),
        filePath,
        mediaType: clean(safeParams.mediaType),
        caption: String(safeParams.caption || ""),
        fileName: clean(safeParams.fileName)
      });
      return this._operationFromResponse(snapshot, operation, response, telegramMessageResult);
    }
    return this._operationError(snapshot, operation, `Operacao de Telegram invalida: ${operation || "(vazia)"}.`);
  }

  async _discordOperation(operation, snapshot, safeParams, settings = {}, secrets = {}) {
    const token = clean(secrets?.discord?.botToken);
    if (operation === "capabilities") {
      return this._operationSuccess(snapshot, operation, {
        platform: "discord",
        operations: discordCapabilities()
      });
    }
    if (!token && operation !== "chats") {
      return this._operationError(snapshot, operation, "Discord precisa de botToken configurado.");
    }
    if (operation === "identity" || operation === "status") {
      const response = await discordApiRequest(token, "/users/@me", { timeoutMs: 10000 });
      return this._operationFromResponse(snapshot, operation, response);
    }
    if (operation === "guilds") {
      const response = await discordApiRequest(token, "/users/@me/guilds", { timeoutMs: 15000 });
      return this._operationFromResponse(snapshot, operation, response, (data) => ({ guilds: normalizeDiscordGuilds(data) }));
    }
    if (operation === "channels" || operation === "groups" || operation === "chats") {
      const guildId = clean(safeParams.guildId || safeParams.serverId);
      const known = this._knownChannels("discord", settings);
      if (!token) {
        return this._operationSuccess(snapshot, operation, {
          platform: "discord",
          chats: known,
          channels: known,
          note: "Sem botToken, mostrei apenas canais conhecidos pelo diretorio/sessoes do Hermes."
        });
      }
      const response = await listDiscordChannels(token, guildId);
      if (!response.ok) {
        return this._operationError(snapshot, operation, response.error || "Falha ao listar canais do Discord.", response.data);
      }
      const channels = mergeKnownChannels(response.data.channels || [], known);
      return this._operationSuccess(snapshot, operation, {
        platform: "discord",
        guilds: response.data.guilds || [],
        channels,
        chats: channels,
        groups: channels.filter((chat) => isGroupLike(chat))
      });
    }
    if (operation === "chat") {
      const chatId = this._resolveTarget("discord", safeParams, settings);
      if (!chatId) {
        return this._operationError(snapshot, operation, "chatId e obrigatorio.");
      }
      const response = await discordApiRequest(token, `/channels/${encodeURIComponent(chatId)}`, { timeoutMs: 10000 });
      return this._operationFromResponse(snapshot, operation, response, normalizeDiscordChannel);
    }
    if (operation === "send") {
      const chatId = this._resolveTarget("discord", safeParams, settings);
      const message = String(safeParams.message || "");
      if (!chatId || !message.trim()) {
        return this._operationError(snapshot, operation, "chatId e message sao obrigatorios.");
      }
      const body = { content: message };
      if (clean(safeParams.replyTo)) {
        body.message_reference = { message_id: clean(safeParams.replyTo) };
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await discordApiRequest(token, `/channels/${encodeURIComponent(target.threadId || target.chatId)}/messages`, {
        method: "POST",
        body,
        timeoutMs: 30000
      });
      return this._operationFromResponse(snapshot, operation, response, discordMessageResult);
    }
    if (operation === "edit") {
      const chatId = this._resolveTarget("discord", safeParams, settings);
      const messageId = clean(safeParams.messageId);
      const message = String(safeParams.message || "");
      if (!chatId || !messageId || !message.trim()) {
        return this._operationError(snapshot, operation, "chatId, messageId e message sao obrigatorios.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await discordApiRequest(token, `/channels/${encodeURIComponent(target.threadId || target.chatId)}/messages/${encodeURIComponent(messageId)}`, {
        method: "PATCH",
        body: { content: message },
        timeoutMs: 30000
      });
      return this._operationFromResponse(snapshot, operation, response, discordMessageResult);
    }
    if (operation === "typing") {
      const chatId = this._resolveTarget("discord", safeParams, settings);
      if (!chatId) {
        return this._operationError(snapshot, operation, "chatId e obrigatorio.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await discordApiRequest(token, `/channels/${encodeURIComponent(target.threadId || target.chatId)}/typing`, {
        method: "POST",
        timeoutMs: 10000
      });
      return this._operationFromResponse(snapshot, operation, response, () => ({ success: true }));
    }
    if (operation === "send_media") {
      const chatId = this._resolveTarget("discord", safeParams, settings);
      const filePath = clean(safeParams.filePath);
      if (!chatId || !filePath) {
        return this._operationError(snapshot, operation, "chatId e filePath sao obrigatorios.");
      }
      const target = parseThreadTarget(chatId, clean(safeParams.threadId));
      const response = await discordSendMedia(token, {
        chatId: target.threadId || target.chatId,
        filePath,
        caption: String(safeParams.caption || ""),
        fileName: clean(safeParams.fileName)
      });
      return this._operationFromResponse(snapshot, operation, response, discordMessageResult);
    }
    return this._operationError(snapshot, operation, `Operacao de Discord invalida: ${operation || "(vazia)"}.`);
  }

  async _pairingOperation(operation, platformId, snapshot, safeParams, settings = {}) {
    const code = clean(safeParams.code || safeParams.pairingCode || safeParams.approvalCode).toUpperCase();
    const userId = clean(safeParams.userId || safeParams.user_id);
    if (operation === "approve_pairing" && !code) {
      return this._operationError(snapshot, operation, "Codigo de aprovacao e obrigatorio.");
    }
    if (operation === "revoke_pairing" && !userId) {
      return this._operationError(snapshot, operation, "userId e obrigatorio para revogar aprovacao.");
    }

    const doctor = await this.backend.doctor({
      timeoutMs: Number(settings.gatewayDoctorTimeoutMs || settings.hermesDoctorTimeoutMs || DEFAULT_DOCTOR_TIMEOUT_MS)
    });
    if (!doctor.ok) {
      return this._operationError(snapshot, operation, doctor.error || "Hermes Python indisponivel para pairing.");
    }

    const payload = { operation, platformId, code, userId };
    const response = await runGatewayPythonJson(doctor, this.hermesRoot, GATEWAY_PAIRING_SCRIPT, {
      ...process.env,
      ...buildGatewayEnv(settings, {}),
      DREAM_PAIRING_PAYLOAD: JSON.stringify(payload)
    }, Number(safeParams.timeoutMs || 10000));

    if (!response.ok) {
      return this._operationError(snapshot, operation, response.error || "Falha ao consultar pairing do Hermes.", response.data || null);
    }
    if (response.data?.ok === false) {
      return this._operationError(snapshot, operation, response.data.error || "Operacao de pairing falhou.", response.data);
    }
    return this._operationSuccess(snapshot, operation, response.data);
  }

  _operationSuccess(snapshot, operation, operationResult) {
    return { ...snapshot, operation, operationResult, operationError: "" };
  }

  _operationError(snapshot, operation, operationError, operationResult = null) {
    return { ...snapshot, operation, operationResult, operationError };
  }

  _operationFromResponse(snapshot, operation, response, normalize = null) {
    if (!response.ok) {
      return this._operationError(snapshot, operation, response.error || "Falha na operacao do gateway.", response.data || null);
    }
    const data = typeof normalize === "function" ? normalize(response.data) : response.data;
    return this._operationSuccess(snapshot, operation, data);
  }

  _resolveTarget(platformId, safeParams = {}, settings = {}) {
    const prefix = `${platformId}:`;
    let explicit = clean(safeParams.chatId || safeParams.chat_id || safeParams.id);
    if (explicit.toLowerCase().startsWith(prefix)) {
      explicit = explicit.slice(prefix.length).trim();
    }
    if (explicit) {
      return explicit;
    }
    let target = clean(safeParams.target);
    if (!target) {
      return "";
    }
    if (target.toLowerCase().startsWith(prefix)) {
      target = target.slice(prefix.length).trim();
    }
    if (target.toLowerCase() === platformId) {
      return clean(gatewayPlatformSettings(settings, platformId).homeChannel);
    }
    const normalized = normalizeChannelQuery(target);
    for (const channel of this._knownChannels(platformId, settings)) {
      const name = clean(channel.name);
      const id = clean(channel.id);
      const guild = clean(channel.guild);
      const candidates = [
        id,
        name,
        name ? `#${name}` : "",
        guild && name ? `${guild}/${name}` : "",
        guild && name ? `${guild}/#${name}` : ""
      ].map(normalizeChannelQuery);
      if (candidates.includes(normalized)) {
        return id;
      }
    }
    return target;
  }

  _knownChannels(platformId, settings = {}) {
    const home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
    const channels = [];
    const seen = new Set();
    const add = (entry = {}) => {
      const id = clean(entry.id || entry.chat_id || entry.chatId);
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      channels.push({
        id,
        name: clean(entry.name || entry.subject || entry.chat_name || entry.user_name || id),
        guild: clean(entry.guild || entry.server || ""),
        type: clean(entry.type || entry.chat_type || ""),
        threadId: clean(entry.thread_id || entry.threadId || ""),
        source: clean(entry.source || "hermes")
      });
    };
    const config = gatewayPlatformSettings(settings, platformId);
    if (clean(config.homeChannel)) {
      add({ id: clean(config.homeChannel), name: "Home channel", type: "configured", source: "settings" });
    }
    try {
      const directoryPath = path.join(home, "channel_directory.json");
      if (fs.existsSync(directoryPath)) {
        const data = JSON.parse(fs.readFileSync(directoryPath, "utf8"));
        for (const entry of data?.platforms?.[platformId] || []) {
          add(entry);
        }
      }
    } catch {}
    try {
      const sessionsPath = path.join(home, "sessions", "sessions.json");
      if (fs.existsSync(sessionsPath)) {
        const data = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
        for (const session of Object.values(data || {})) {
          const origin = session?.origin || {};
          if (String(origin.platform || "").toLowerCase() !== platformId) {
            continue;
          }
          const chatId = clean(origin.thread_id ? `${origin.chat_id}:${origin.thread_id}` : origin.chat_id);
          add({
            id: chatId,
            name: origin.chat_name || origin.user_name || chatId,
            type: session?.chat_type || "dm",
            thread_id: origin.thread_id,
            source: "sessions"
          });
        }
      }
    } catch {}
    return channels;
  }

  _platformSessionActivity(platformId = "") {
    const id = String(platformId || "").trim().toLowerCase();
    const home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
    const sessionsDir = path.join(home, "sessions");
    const summary = {
      sessions: [],
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      firstUpdatedAt: 0,
      lastUpdatedAt: 0,
      recentMessages: []
    };
    if (!id) {
      return summary;
    }

    let registry = {};
    try {
      const registryPath = path.join(sessionsDir, "sessions.json");
      if (fs.existsSync(registryPath)) {
        registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      }
    } catch {
      registry = {};
    }

    const candidates = Object.values(registry || {}).filter((entry) => {
      const origin = entry?.origin || {};
      return String(entry?.platform || origin.platform || "").toLowerCase() === id;
    });

    for (const entry of candidates) {
      const sessionId = clean(entry.session_id || entry.id);
      const origin = entry.origin || {};
      const updatedAt = Date.parse(entry.updated_at || entry.last_updated || "") || 0;
      const startedAt = Date.parse(entry.created_at || entry.started_at || entry.created || "") || 0;
      const session = {
        sessionKey: clean(entry.session_key),
        sessionId,
        displayName: clean(entry.display_name || origin.chat_name || origin.user_name || origin.chat_id || sessionId),
        chatId: clean(origin.chat_id || entry.chat_id || ""),
        chatType: clean(entry.chat_type || origin.chat_type || ""),
        startedAt,
        updatedAt,
        messageCount: Number(entry.message_count || 0) || 0,
        inputTokens: Number(entry.input_tokens || 0) || 0,
        outputTokens: Number(entry.output_tokens || 0) || 0,
        totalTokens: Number(entry.total_tokens || 0) || 0
      };

      let messages = [];
      if (sessionId) {
        const names = [`session_${sessionId}.json`, `${sessionId}.json`];
        for (const name of names) {
          try {
            const sessionPath = path.join(sessionsDir, name);
            if (!fs.existsSync(sessionPath)) {
              continue;
            }
            const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
            const stat = fs.statSync(sessionPath);
            session.messageCount = Number(data.message_count || session.messageCount || 0) || 0;
            const fileStartedAt = Date.parse(data.created_at || data.started_at || "") || stat.birthtimeMs || stat.ctimeMs || 0;
            const fileUpdatedAt = Date.parse(data.last_updated || data.updated_at || "") || stat.mtimeMs || 0;
            session.startedAt = session.startedAt ? Math.min(session.startedAt, fileStartedAt || session.startedAt) : fileStartedAt;
            session.updatedAt = Math.max(session.updatedAt || 0, fileUpdatedAt);
            messages = Array.isArray(data.messages) ? data.messages : [];
            break;
          } catch {}
        }
      }

      summary.messageCount += session.messageCount;
      summary.inputTokens += session.inputTokens;
      summary.outputTokens += session.outputTokens;
      summary.totalTokens += session.totalTokens;
      if (session.startedAt) {
        summary.firstUpdatedAt = summary.firstUpdatedAt
          ? Math.min(summary.firstUpdatedAt, session.startedAt)
          : session.startedAt;
      }
      summary.lastUpdatedAt = Math.max(summary.lastUpdatedAt, session.updatedAt || 0);
      summary.sessions.push(session);
      for (const [index, message] of messages.entries()) {
        const role = clean(message?.role || message?.kind || message?.type || "message");
        const text = clean(message?.content || message?.text || message?.message || "");
        if (!text) {
          continue;
        }
        summary.recentMessages.push({
          role,
          text: tailText(text, 360),
          sessionId,
          displayName: session.displayName,
          chatId: session.chatId,
          timestamp: session.updatedAt || updatedAt || 0,
          index
        });
      }
    }

    summary.sessions.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    summary.recentMessages.sort((left, right) => {
      const timeDelta = Number(right.timestamp || 0) - Number(left.timestamp || 0);
      return timeDelta || Number(right.index || 0) - Number(left.index || 0);
    });
    summary.sessions = summary.sessions.slice(0, 10);
    summary.recentMessages = summary.recentMessages.slice(0, 12);
    return summary;
  }

  platformDiagnostics(platformId = "") {
    const id = String(platformId || "").trim().toLowerCase();
    if (!id) {
      return null;
    }
    const diagnostics = {
      platformId: id,
      logs: "",
      logPath: "",
      qrImagePath: "",
      qrPayloadPath: "",
      qrDetected: false,
      qrAgeSeconds: null,
      qrExpired: false,
      connectedDetected: false,
      checkedPaths: []
    };
    if (id === "whatsapp") {
      const maxAgeSeconds = this._whatsappQrMaxAgeSeconds();
      for (const qrPath of this._whatsappQrImageCandidates()) {
        try {
          if (qrPath && fs.existsSync(qrPath)) {
            const stat = fs.statSync(qrPath);
            diagnostics.qrImagePath = qrPath;
            diagnostics.qrDetected = true;
            diagnostics.qrAgeSeconds = Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 1000));
            diagnostics.qrExpired = diagnostics.qrAgeSeconds > maxAgeSeconds;
            break;
          }
        } catch {}
      }
      for (const payloadPath of this._whatsappQrPayloadCandidates()) {
        try {
          if (payloadPath && fs.existsSync(payloadPath)) {
            diagnostics.qrPayloadPath = payloadPath;
            diagnostics.qrDetected = true;
            break;
          }
        } catch {}
      }
    }
    const candidates = this._platformLogCandidates(id);
    diagnostics.checkedPaths = candidates;
    for (const candidate of candidates) {
      try {
        if (!candidate || !fs.existsSync(candidate)) {
          continue;
        }
        const text = fs.readFileSync(candidate, "utf8");
        diagnostics.logs = tailText(text, 12000);
        diagnostics.logPath = candidate;
        diagnostics.qrDetected = id === "whatsapp" && /\b(qr|scan this qr|waiting for scan|parear|pair)/i.test(diagnostics.logs);
        diagnostics.pairingDetected = id !== "whatsapp" && /\b(pairing code|approval code|authorize|approve|codigo|código|pair)/i.test(diagnostics.logs);
        diagnostics.connectedDetected = /\b(whatsapp connected|connected|ready|authenticated|pareado|autenticado)/i.test(diagnostics.logs);
        break;
      } catch {}
    }
    if (!diagnostics.logs) {
      const platform = GATEWAY_PLATFORMS.find((entry) => entry.id === id);
      const aliases = [id, platform?.label]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const runtimeLogs = this.logs
        .filter((entry) => {
          const text = String(entry?.text || "").toLowerCase();
          return aliases.some((alias) => text.includes(alias));
        })
        .slice(-8);
      const selectedLogs = runtimeLogs.length ? runtimeLogs : this.logs.slice(-8);
      if (selectedLogs.length) {
        diagnostics.logs = selectedLogs
          .map((entry) => `[${entry.stream || "log"}] ${entry.text || ""}`)
          .join("\n");
        diagnostics.qrDetected = id === "whatsapp" && /\b(qr|scan this qr|waiting for scan|parear|pair)/i.test(diagnostics.logs);
        diagnostics.pairingDetected = id !== "whatsapp" && /\b(pairing code|approval code|authorize|approve|codigo|código|pair)/i.test(diagnostics.logs);
        diagnostics.connectedDetected = /\b(whatsapp connected|connected|ready|authenticated|pareado|autenticado)/i.test(diagnostics.logs);
      }
    }
    return diagnostics;
  }

  async platformDiagnosticsAsync(platformId = "", settings = {}, status = null) {
    const diagnostics = this.platformDiagnostics(platformId);
    if (!diagnostics || diagnostics.platformId !== "whatsapp") {
      return diagnostics;
    }

    const health = await this._whatsappBridgeRequest("/health", settings, 1500);
    diagnostics.bridgeHealth = {
      reachable: health.ok,
      statusCode: health.statusCode || 0,
      status: String(health.data?.status || ""),
      queueLength: Number.isFinite(health.data?.queueLength) ? health.data.queueLength : null,
      uptime: Number.isFinite(health.data?.uptime) ? health.data.uptime : null,
      qrAvailable: Boolean(health.data?.qrAvailable),
      qrAgeSeconds: Number.isFinite(health.data?.qrAgeSeconds) ? health.data.qrAgeSeconds : diagnostics.qrAgeSeconds,
      qrExpired: Boolean(health.data?.qrExpired || diagnostics.qrExpired),
      error: health.ok ? "" : (health.error || "")
    };
    if (Number.isFinite(health.data?.qrAgeSeconds)) {
      diagnostics.qrAgeSeconds = health.data.qrAgeSeconds;
      diagnostics.qrExpired = Boolean(health.data?.qrExpired);
    }
    diagnostics.bridgeReachable = health.ok;
    if (health.ok && String(health.data?.status || "").toLowerCase() === "connected") {
      diagnostics.connectedDetected = true;
      diagnostics.qrDetected = false;
      diagnostics.qrImagePath = "";
      diagnostics.qrPayloadPath = "";
      diagnostics.qrStale = false;
      this._clearWhatsappQrFiles();
      return diagnostics;
    }

    const managerRunning = status ? Boolean(status.running) : Boolean(this.child && !this.child.killed);
    diagnostics.qrStale = Boolean(diagnostics.qrDetected && (!health.ok && !managerRunning));
    if (diagnostics.qrExpired || diagnostics.qrStale) {
      diagnostics.staleQrImagePath = diagnostics.qrImagePath;
      diagnostics.staleQrPayloadPath = diagnostics.qrPayloadPath;
      diagnostics.qrImagePath = "";
      diagnostics.qrPayloadPath = "";
      diagnostics.qrDetected = false;
    }
    return diagnostics;
  }

  statusForPlatform(platformId = "", settings = {}, secrets = {}) {
    const status = this.status(settings, secrets);
    const platform = status.platforms.find((entry) => entry.id === String(platformId || "")) || null;
    return {
      status,
      platform,
      diagnostics: platform ? this.platformDiagnostics(platform.id) : null
    };
  }

  async statusForPlatformAsync(platformId = "", settings = {}, secrets = {}) {
    const status = this.status(settings, secrets);
    const platform = status.platforms.find((entry) => entry.id === String(platformId || "")) || null;
    return {
      status,
      platform,
      diagnostics: platform ? await this.platformDiagnosticsAsync(platform.id, settings, status) : null
    };
  }

  _platformLogCandidates(platformId) {
    const home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
    if (platformId === "whatsapp") {
      return [
        path.join(home, "platforms", "whatsapp", "bridge.log"),
        path.join(home, "whatsapp", "bridge.log"),
        path.join(os.homedir(), ".hermes", "platforms", "whatsapp", "bridge.log"),
        path.join(os.homedir(), ".hermes", "whatsapp", "bridge.log")
      ];
    }
    return [
      path.join(home, "platforms", platformId, "gateway.log"),
      path.join(home, platformId, "gateway.log"),
      path.join(os.homedir(), ".hermes", "platforms", platformId, "gateway.log"),
      path.join(os.homedir(), ".hermes", platformId, "gateway.log")
    ];
  }

  _whatsappQrImageCandidates() {
    const home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
    return [
      path.join(home, "platforms", "whatsapp", "qr.svg"),
      path.join(home, "whatsapp", "qr.svg"),
      path.join(os.homedir(), ".hermes", "platforms", "whatsapp", "qr.svg"),
      path.join(os.homedir(), ".hermes", "whatsapp", "qr.svg")
    ];
  }

  _whatsappQrPayloadCandidates() {
    const home = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
    return [
      path.join(home, "platforms", "whatsapp", "qr.txt"),
      path.join(home, "whatsapp", "qr.txt"),
      path.join(os.homedir(), ".hermes", "platforms", "whatsapp", "qr.txt"),
      path.join(os.homedir(), ".hermes", "whatsapp", "qr.txt")
    ];
  }

  _whatsappBridgePort(settings = {}) {
    const config = gatewayPlatformSettings(settings, "whatsapp");
    const raw = config.bridgePort || settings.whatsappBridgePort || process.env.WHATSAPP_BRIDGE_PORT || 3000;
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000;
  }

  _whatsappQrMaxAgeSeconds(settings = {}) {
    const raw = settings.whatsappQrMaxAgeSeconds || process.env.WHATSAPP_QR_MAX_AGE_SECONDS || 90;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 30 ? seconds : 90;
  }

  async _whatsappBridgeRequest(route, settings = {}, timeoutMs = 1500, options = {}) {
    const port = this._whatsappBridgePort(settings);
    return await requestJson(`http://127.0.0.1:${port}${route}`, timeoutMs, options);
  }

  _clearWhatsappQrFiles() {
    for (const candidate of [...this._whatsappQrImageCandidates(), ...this._whatsappQrPayloadCandidates()]) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      } catch {}
    }
  }
}

function tailText(text, maxChars) {
  const normalized = String(text || "").replace(/\r/g, "");
  const limit = Math.max(1000, Number(maxChars || 12000));
  return normalized.length > limit ? normalized.slice(-limit) : normalized;
}

function requestJson(url, timeoutMs = 1500, options = {}) {
  return new Promise((resolve) => {
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const request = http.request(url, {
      method: String(options.method || "GET").toUpperCase(),
      timeout: Math.max(250, Number(timeoutMs || 1500)),
      headers: {
        ...(options.headers || {}),
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {})
      }
    }, (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = chunks.join("");
        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          data = { body };
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode || 0,
          data,
          error: response.statusCode >= 200 && response.statusCode < 300 ? "" : (data.error || body || `HTTP ${response.statusCode}`)
        });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, statusCode: 0, data: {}, error: error.message || String(error) });
    });
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

const GATEWAY_PAIRING_SCRIPT = String.raw`
import json
import os
import sys
from pathlib import Path

payload = json.loads(os.environ.get("DREAM_PAIRING_PAYLOAD") or "{}")
root = Path(os.environ["DREAM_HERMES_ROOT"])
sys.path.insert(0, str(root))

from gateway.pairing import PairingStore

store = PairingStore()
operation = str(payload.get("operation") or "").strip().lower()
platform = str(payload.get("platformId") or "").strip().lower()
code = str(payload.get("code") or "").strip().upper()
user_id = str(payload.get("userId") or "").strip()

def snapshot(extra=None):
    data = {
        "ok": True,
        "platform": platform or "all",
        "pending": store.list_pending(platform or None),
        "approvedUsers": store.list_approved(platform or None),
    }
    if extra:
        data.update(extra)
    return data

if not platform and operation == "approve_pairing" and code:
    matches = [entry for entry in store.list_pending(None) if str(entry.get("code") or "").upper() == code]
    if len(matches) == 1:
        platform = str(matches[0].get("platform") or "").strip().lower()
    elif len(matches) > 1:
        print(json.dumps({"ok": False, "error": "Codigo existe em mais de uma plataforma; informe platform.", "code": code, "pending": matches}, ensure_ascii=False))
        raise SystemExit(0)
    else:
        print(json.dumps({"ok": False, "platform": "all", "code": code, "error": "Codigo invalido, expirado ou ja aprovado.", "pending": store.list_pending(None), "approvedUsers": store.list_approved(None)}, ensure_ascii=False))
        raise SystemExit(0)

if not platform and operation not in {"pairing_status"}:
    print(json.dumps({"ok": False, "error": "platform e obrigatorio para esta operacao."}, ensure_ascii=False))
elif operation == "pairing_status":
    print(json.dumps(snapshot(), ensure_ascii=False))
elif operation == "approve_pairing":
    if not code:
        print(json.dumps({"ok": False, "error": "code e obrigatorio."}, ensure_ascii=False))
    else:
        approved = store.approve_code(platform, code)
        if approved:
            print(json.dumps(snapshot({"approved": approved, "code": code}), ensure_ascii=False))
        else:
            print(json.dumps({"ok": False, "platform": platform, "code": code, "error": "Codigo invalido, expirado ou ja aprovado.", "pending": store.list_pending(platform), "approvedUsers": store.list_approved(platform)}, ensure_ascii=False))
elif operation == "revoke_pairing":
    if not user_id:
        print(json.dumps({"ok": False, "error": "userId e obrigatorio."}, ensure_ascii=False))
    else:
        revoked = store.revoke(platform, user_id)
        print(json.dumps(snapshot({"revoked": revoked, "userId": user_id}), ensure_ascii=False))
elif operation == "clear_pairing":
    cleared = store.clear_pending(platform)
    print(json.dumps(snapshot({"clearedPending": cleared}), ensure_ascii=False))
else:
    print(json.dumps({"ok": False, "error": f"Operacao de pairing invalida: {operation}"}, ensure_ascii=False))
`;

const GATEWAY_RUNTIME_CONFIG_SCRIPT = String.raw`
import json
import os
import sys
from pathlib import Path

root = Path(os.environ["DREAM_HERMES_ROOT"])
sys.path.insert(0, str(root))

payload = json.loads(os.environ.get("DREAM_GATEWAY_RUNTIME_CONFIG") or "{}")
model_payload = payload.get("model") if isinstance(payload.get("model"), dict) else {}

from hermes_constants import get_hermes_home
from utils import atomic_yaml_write

home = get_hermes_home()
home.mkdir(parents=True, exist_ok=True)
config_path = home / "config.yaml"

try:
    import yaml
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
    else:
        config = {}
    if not isinstance(config, dict):
        config = {}

    current_model = config.get("model")
    if isinstance(current_model, dict):
        model_config = dict(current_model)
    elif isinstance(current_model, str) and current_model.strip():
        model_config = {"default": current_model.strip()}
    else:
        model_config = {}

    for key in ("default", "provider", "base_url", "api_mode"):
        value = str(model_payload.get(key) or "").strip()
        if value:
            model_config[key] = value

    if model_config:
        config["model"] = model_config

    atomic_yaml_write(config_path, config)
    print(json.dumps({
        "ok": True,
        "configPath": str(config_path),
        "model": {
            key: model_config.get(key)
            for key in ("default", "provider", "base_url", "api_mode")
            if model_config.get(key)
        }
    }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "configPath": str(config_path)}, ensure_ascii=False))
`;

function runGatewayPythonJson(doctor, cwd, script, env = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn(doctor.command, [...(doctor.args || []), "-c", script], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timeout = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      try {
        child.kill("SIGTERM");
      } catch {}
      resolve({ ok: false, data: null, error: "Timeout ao executar operacao do Hermes." });
    }, Math.max(1000, Math.min(Number(timeoutMs || 10000), 30000)));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      resolve({ ok: false, data: null, error: error.message || String(error) });
    });
    child.on("close", (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ ok: false, data: null, error: sanitizeGatewayLogText(stderr || stdout || `Python saiu com code ${code}`) });
        return;
      }
      try {
        const jsonLine = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .reverse()
          .find((line) => line.startsWith("{") && line.endsWith("}"));
        const data = JSON.parse(jsonLine || "{}");
        resolve({ ok: true, data, error: "" });
      } catch {
        resolve({ ok: false, data: null, error: `Resposta de pairing invalida: ${sanitizeGatewayLogText(stdout || stderr)}` });
      }
    });
  });
}

function gatewayOperation(command, method, endpoint, required = [], options = {}) {
  return {
    command,
    method,
    endpoint,
    required,
    requiresConnection: Boolean(options.requiresConnection),
    nonDestructive: Boolean(options.nonDestructive),
    note: options.note || ""
  };
}

function platformSetup(platformId) {
  const id = String(platformId || "").trim().toLowerCase();
  const platform = platformMap().get(id);
  const setup = GATEWAY_PLATFORM_SETUPS[id] || {};
  return {
    platform: id,
    label: platform?.label || id,
    authMode: setup.authMode || "Hermes gateway adapter",
    connectionMode: setup.connectionMode || `${id}_adapter`,
    usesQr: Boolean(setup.usesQr),
    usesPairingApproval: Boolean(setup.usesPairingApproval),
    directApi: Boolean(setup.directApi),
    summary: setup.summary || `${platform?.label || id} roda pelo processo Hermes Gateway.`,
    nextAction: setup.nextAction || "Configure os campos obrigatorios, inicie o gateway e valide por status/logs."
  };
}

function platformDirectOperations(platformId) {
  const id = String(platformId || "").trim().toLowerCase();
  if (id === "telegram") {
    return telegramCapabilities();
  }
  if (id === "discord") {
    return discordCapabilities();
  }
  if (id === "whatsapp") {
    return whatsappCapabilities();
  }
  return [];
}

function platformLifecycleOperations(platformId) {
  const id = String(platformId || "").trim().toLowerCase();
  return [
    gatewayOperation("configure", "WRITE", "Dream Server Settings gatewayPlatforms", [], {
      note: `Salva campos publicos de ${platformSetup(id).label}.`
    }),
    gatewayOperation("configure_secret", "WRITE", "Dream Server encrypted gateway secrets", [], {
      note: `Salva credenciais sensiveis de ${platformSetup(id).label}; nao usa terminal nem ~/.hermes manualmente.`
    }),
    gatewayOperation("start", "CONTROL", "Hermes Gateway process", [], { note: "Inicia o processo vendorizado do Hermes Gateway." }),
    gatewayOperation("restart", "CONTROL", "Hermes Gateway process", [], { note: "Reinicia o processo vendorizado do Hermes Gateway." }),
    gatewayOperation("stop", "CONTROL", "Hermes Gateway process", [], { note: "Para o processo e desabilita a plataforma quando solicitado." }),
    gatewayOperation("status", "READ", "Hermes Gateway status/log diagnostics", [], { nonDestructive: true }),
    gatewayOperation("capabilities", "READ", "Dream Server gateway metadata", [], { nonDestructive: true })
  ];
}

function platformOperationSummary(platformId) {
  const direct = platformDirectOperations(platformId);
  return {
    directApi: Boolean(platformSetup(platformId).directApi),
    direct: direct.map((operation) => operation.command),
    lifecycle: platformLifecycleOperations(platformId).map((operation) => operation.command)
  };
}

function gatewayCapabilities(platformId) {
  const id = String(platformId || "").trim().toLowerCase();
  const setup = platformSetup(id);
  const directOperations = platformDirectOperations(id);
  return {
    platform: id,
    label: setup.label,
    setup,
    lifecycleOperations: platformLifecycleOperations(id),
    operations: directOperations,
    directOperationsExposed: directOperations.length > 0,
    gatewayManaged: directOperations.length === 0,
    unsupportedNote: directOperations.length
      ? ""
      : `${setup.label} esta disponivel como adaptador do processo Hermes Gateway, mas este Electron ainda nao expoe API direta para listar/enviar mensagens nessa plataforma. Use configure/start/status/logs e as respostas do proprio gateway.`
  };
}

function unsupportedGatewayOperationMessage(platformId, operation) {
  const setup = platformSetup(platformId);
  const op = operation || "(vazia)";
  const qr = setup.usesQr
    ? "Este gateway usa QR apenas no fluxo de pareamento proprio."
    : "Este gateway nao usa QR.";
  return [
    `${setup.label}: operacao direta '${op}' ainda nao esta exposta no Electron.`,
    setup.summary,
    qr,
    `Disponivel agora: configure/configure_secret, start/restart/stop, status/logs e capabilities.`,
    setup.nextAction
  ].join(" ");
}

function whatsappCapabilities() {
  return [
    gatewayOperation("capabilities", "GET", "WhatsApp bridge /capabilities", [], { nonDestructive: true }),
    gatewayOperation("groups", "GET", "WhatsApp bridge /groups", [], { requiresConnection: true, nonDestructive: true }),
    gatewayOperation("chats", "GET", "WhatsApp bridge /chats", [], { requiresConnection: true, nonDestructive: true }),
    gatewayOperation("recent_messages", "GET", "WhatsApp bridge /recent-messages", [], { requiresConnection: true, nonDestructive: true }),
    gatewayOperation("chat", "GET", "WhatsApp bridge /chat/{chatId}", ["chatId"], { nonDestructive: true }),
    gatewayOperation("send", "POST", "WhatsApp bridge /send", ["chatId", "message"], { requiresConnection: true }),
    gatewayOperation("edit", "POST", "WhatsApp bridge /edit", ["chatId", "messageId", "message"], { requiresConnection: true }),
    gatewayOperation("send_media", "POST", "WhatsApp bridge /send-media", ["chatId", "filePath"], { requiresConnection: true }),
    gatewayOperation("typing", "POST", "WhatsApp bridge /typing", ["chatId"], { requiresConnection: true })
  ];
}

function telegramCapabilities() {
  return [
    gatewayOperation("pairing_status", "READ", "Hermes PairingStore", [], {
      nonDestructive: true,
      note: "Telegram nao usa QR. Codigos curtos de 8 caracteres sao aprovacoes Hermes para autorizar usuarios."
    }),
    gatewayOperation("approve_pairing", "POST", "Hermes PairingStore.approve_code", ["code"]),
    gatewayOperation("revoke_pairing", "POST", "Hermes PairingStore.revoke", ["userId"]),
    gatewayOperation("identity", "GET", "Telegram Bot API getMe", [], { nonDestructive: true }),
    gatewayOperation("chats", "READ", "Hermes channel_directory/sessions", [], {
      nonDestructive: true,
      note: "Telegram nao permite enumerar todos os chats via Bot API; usa alvos conhecidos pelo Hermes."
    }),
    gatewayOperation("groups", "READ", "Hermes channel_directory/sessions", [], { nonDestructive: true }),
    gatewayOperation("chat", "GET", "Telegram Bot API getChat", ["chatId"], { nonDestructive: true }),
    gatewayOperation("send", "POST", "Telegram Bot API sendMessage", ["chatId", "message"]),
    gatewayOperation("edit", "POST", "Telegram Bot API editMessageText", ["chatId", "messageId", "message"]),
    gatewayOperation("send_media", "POST", "Telegram Bot API sendPhoto/sendVideo/sendAudio/sendDocument", ["chatId", "filePath"]),
    gatewayOperation("typing", "POST", "Telegram Bot API sendChatAction", ["chatId"])
  ];
}

function discordCapabilities() {
  return [
    gatewayOperation("pairing_status", "READ", "Hermes PairingStore", [], {
      nonDestructive: true,
      note: "Discord nao usa QR. Codigos curtos de 8 caracteres sao aprovacoes Hermes para autorizar usuarios."
    }),
    gatewayOperation("approve_pairing", "POST", "Hermes PairingStore.approve_code", ["code"]),
    gatewayOperation("revoke_pairing", "POST", "Hermes PairingStore.revoke", ["userId"]),
    gatewayOperation("identity", "GET", "Discord REST /users/@me", [], { nonDestructive: true }),
    gatewayOperation("guilds", "GET", "Discord REST /users/@me/guilds", [], { nonDestructive: true }),
    gatewayOperation("channels", "GET", "Discord REST /guilds/{guildId}/channels", [], { nonDestructive: true }),
    gatewayOperation("chats", "READ", "Discord REST + Hermes channel_directory/sessions", [], { nonDestructive: true }),
    gatewayOperation("chat", "GET", "Discord REST /channels/{chatId}", ["chatId"], { nonDestructive: true }),
    gatewayOperation("send", "POST", "Discord REST /channels/{chatId}/messages", ["chatId", "message"]),
    gatewayOperation("edit", "PATCH", "Discord REST /channels/{chatId}/messages/{messageId}", ["chatId", "messageId", "message"]),
    gatewayOperation("send_media", "POST", "Discord REST multipart /channels/{chatId}/messages", ["chatId", "filePath"]),
    gatewayOperation("typing", "POST", "Discord REST /channels/{chatId}/typing", ["chatId"])
  ];
}

function parseThreadTarget(chatId, threadId = "") {
  const raw = clean(chatId);
  const explicitThread = clean(threadId);
  if (explicitThread) {
    return { chatId: raw, threadId: explicitThread };
  }
  const match = raw.match(/^(-?\d+):(\d+)$/);
  if (match) {
    return { chatId: match[1], threadId: match[2] };
  }
  return { chatId: raw, threadId: "" };
}

function isGroupLike(chat = {}) {
  const type = String(chat.type || "").toLowerCase();
  return Boolean(chat.isGroup || chat.guild || ["group", "supergroup", "channel", "forum", "configured"].includes(type));
}

function normalizeChannelQuery(value = "") {
  return String(value || "").trim().replace(/^#/, "").toLowerCase();
}

async function fetchExternalJson(url, options = {}) {
  if (typeof fetch !== "function") {
    return { ok: false, statusCode: 0, data: {}, error: "Runtime sem fetch nativo para chamadas HTTP externas." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(options.timeoutMs || 15000)));
  try {
    const response = await fetch(url, {
      method: String(options.method || "GET").toUpperCase(),
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { body: text };
    }
    return {
      ok: response.ok,
      statusCode: response.status,
      data,
      error: response.ok ? "" : externalApiError(data, text, response.status)
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      data: {},
      error: error?.name === "AbortError" ? "timeout" : sanitizeExternalError(error?.message || String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

function externalApiError(data, text, status) {
  const raw = data?.description || data?.message || data?.error || text || `HTTP ${status}`;
  return sanitizeExternalError(raw);
}

function sanitizeExternalError(value) {
  return String(value || "")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    .replace(/Bot\s+[A-Za-z0-9._-]+/gi, "Bot ***")
    .slice(0, 1000);
}

async function telegramApiRequest(token, method, payload = {}, timeoutMs = 15000) {
  const response = await fetchExternalJson(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    timeoutMs
  });
  if (!response.ok || response.data?.ok === false) {
    return {
      ok: false,
      statusCode: response.statusCode,
      data: response.data,
      error: sanitizeExternalError(response.data?.description || response.error || "Falha na Telegram Bot API.")
    };
  }
  return response;
}

async function telegramSendMedia(token, options = {}) {
  const target = parseThreadTarget(options.chatId, options.threadId);
  const media = mediaRouteForTelegram(options.mediaType, options.filePath);
  const caption = String(options.caption || "");
  if (/^https?:\/\//i.test(options.filePath)) {
    const body = { chat_id: target.chatId, [media.field]: options.filePath };
    if (target.threadId) {
      body.message_thread_id = target.threadId;
    }
    if (caption) {
      body.caption = caption.slice(0, 1024);
    }
    return await telegramApiRequest(token, media.method, body, 60000);
  }
  if (typeof FormData !== "function" || typeof Blob !== "function") {
    return { ok: false, statusCode: 0, data: {}, error: "Runtime sem FormData/Blob nativo para upload de midia." };
  }
  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath)) {
    return { ok: false, statusCode: 0, data: {}, error: `Arquivo nao encontrado: ${filePath}` };
  }
  const form = new FormData();
  form.append("chat_id", target.chatId);
  if (target.threadId) {
    form.append("message_thread_id", target.threadId);
  }
  if (caption) {
    form.append("caption", caption.slice(0, 1024));
  }
  const bytes = await fs.promises.readFile(filePath);
  const fileName = clean(options.fileName) || path.basename(filePath);
  form.append(media.field, new Blob([bytes], { type: mimeTypeForPath(filePath) }), fileName);
  return await fetchExternalJson(`https://api.telegram.org/bot${encodeURIComponent(token)}/${media.method}`, {
    method: "POST",
    body: form,
    timeoutMs: 120000
  });
}

function mediaRouteForTelegram(mediaType, filePath = "") {
  const type = String(mediaType || "").toLowerCase();
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (type === "image" || [".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return { method: "sendPhoto", field: "photo" };
  }
  if (type === "video" || [".mp4", ".mov", ".m4v", ".webm"].includes(ext)) {
    return { method: "sendVideo", field: "video" };
  }
  if (type === "voice" || [".ogg", ".opus"].includes(ext)) {
    return { method: "sendVoice", field: "voice" };
  }
  if (type === "audio" || [".mp3", ".m4a"].includes(ext)) {
    return { method: "sendAudio", field: "audio" };
  }
  if (type === "animation" || [".gif"].includes(ext)) {
    return { method: "sendAnimation", field: "animation" };
  }
  return { method: "sendDocument", field: "document" };
}

function normalizeTelegramChat(data = {}) {
  const result = data?.result || data || {};
  return {
    id: String(result.id || ""),
    name: result.title || result.username || [result.first_name, result.last_name].filter(Boolean).join(" ") || String(result.id || ""),
    type: result.type || "",
    isGroup: ["group", "supergroup", "channel"].includes(String(result.type || "").toLowerCase()),
    raw: result
  };
}

function telegramMessageResult(data = {}) {
  const result = data?.result || data || {};
  return {
    success: Boolean(data?.ok ?? true),
    messageId: result.message_id ? String(result.message_id) : "",
    chatId: result.chat?.id ? String(result.chat.id) : "",
    raw: result
  };
}

async function discordApiRequest(token, route, options = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return await fetchExternalJson(`https://discord.com/api/v10${route}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    body,
    timeoutMs: options.timeoutMs || 15000
  });
}

async function listDiscordChannels(token, guildId = "") {
  const guildsResponse = guildId
    ? { ok: true, data: [{ id: guildId, name: "" }] }
    : await discordApiRequest(token, "/users/@me/guilds", { timeoutMs: 15000 });
  if (!guildsResponse.ok) {
    return guildsResponse;
  }
  const guilds = normalizeDiscordGuilds(guildsResponse.data).slice(0, 50);
  const channels = [];
  for (const guild of guilds) {
    const response = await discordApiRequest(token, `/guilds/${encodeURIComponent(guild.id)}/channels`, { timeoutMs: 15000 });
    if (!response.ok) {
      channels.push({ id: "", name: `Falha ao listar ${guild.name || guild.id}: ${response.error}`, guild: guild.name, type: "error" });
      continue;
    }
    for (const channel of Array.isArray(response.data) ? response.data : []) {
      const normalized = normalizeDiscordChannel(channel);
      if (normalized.id && isDiscordTextLike(channel)) {
        channels.push({ ...normalized, guild: guild.name || normalized.guild || guild.id, guildId: guild.id });
      }
    }
  }
  return { ok: true, statusCode: 200, data: { guilds, channels }, error: "" };
}

function normalizeDiscordGuilds(data = []) {
  return (Array.isArray(data) ? data : []).map((guild) => ({
    id: String(guild.id || ""),
    name: String(guild.name || guild.id || ""),
    icon: guild.icon || "",
    owner: Boolean(guild.owner),
    permissions: guild.permissions || ""
  })).filter((guild) => guild.id);
}

function normalizeDiscordChannel(data = {}) {
  const channel = data?.id || data?.name ? data : {};
  return {
    id: String(channel.id || ""),
    name: String(channel.name || channel.recipients?.[0]?.username || channel.id || ""),
    type: discordChannelTypeName(channel.type),
    isGroup: [0, 5, 10, 11, 12, 15].includes(Number(channel.type)),
    guildId: String(channel.guild_id || ""),
    raw: channel
  };
}

function isDiscordTextLike(channel = {}) {
  return [0, 1, 3, 5, 10, 11, 12, 15].includes(Number(channel.type));
}

function discordChannelTypeName(type) {
  const value = Number(type);
  if (value === 0) return "channel";
  if (value === 1) return "dm";
  if (value === 3) return "group";
  if (value === 5) return "announcement";
  if ([10, 11, 12].includes(value)) return "thread";
  if (value === 15) return "forum";
  return Number.isFinite(value) ? `type_${value}` : "";
}

function discordMessageResult(data = {}) {
  return {
    success: Boolean(data?.id),
    messageId: data?.id ? String(data.id) : "",
    chatId: data?.channel_id ? String(data.channel_id) : "",
    raw: data
  };
}

async function discordSendMedia(token, options = {}) {
  const filePath = clean(options.filePath);
  const caption = String(options.caption || "");
  if (/^https?:\/\//i.test(filePath)) {
    const content = [caption, filePath].filter(Boolean).join("\n");
    return await discordApiRequest(token, `/channels/${encodeURIComponent(options.chatId)}/messages`, {
      method: "POST",
      body: { content },
      timeoutMs: 30000
    });
  }
  if (typeof FormData !== "function" || typeof Blob !== "function") {
    return { ok: false, statusCode: 0, data: {}, error: "Runtime sem FormData/Blob nativo para upload de midia." };
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, statusCode: 0, data: {}, error: `Arquivo nao encontrado: ${resolved}` };
  }
  const form = new FormData();
  const fileName = clean(options.fileName) || path.basename(resolved);
  const payload = { content: caption, attachments: [{ id: 0, filename: fileName }] };
  form.append("payload_json", JSON.stringify(payload));
  const bytes = await fs.promises.readFile(resolved);
  form.append("files[0]", new Blob([bytes], { type: mimeTypeForPath(resolved) }), fileName);
  return await fetchExternalJson(`https://discord.com/api/v10/channels/${encodeURIComponent(options.chatId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
    timeoutMs: 120000
  });
}

function mergeKnownChannels(primary = [], known = []) {
  const items = [];
  const seen = new Set();
  for (const entry of [...primary, ...known]) {
    const id = clean(entry.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    items.push(entry);
  }
  return items;
}

function mimeTypeForPath(filePath = "") {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".pdf": "application/pdf",
    ".txt": "text/plain"
  };
  return map[ext] || "application/octet-stream";
}

module.exports = {
  HermesGatewayManager,
  GATEWAY_PLATFORMS,
  buildGatewayEnv,
  buildGatewayRuntimeConfig,
  buildGatewayProviderEnv,
  gatewaySettingsSignature,
  configuredState,
  gatewayCapabilities,
  platformSetup,
  platformOperationSummary,
  platformMap
};
