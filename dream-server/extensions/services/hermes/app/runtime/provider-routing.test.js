const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { DreamRuntime } = require("./core");
const hermesProvider = require("./providers/hermes");
const localProvider = require("./providers/local");
const { normalizeState } = require("./state");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

test("cloud provider alias does not select legacy cloud runtime", () => {
  const state = normalizeState({
    settings: {
      hermesProvider: "cloud"
    },
    chats: [
      {
        title: "legacy cloud chat",
        provider: "cloud"
      }
    ]
  });

  assert.equal(state.settings.hermesProvider, "auto");
  assert.equal(state.settings.providerMode, "local");
  assert.equal(state.chats[0].provider, "local");
});

test("legacy cloud provider names are normalized to Dream Server routing", () => {
  const state = normalizeState({
    settings: {
      hermesProvider: "manus"
    },
    chats: [
      {
        title: "old cloud chat",
        provider: "cloud"
      }
    ]
  });

  assert.equal(state.settings.hermesProvider, "auto");
  assert.equal(state.settings.providerMode, "local");
  assert.equal(state.chats[0].provider, "local");
});

test("non-local cloud routes still create Hermes local-runtime chats", () => {
  const runtime = new DreamRuntime({
    disableTaskScheduler: true,
    initialState: {
      settings: {
        hermesProvider: "openai",
        localBaseUrl: "https://api.openai.com/v1",
        localModel: "gpt-4.1"
      },
      chats: []
    }
  });

  runtime.createChat("cloud");
  assert.equal(runtime.state.chats[0].provider, "local");
  assert.equal(runtime.state.settings.hermesProvider, "openai");
});

test("docker runtime bridges localhost model endpoints internally", () => {
  const previous = process.env.DREAM_CONTAINER;
  process.env.DREAM_CONTAINER = "1";
  try {
    assert.equal(
      localProvider._test.requestBaseUrlForRuntime("http://localhost:11434/v1"),
      "http://host.docker.internal:11434/v1"
    );
    assert.equal(
      localProvider._test.requestBaseUrlForRuntime("http://127.0.0.1:11434/v1"),
      "http://host.docker.internal:11434/v1"
    );
    assert.equal(
      localProvider._test.requestBaseUrlForRuntime("http://litellm:4000/v1"),
      "http://litellm:4000/v1"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.DREAM_CONTAINER;
    } else {
      process.env.DREAM_CONTAINER = previous;
    }
  }
});

test("Hermes local route resolves stale model names from the endpoint", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "Qwen3.5-9B-Q4_K_M", owned_by: "llamacpp" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  t.after(() => server.close());
  const address = await listen(server);
  const settings = {
    hermesProvider: "custom",
    localBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    localModel: "z-ai/glm4.7",
    localApiKey: "not-needed"
  };

  await hermesProvider.resolveLocalEndpointForHermes(settings);

  assert.equal(settings.localModel, "Qwen3.5-9B-Q4_K_M");
  assert.equal(
    hermesProvider.resolveHermesRoutingSettings(settings).model,
    "Qwen3.5-9B-Q4_K_M"
  );
});

test("Hermes custom local route disables Qwen thinking when configured off", () => {
  assert.deepEqual(
    hermesProvider.buildHermesRequestOverrides({
      hermesProvider: "custom",
      localBaseUrl: "http://127.0.0.1:11435/v1",
      localModel: "Qwen3.5-9B-Q4_K_M",
      localThinkingEnabled: false
    }),
    {
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: false,
          clear_thinking: false
        }
      }
    }
  );
});

test("Hermes compose local route disables Qwen thinking when configured off", () => {
  assert.deepEqual(
    hermesProvider.buildHermesRequestOverrides({
      hermesProvider: "custom",
      localBaseUrl: "http://litellm:4000/v1",
      localModel: "Qwen3.5-9B-Q4_K_M",
      localThinkingEnabled: false
    }),
    {
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: false,
          clear_thinking: false
        }
      }
    }
  );
});

test("Hermes treats Dream Server compose model services as local endpoints", () => {
  assert.equal(
    hermesProvider._test.looksLikeDreamServerLocalServiceBaseUrl("http://litellm:4000/v1"),
    true
  );
  assert.equal(
    hermesProvider._test.looksLikeDreamServerLocalServiceBaseUrl("http://llama-server:8080/v1"),
    true
  );
  assert.equal(
    hermesProvider._test.looksLikeDreamServerLocalServiceBaseUrl("https://api.openai.com/v1"),
    false
  );
});
