const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  dashboardStatusToSystemSnapshot,
  fallbackSystemDashboardSnapshot,
  getSystemDashboardSnapshot,
  normalizeDashboardApiUrl
} = require("./system-dashboard");

test("normalizeDashboardApiUrl appends the status path", () => {
  assert.equal(normalizeDashboardApiUrl("http://dashboard-api:3002"), "http://dashboard-api:3002/api/status");
  assert.equal(normalizeDashboardApiUrl("http://dashboard-api:3002/api/status"), "http://dashboard-api:3002/api/status");
});

test("dashboardStatusToSystemSnapshot maps Dream dashboard metrics", () => {
  const fallback = fallbackSystemDashboardSnapshot({
    model: "fallback",
    tokensPerSecond: 1,
    totalTokens: 2
  });
  const snapshot = dashboardStatusToSystemSnapshot({
    cpu: { percent: 18.5, temp_c: 52 },
    ram: { used_gb: 8.25, total_gb: 32, percent: 25.8 },
    gpu: { name: "RTX 4090", vramUsed: 6.5, vramTotal: 24, utilization: 73, temperature: 61 },
    services: [{ id: "llama-server", status: "healthy" }],
    inference: { tokensPerSecond: 42.2, lifetimeTokens: 123456, loadedModel: "qwen3-coder" }
  }, fallback);

  assert.equal(snapshot.source, "dream-dashboard-api");
  assert.equal(snapshot.cpu.percent, 18.5);
  assert.equal(snapshot.cpu.temperatureC, 52);
  assert.equal(Math.round(snapshot.memory.usedBytes), Math.round(8.25 * 1024 ** 3));
  assert.equal(snapshot.gpu.name, "RTX 4090");
  assert.equal(snapshot.gpu.percent, 73);
  assert.equal(snapshot.tokens.model, "qwen3-coder");
  assert.equal(snapshot.tokens.tokensPerSecond, 42.2);
  assert.equal(snapshot.tokens.totalTokens, 123456);
  assert.equal(snapshot.tokens.serverStatus, "running");
});

test("dashboardStatusToSystemSnapshot keeps local CPU/RAM fallback when dashboard reports zeros", () => {
  const snapshot = dashboardStatusToSystemSnapshot({
    cpu: { percent: 0 },
    ram: { used_gb: 0, total_gb: 0, percent: 0 }
  }, {
    sampledAt: Date.now(),
    cpu: { percent: 37.5, cores: 12, temperatureC: null },
    memory: { usedBytes: 12 * 1024 ** 3, totalBytes: 32 * 1024 ** 3, percent: 38 },
    gpu: { name: "", percent: null, memoryUsedBytes: null, memoryTotalBytes: null, temperatureC: null },
    tokens: {}
  });

  assert.equal(snapshot.cpu.percent, 37.5);
  assert.equal(snapshot.memory.percent, 38);
  assert.equal(snapshot.memory.totalBytes, 32 * 1024 ** 3);
});

test("getSystemDashboardSnapshot fetches Dashboard API with bearer auth", async () => {
  let authHeader = "";
  const server = http.createServer((req, res) => {
    authHeader = req.headers.authorization || "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      cpu: { percent: 9 },
      ram: { used_gb: 1, total_gb: 4, percent: 25 },
      inference: { loadedModel: "local-model", tokensPerSecond: 7 }
    }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const snapshot = await getSystemDashboardSnapshot({
      dashboardApiUrl: `http://127.0.0.1:${port}/api/status`,
      dashboardApiKey: "secret",
      tokens: { model: "fallback" }
    });
    assert.equal(authHeader, "Bearer secret");
    assert.equal(snapshot.cpu.percent, 9);
    assert.equal(snapshot.tokens.model, "local-model");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
