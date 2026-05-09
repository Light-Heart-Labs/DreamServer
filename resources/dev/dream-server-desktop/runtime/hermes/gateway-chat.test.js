const assert = require("assert");
const os = require("os");
const path = require("path");
const { formatGatewayChatResponse } = require("./gateway-chat");
const {
  HermesGatewayManager,
  GATEWAY_PLATFORMS,
  buildGatewayEnv,
  buildGatewayRuntimeConfig,
  gatewaySettingsSignature,
  configuredState,
  gatewayCapabilities,
  platformSetup
} = require("./gateway-manager");

const whatsapp = GATEWAY_PLATFORMS.find((platform) => platform.id === "whatsapp");
const discord = GATEWAY_PLATFORMS.find((platform) => platform.id === "discord");

const whatsappState = configuredState(
  { gatewayPlatforms: { whatsapp: { enabled: true } } },
  {},
  whatsapp
);
assert.strictEqual(whatsappState.configured, true);
assert.deepStrictEqual(whatsappState.missing, []);
assert.deepStrictEqual(whatsappState.missingRecommended, ["homeChannel"]);

const discordState = configuredState(
  { gatewayPlatforms: { discord: { enabled: true } } },
  {},
  discord
);
assert.strictEqual(discordState.configured, false);
assert.deepStrictEqual(discordState.missing, ["botToken"]);

const env = buildGatewayEnv(
  { gatewayPlatforms: { whatsapp: { enabled: true } } },
  {}
);
assert.strictEqual(env.WHATSAPP_ENABLED, "true");

const localRuntimeEnv = buildGatewayEnv(
  {
    hermesProvider: "custom",
    localBaseUrl: "http://127.0.0.1:11435/v1",
    localModel: "Qwen3.5-9B-Q4_K_M",
    localApiKey: "not-needed",
    hermesApiMode: "chat_completions",
    gatewayPlatforms: { telegram: { enabled: true } }
  },
  { telegram: { botToken: "test-token" } }
);
assert.strictEqual(localRuntimeEnv.HERMES_INFERENCE_PROVIDER, "custom");
assert.strictEqual(localRuntimeEnv.OPENAI_BASE_URL, "http://127.0.0.1:11435/v1");
assert.strictEqual(localRuntimeEnv.CUSTOM_BASE_URL, "http://127.0.0.1:11435/v1");
assert.strictEqual(localRuntimeEnv.OPENAI_API_KEY, "no-key-required");
assert.strictEqual(localRuntimeEnv.TELEGRAM_BOT_TOKEN, "test-token");

const localRuntimeConfig = buildGatewayRuntimeConfig({
  hermesProvider: "custom",
  localBaseUrl: "http://127.0.0.1:11435/v1",
  localModel: "Qwen3.5-9B-Q4_K_M",
  localApiKey: "not-needed",
  hermesApiMode: "chat_completions"
});
assert.deepStrictEqual(localRuntimeConfig.model, {
  default: "Qwen3.5-9B-Q4_K_M",
  provider: "custom",
  base_url: "http://127.0.0.1:11435/v1",
  api_mode: "chat_completions"
});

const nvidiaRuntimeEnv = buildGatewayEnv(
  {
    hermesProvider: "nvidia",
    localModel: "z-ai/glm4.7",
    localApiKey: "nvapi-test",
    hermesApiMode: "chat_completions",
    gatewayPlatforms: { telegram: { enabled: true } }
  },
  { telegram: { botToken: "test-token" } }
);
assert.strictEqual(nvidiaRuntimeEnv.HERMES_INFERENCE_PROVIDER, "nvidia");
assert.strictEqual(nvidiaRuntimeEnv.OPENAI_API_KEY, "nvapi-test");
assert.strictEqual(nvidiaRuntimeEnv.NVIDIA_API_KEY, "nvapi-test");
assert.strictEqual(nvidiaRuntimeEnv.NVIDIA_BASE_URL, "https://integrate.api.nvidia.com/v1");

const nvidiaSignature = gatewaySettingsSignature(
  {
    gatewayEnabled: true,
    gatewayAutoStart: true,
    hermesProvider: "nvidia",
    localModel: "z-ai/glm4.7",
    localApiKey: "nvapi-test",
    hermesApiMode: "chat_completions",
    gatewayPlatforms: { telegram: { enabled: true } }
  },
  { telegram: { botToken: "test-token" } }
);
const nvidiaChangedKeySignature = gatewaySettingsSignature(
  {
    gatewayEnabled: true,
    gatewayAutoStart: true,
    hermesProvider: "nvidia",
    localModel: "z-ai/glm4.7",
    localApiKey: "nvapi-test-2",
    hermesApiMode: "chat_completions",
    gatewayPlatforms: { telegram: { enabled: true } }
  },
  { telegram: { botToken: "test-token" } }
);
const customSignature = gatewaySettingsSignature(
  {
    gatewayEnabled: true,
    gatewayAutoStart: true,
    hermesProvider: "custom",
    localBaseUrl: "http://127.0.0.1:11435/v1",
    localModel: "Qwen3.5-9B-Q4_K_M",
    localApiKey: "not-needed",
    hermesApiMode: "chat_completions",
    gatewayPlatforms: { telegram: { enabled: true } }
  },
  { telegram: { botToken: "test-token" } }
);
assert.notStrictEqual(nvidiaSignature, nvidiaChangedKeySignature);
assert.notStrictEqual(nvidiaSignature, customSignature);

const qrImagePath = path.join(os.tmpdir(), "dream-server-hermes-test", "whatsapp", "qr.svg");
const response = formatGatewayChatResponse({
  command: "start",
  platformId: "whatsapp",
  status: { running: true, pid: 123, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: ["homeChannel"]
  },
  diagnostics: {
    qrDetected: true,
    qrImagePath,
    logs: "Scan this QR code with WhatsApp on your phone:\nQRDATA",
    logPath: "bridge.log"
  }
});
assert.match(response, /processo real do Hermes Gateway/i);
assert.ok(response.includes(`![QR Code do WhatsApp](${qrImagePath})`));
assert.match(response, /QR\/pareamento retornado pela bridge/i);
assert.match(response, /homeChannel/);

const connectedResponse = formatGatewayChatResponse({
  command: "status",
  platformId: "whatsapp",
  status: { running: true, pid: 123, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    connectedDetected: true,
    qrDetected: true,
    qrImagePath,
    bridgeHealth: { reachable: true, status: "connected", queueLength: 0, uptime: 10 }
  }
});
assert.doesNotMatch(connectedResponse, /!\[QR Code do WhatsApp\]/);
assert.match(connectedResponse, /estado: connected/);

const expiredQrResponse = formatGatewayChatResponse({
  command: "start",
  platformId: "whatsapp",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    qrDetected: false,
    qrExpired: true,
    qrAgeSeconds: 120,
    bridgeHealth: { reachable: true, status: "connecting", queueLength: 0, uptime: 10 }
  }
});
assert.doesNotMatch(expiredQrResponse, /!\[QR Code do WhatsApp\]/);
assert.match(expiredQrResponse, /QR expirado/i);

const groupsResponse = formatGatewayChatResponse({
  command: "groups",
  platformId: "whatsapp",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    connectedDetected: true,
    bridgeHealth: { reachable: true, status: "connected", queueLength: 0, uptime: 10 }
  },
  groups: [{ id: "123@g.us", subject: "Equipe", participantCount: 4 }]
});
assert.match(groupsResponse, /Equipe/);
assert.match(groupsResponse, /123@g\.us/);

const capabilitiesResponse = formatGatewayChatResponse({
  command: "capabilities",
  platformId: "whatsapp",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    connectedDetected: true,
    bridgeHealth: { reachable: true, status: "connected", queueLength: 0, uptime: 10 }
  },
  operationResult: {
    operations: [
      { command: "send", method: "POST", endpoint: "/send", requiresConnection: true, required: ["chatId", "message"] },
      { command: "recent_messages", method: "GET", endpoint: "/recent-messages", requiresConnection: true, nonDestructive: true }
    ]
  }
});
assert.match(capabilitiesResponse, /send/);
assert.match(capabilitiesResponse, /recent_messages/);

for (const platform of GATEWAY_PLATFORMS) {
  const setup = platformSetup(platform.id);
  assert.strictEqual(setup.platform, platform.id);
  assert.ok(setup.authMode);
  assert.ok(setup.connectionMode);
  assert.strictEqual(typeof setup.usesQr, "boolean");
  assert.strictEqual(typeof setup.directApi, "boolean");
  const capabilities = gatewayCapabilities(platform.id);
  assert.strictEqual(capabilities.platform, platform.id);
  assert.ok(Array.isArray(capabilities.lifecycleOperations));
  assert.ok(capabilities.lifecycleOperations.some((operation) => operation.command === "status"));
  assert.ok(capabilities.setup.summary);
}
assert.strictEqual(platformSetup("whatsapp").usesQr, true);
assert.strictEqual(platformSetup("telegram").usesQr, false);
assert.strictEqual(platformSetup("discord").usesQr, false);

const slackCapabilitiesResponse = formatGatewayChatResponse({
  command: "capabilities",
  platformId: "slack",
  status: { running: false, enabledCount: 1, configuredCount: 0 },
  platform: {
    id: "slack",
    label: "Slack",
    enabled: true,
    configured: false,
    missing: ["botToken"],
    missingRecommended: [],
    setup: platformSetup("slack")
  },
  operationResult: gatewayCapabilities("slack")
});
assert.match(slackCapabilitiesResponse, /Slack bot token/i);
assert.match(slackCapabilitiesResponse, /usa QR: nao/);
assert.match(slackCapabilitiesResponse, /Operacoes diretas expostas: nenhuma/);

const telegramCapabilitiesResponse = formatGatewayChatResponse({
  command: "capabilities",
  platformId: "telegram",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "telegram",
    label: "Telegram",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  operationResult: {
    operations: [
      { command: "identity", method: "GET", endpoint: "Telegram Bot API getMe", nonDestructive: true },
      { command: "send_media", method: "POST", endpoint: "Telegram Bot API sendPhoto/sendVideo/sendAudio/sendDocument", required: ["chatId", "filePath"] }
    ]
  }
});
assert.match(telegramCapabilitiesResponse, /identity/);
assert.match(telegramCapabilitiesResponse, /send_media/);

const telegramPairingResponse = formatGatewayChatResponse({
  command: "approve_pairing",
  platformId: "telegram",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "telegram",
    label: "Telegram",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  operationResult: {
    platform: "telegram",
    code: "ZE2FV6XW",
    approved: { user_id: "780211276", user_name: "Gabriel" },
    pending: [],
    approvedUsers: [{ platform: "telegram", user_id: "780211276", user_name: "Gabriel" }]
  }
});
assert.match(telegramPairingResponse, /Codigo aprovado para Telegram/);
assert.match(telegramPairingResponse, /Telegram nao usa QR code/);
assert.doesNotMatch(telegramPairingResponse, /QR Code do WhatsApp/);

const telegramStartWithPairingLog = formatGatewayChatResponse({
  command: "start",
  platformId: "telegram",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "telegram",
    label: "Telegram",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    qrDetected: true,
    logs: "pairing code ZE2FV6XW waiting for approval"
  }
});
assert.doesNotMatch(telegramStartWithPairingLog, /QR\/pareamento/);
assert.doesNotMatch(telegramStartWithPairingLog, /QR Code do WhatsApp/);

const discordGuildsResponse = formatGatewayChatResponse({
  command: "guilds",
  platformId: "discord",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "discord",
    label: "Discord",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  operationResult: {
    guilds: [{ id: "987654321", name: "Dream Server" }]
  }
});
assert.match(discordGuildsResponse, /Dream Server/);
assert.match(discordGuildsResponse, /987654321/);

const discordChannelsResponse = formatGatewayChatResponse({
  command: "channels",
  platformId: "discord",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "discord",
    label: "Discord",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  operationResult: {
    channels: [{ id: "123456789", name: "bot-home", guild: "Dream Server", type: "channel", isGroup: true }]
  }
});
assert.match(discordChannelsResponse, /bot-home/);
assert.match(discordChannelsResponse, /123456789/);

const sendResponse = formatGatewayChatResponse({
  command: "send",
  platformId: "whatsapp",
  status: { running: true, enabledCount: 1, configuredCount: 1 },
  platform: {
    id: "whatsapp",
    label: "WhatsApp",
    enabled: true,
    configured: true,
    missing: [],
    missingRecommended: []
  },
  diagnostics: {
    connectedDetected: true,
    bridgeHealth: { reachable: true, status: "connected", queueLength: 0, uptime: 10 }
  },
  operationResult: { success: true, messageId: "MSG1" }
});
assert.match(sendResponse, /messageId: MSG1/);

const missingResponse = formatGatewayChatResponse({
  command: "start",
  platformId: "discord",
  status: { running: false, enabledCount: 1, configuredCount: 0 },
  platform: {
    id: "discord",
    label: "Discord",
    enabled: true,
    configured: false,
    missing: ["botToken"],
    missingRecommended: []
  }
});
assert.match(missingResponse, /Nao iniciei Discord/i);
assert.match(missingResponse, /botToken/);

Promise.resolve().then(async () => {
  const manager = new HermesGatewayManager();
  const slackSend = await manager.platformOperation(
    "send",
    "slack",
    {},
    { gatewayPlatforms: { slack: { enabled: true } } },
    {}
  );
  assert.match(slackSend.operationError, /Slack/);
  assert.match(slackSend.operationError, /nao usa QR/);
  assert.strictEqual(slackSend.operationResult.platform, "slack");
  console.log("gateway chat tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
