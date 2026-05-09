const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HermesBackend } = require("./backend");
const { _test: providerTest } = require("../providers/hermes");
const { getHermesCatalog } = require("./catalog");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-hermes-test-"));
const hermesRoot = path.join(tmpRoot, "hermes-agent");
const runnerPath = path.join(tmpRoot, "fake-bridge.js");
fs.mkdirSync(hermesRoot, { recursive: true });
fs.mkdirSync(path.join(hermesRoot, "skills", "coding", "codex"), { recursive: true });
fs.mkdirSync(path.join(hermesRoot, "gateway", "platforms"), { recursive: true });
fs.mkdirSync(path.join(hermesRoot, "hermes_cli"), { recursive: true });
fs.writeFileSync(path.join(hermesRoot, "run_agent.py"), "# fake hermes root\n");
fs.writeFileSync(
  path.join(hermesRoot, "hermes_cli", "auth.py"),
  `
DEFAULT_COPILOT_ACP_BASE_URL = "acp://copilot"
PROVIDER_REGISTRY = {
    "nvidia": ProviderConfig(
        id="nvidia",
        name="NVIDIA NIM",
        auth_type="api_key",
        inference_base_url="https://integrate.api.nvidia.com/v1",
        base_url_env_var="NVIDIA_BASE_URL",
    ),
    "copilot-acp": ProviderConfig(
        id="copilot-acp",
        name="GitHub Copilot ACP",
        auth_type="external_process",
        inference_base_url=DEFAULT_COPILOT_ACP_BASE_URL,
        base_url_env_var="COPILOT_ACP_BASE_URL",
    ),
}
`
);
fs.writeFileSync(
  path.join(hermesRoot, "skills", "coding", "codex", "SKILL.md"),
  "---\nname: Codex\ndescription: Work on code changes.\n---\n# Codex\n"
);
fs.writeFileSync(path.join(hermesRoot, "gateway", "platforms", "discord.py"), "# fake discord\n");
fs.writeFileSync(
  runnerPath,
  `
const fs = require("fs");
if (process.argv.includes("--doctor")) {
  console.log(JSON.stringify({ type: "doctor", ok: true, importable: true, python: process.execPath }));
  process.exit(0);
}
const req = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
console.log(JSON.stringify({ type: "thinking", message: "Pensando..." }));
console.log(JSON.stringify({ type: "tool_start", id: "1", name: "read_file", args: { path: "a.txt" } }));
console.log(JSON.stringify({ type: "tool_complete", id: "1", name: "read_file", result: "ok" }));
console.log(JSON.stringify({ type: "text_delta", delta: "feito" }));
console.log(JSON.stringify({ type: "text_delta", delta: "feito" }));
console.log(JSON.stringify({ type: "text_delta", delta: "feito agora" }));
console.log(JSON.stringify({ type: "final", ok: true, finalResponse: "final:" + req.inputText }));
`
);

(async () => {
  const backend = new HermesBackend({
    hermesRoot,
    runnerPath,
    python: { command: process.execPath, args: [] },
    timeoutMs: 5000
  });

  const doctor = await backend.doctor();
  assert.strictEqual(doctor.ok, true);

  const seenEvents = [];
  const deltas = [];
  const result = await backend.sendTurn({
    inputText: "teste",
    workspaceRoot: tmpRoot,
    onEvent: (event) => seenEvents.push(event.type),
    onTextDelta: (delta) => deltas.push(delta)
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.assistantText, "final:teste");
  assert.deepStrictEqual(deltas, ["feito", " agora"]);
  assert.ok(seenEvents.includes("tool_start"));
  assert.ok(seenEvents.includes("tool_complete"));

  assert.deepStrictEqual(
    providerTest.extractChessMoveFromAssistantText(
      "Preciso usar browser_chess_move para fazer o movimento. Vou mover o peao da casa e2 para e4:"
    ),
    { fromSquare: "e2", toSquare: "e4" }
  );
  assert.deepStrictEqual(
    providerTest.recoverExplicitChessMoveAction(
      "Vou chamar browser_chess_move(from_square='g1', to_square='f3') agora.",
      []
    ),
    {
      type: "browser_harness",
      command: "chess_move",
      fromSquare: "g1",
      toSquare: "f3",
      timeoutMs: 10000,
      recoveredFromAssistantText: true
    }
  );
  assert.strictEqual(
    providerTest.recoverExplicitChessMoveAction(
      "Vou chamar browser_chess_move(from_square='g1', to_square='f3') agora.",
      [{ type: "tool_start", name: "browser_chess_move" }]
    ),
    null
  );
  assert.deepStrictEqual(
    providerTest.recoverChessContinuationAction(
      "Movimento realizado. Agora estou aguardando o proximo movimento do computador.",
      [{ type: "tool_complete", name: "browser_chess_move" }],
      { chat: { title: "abra o lichess e jogue xadrez", messages: [] }, inputText: "" }
    ),
    {
      type: "browser_harness",
      command: "chess_wait_turn",
      timeoutMs: 30000,
      recoveredFromAssistantText: true
    }
  );
  assert.deepStrictEqual(
    providerTest.recoverLichessSetupClickAction(
      'Agora vou clicar em "Jogar contra o computador" para iniciar a partida.',
      [],
      { chat: { title: "abra o lichess e jogue xadrez", messages: [] }, inputText: "" }
    ),
    {
      type: "browser_harness",
      command: "click",
      label: "Jogar contra o computador",
      timeoutMs: 10000,
      recoveredFromAssistantText: true,
      recoveredLichessSetup: true
    }
  );
  assert.deepStrictEqual(
    providerTest.recoverChessStateAction(
      "Diga-me qual movimento voce quer que eu faca.",
      [],
      { chat: { title: "abra o lichess e jogue xadrez", messages: [] }, inputText: "" }
    ),
    {
      type: "browser_harness",
      command: "chess_state",
      timeoutMs: 10000,
      recoveredFromAssistantText: true
    }
  );
  assert.deepStrictEqual(
    providerTest.resolveHermesToolsets(
      {},
      { chat: { title: "abra o lichess e jogue xadrez", messages: [] }, inputText: "" }
    ),
    ["browser", "dream-desktop"]
  );
  assert.deepStrictEqual(
    providerTest.hermesLimitsForRoute(
      { id: "general-purpose" },
      {},
      { chat: { title: "abra o lichess e jogue xadrez", messages: [] }, inputText: "" }
    ),
    { maxIterations: 8, maxTokens: 1536 }
  );
  assert.deepStrictEqual(
    providerTest.hermesLimitsForRoute(
      { id: "general-purpose" },
      { hermesMaxIterations: 40, hermesMaxTokens: 8192 },
      { chat: { title: "jogue xadrez no lichess", messages: [] }, inputText: "" }
    ),
    { maxIterations: 8, maxTokens: 1536 }
  );
  assert.strictEqual(providerTest.buildHermesChessInstruction({ workspaceRoot: tmpRoot }).length < 1700, true);
  assert.match(
    providerTest.buildHermesDesktopInstruction({ id: "general-purpose" }, { workspaceRoot: tmpRoot, locale: "en-US" }),
    /Host OS: .*User locale\/language: en-US/s
  );
  assert.deepStrictEqual(
    providerTest.toHermesHistory({
      messages: [
        { kind: "user", content: "old" },
        { kind: "assistant", content: "x".repeat(1000) },
        { kind: "user", content: "new" }
      ]
    }, { maxMessages: 2, maxCharsPerMessage: 20 }),
    [
      { role: "assistant", content: "x".repeat(200) },
      { role: "user", content: "new" }
    ]
  );
  assert.deepStrictEqual(
    providerTest.recoverChessContextErrorAction({
      chat: { title: "abra o lichess e jogue contra o computador", messages: [] },
      inputText: ""
    }),
    {
      type: "browser_harness",
      command: "click",
      label: "Jogar contra o computador",
      timeoutMs: 10000,
      recoveredFromHermesContextError: true
    }
  );
  assert.strictEqual(providerTest.hermesTimeoutForTask({}, { chessTask: true }), 180000);
  assert.strictEqual(providerTest.hermesTimeoutForTask({ hermesTimeoutMs: 1234 }, { chessTask: true }), 1234);
  assert.strictEqual(providerTest.isHermesTimeoutError(new Error("Hermes demorou mais de 600s para responder.")), true);
  assert.strictEqual(providerTest.isHermesContextLengthError(new Error("Context length exceeded (7,110 tokens). Cannot compress further.")), true);
  assert.deepStrictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "anthropic",
      hermesApiMode: "auto",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "claude-sonnet-4-5",
      localApiKey: "sk-test"
    }),
    {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      apiKey: "sk-test",
      apiMode: null,
      providersAllowed: [],
      providersIgnored: [],
      providersOrder: [],
      providerSort: "",
      providerRequireParameters: false,
      providerDataCollection: ""
    }
  );
  assert.deepStrictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "openrouter",
      hermesApiMode: "codex_responses",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "openai/gpt-5.1",
      hermesProvidersAllowed: ["openai", "anthropic"],
      hermesProvidersIgnored: ["deepinfra"],
      hermesProvidersOrder: ["openai"],
      hermesProviderSort: "latency",
      hermesProviderRequireParameters: true,
      hermesProviderDataCollection: "deny"
    }),
    {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-5.1",
      apiKey: "",
      apiMode: "codex_responses",
      providersAllowed: ["openai", "anthropic"],
      providersIgnored: ["deepinfra"],
      providersOrder: ["openai"],
      providerSort: "latency",
      providerRequireParameters: true,
      providerDataCollection: "deny"
    }
  );
  assert.deepStrictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "kimi",
      hermesApiMode: "auto",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "kimi-k2",
      localApiKey: "sk-kimi-test"
    }),
    {
      provider: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      model: "kimi-k2",
      apiKey: "sk-kimi-test",
      apiMode: "anthropic_messages",
      providersAllowed: [],
      providersIgnored: [],
      providersOrder: [],
      providerSort: "",
      providerRequireParameters: false,
      providerDataCollection: ""
    }
  );
  assert.strictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "nvidia",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "Qwen3.5-9B-Q4_K_M",
      localApiKey: "nvapi-test"
    }).model,
    "z-ai/glm4.7"
  );
  assert.strictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "nvidia",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "Qwen3.5-9B-Q4_K_M",
      localApiKey: "nvapi-test"
    }).baseUrl,
    "https://integrate.api.nvidia.com/v1"
  );
  assert.strictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "copilot-acp",
      localBaseUrl: "https://api.openai.com/v1",
      localModel: "gpt-4o"
    }).baseUrl,
    "acp://copilot"
  );
  assert.strictEqual(
    providerTest.resolveHermesRoutingSettings({
      hermesProvider: "nvidia",
      localBaseUrl: "https://custom.proxy.example/v1",
      localModel: "z-ai/glm4.7"
    }).baseUrl,
    "https://custom.proxy.example/v1"
  );
  assert.deepStrictEqual(
    providerTest.buildHermesRequestOverrides({
      hermesProvider: "nvidia",
      localThinkingEnabled: true,
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "Qwen3.5-9B-Q4_K_M"
    }),
    {
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: true,
          clear_thinking: false
        }
      }
    }
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      providerTest.buildHermesRequestOverrides({
        hermesProvider: "nvidia",
        localThinkingEnabled: true
      }).extra_body,
      "think"
    ),
    false
  );
  const catalog = getHermesCatalog(hermesRoot, { force: true });
  assert.ok(catalog.commands.some((command) => command.name === "/model"));
  assert.ok(catalog.skills.some((skill) => skill.name === "/codex"));
  assert.ok(catalog.gateways.some((gateway) => gateway.id === "discord"));
  assert.ok(catalog.providers.some((provider) => provider.id === "nvidia" && provider.inferenceBaseUrl === "https://integrate.api.nvidia.com/v1"));
  assert.ok(catalog.providers.some((provider) => provider.id === "copilot-acp" && provider.inferenceBaseUrl === "acp://copilot"));

  const projectRoot = path.resolve(__dirname, "..", "..");
  const realHermesRoot = path.join(projectRoot, "vendor", "hermes-agent");
  const transportBasePath = path.join(realHermesRoot, "agent", "transports", "base.py");
  assert.ok(fs.existsSync(transportBasePath), "Hermes transport base.py must be vendored");
  const pythonPath = process.platform === "win32"
    ? path.join(projectRoot, ".venv-hermes", "Scripts", "python.exe")
    : path.join(projectRoot, ".venv-hermes", "bin", "python");
  if (fs.existsSync(pythonPath)) {
    const registryCheck = spawnSync(
      pythonPath,
      ["-c", [
        "import sys",
        "sys.path.insert(0, r'" + realHermesRoot.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "')",
        "from agent.transports import get_transport",
        "modes = ['chat_completions', 'anthropic_messages', 'codex_responses', 'bedrock_converse']",
        "missing = [mode for mode in modes if get_transport(mode) is None]",
        "assert not missing, missing",
      ].join("; ")],
      { encoding: "utf8" }
    );
    assert.strictEqual(registryCheck.status, 0, registryCheck.stderr || registryCheck.stdout);
  }
  console.log("hermes backend bridge tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
