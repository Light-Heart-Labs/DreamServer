const http = require("http");
const https = require("https");
const os = require("os");

const GIB = 1024 ** 3;
const DEFAULT_DASHBOARD_TIMEOUT_MS = 1200;

let previousCpuSample = null;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function firstFinitePreferNonZero(primary, fallback) {
  const primaryNumber = finiteNumber(primary);
  const fallbackNumber = finiteNumber(fallback);
  if (primaryNumber === 0 && fallbackNumber !== null && fallbackNumber > 0) {
    return fallbackNumber;
  }
  return primaryNumber !== null ? primaryNumber : fallbackNumber;
}

function clampPercent(value) {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.max(0, Math.min(100, numeric));
}

function roundMetric(value, precision = 1) {
  const numeric = finiteNumber(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function bytesFromGiB(value) {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.round(Math.max(0, numeric * GIB));
}

function sampleCpuTimes() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    idle += Number(times.idle || 0);
    total +=
      Number(times.user || 0) +
      Number(times.nice || 0) +
      Number(times.sys || 0) +
      Number(times.irq || 0) +
      Number(times.idle || 0);
  }
  return { cpus, idle, total };
}

function sampleCpuPercent() {
  const sample = sampleCpuTimes();
  if (!sample.cpus.length || sample.total <= 0) {
    return null;
  }

  let percent = null;
  if (previousCpuSample && sample.total > previousCpuSample.total) {
    const totalDelta = sample.total - previousCpuSample.total;
    const idleDelta = sample.idle - previousCpuSample.idle;
    percent = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : null;
  } else {
    percent = ((sample.total - sample.idle) / sample.total) * 100;
  }

  previousCpuSample = sample;
  return roundMetric(clampPercent(percent), 1);
}

function fallbackSystemDashboardSnapshot(tokens = {}) {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const cpus = os.cpus() || [];
  return {
    sampledAt: Date.now(),
    source: "local-node",
    cpu: {
      percent: sampleCpuPercent(),
      cores: cpus.length || null,
      temperatureC: null
    },
    memory: {
      usedBytes: used,
      totalBytes: total,
      percent: total ? roundMetric((used / total) * 100, 1) : null
    },
    gpu: {
      name: "",
      percent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      temperatureC: null
    },
    tokens: { ...(tokens || {}) }
  };
}

function dashboardStatusToSystemSnapshot(status = {}, fallback = fallbackSystemDashboardSnapshot()) {
  const cpu = status?.cpu || {};
  const ram = status?.ram || {};
  const gpu = status?.gpu || null;
  const inference = status?.inference || {};
  const services = Array.isArray(status?.services) ? status.services : [];
  const llamaHealthy = services.some((service) =>
    ["llama-server", "litellm"].includes(String(service?.id || "").toLowerCase()) &&
    String(service?.status || "").toLowerCase() === "healthy"
  );
  const dashboardTokensAvailable =
    firstFinite(inference.tokensPerSecond, inference.lifetimeTokens) !== null ||
    Boolean(inference.loadedModel);

  return {
    sampledAt: Date.now(),
    source: "dream-dashboard-api",
    cpu: {
      percent: firstFinitePreferNonZero(cpu.percent, fallback.cpu?.percent),
      cores: firstFinite(cpu.cores, fallback.cpu?.cores),
      temperatureC: firstFinite(cpu.temperatureC, cpu.temp_c, fallback.cpu?.temperatureC)
    },
    memory: {
      usedBytes: firstFinitePreferNonZero(bytesFromGiB(ram.used_gb), fallback.memory?.usedBytes),
      totalBytes: firstFinitePreferNonZero(bytesFromGiB(ram.total_gb), fallback.memory?.totalBytes),
      percent: firstFinitePreferNonZero(ram.percent, fallback.memory?.percent)
    },
    gpu: gpu
      ? {
          name: String(gpu.name || fallback.gpu?.name || ""),
          percent: firstFinite(gpu.utilization, gpu.utilization_percent, gpu.percent, fallback.gpu?.percent),
          memoryUsedBytes: firstFinite(bytesFromGiB(gpu.vramUsed), bytesFromGiB(gpu.memory_used_gb), fallback.gpu?.memoryUsedBytes),
          memoryTotalBytes: firstFinite(bytesFromGiB(gpu.vramTotal), bytesFromGiB(gpu.memory_total_gb), fallback.gpu?.memoryTotalBytes),
          temperatureC: firstFinite(gpu.temperature, gpu.temperature_c, fallback.gpu?.temperatureC)
        }
      : { ...(fallback.gpu || {}) },
    tokens: {
      ...(fallback.tokens || {}),
      sampledAt: Date.now(),
      model: String(inference.loadedModel || fallback.tokens?.model || "").trim(),
      tokensPerSecond: firstFinite(inference.tokensPerSecond, fallback.tokens?.tokensPerSecond),
      totalTokens: firstFinite(inference.lifetimeTokens, fallback.tokens?.totalTokens),
      source: dashboardTokensAvailable ? "dream-dashboard-api" : fallback.tokens?.source || "",
      serverStatus: inference.loadedModel || llamaHealthy ? "running" : fallback.tokens?.serverStatus || "idle"
    }
  };
}

function normalizeDashboardApiUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/\/api\/status\/?$/i.test(raw)) {
    return raw;
  }
  return `${raw.replace(/\/+$/, "")}/api/status`;
}

function dashboardApiUrlFromEnv() {
  return normalizeDashboardApiUrl(
    process.env.DREAM_DASHBOARD_API_URL ||
      process.env.HERMES_DASHBOARD_API_URL ||
      process.env.DASHBOARD_API_URL ||
      ""
  );
}

function isLoopbackDashboardApiUrl(value = "") {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Dashboard API returned HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body || "{}"));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.setTimeout(Math.max(250, Number(options.timeoutMs || DEFAULT_DASHBOARD_TIMEOUT_MS)), () => {
      req.destroy(new Error("Dashboard API request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function getSystemDashboardSnapshot(options = {}) {
  const fallback = fallbackSystemDashboardSnapshot(options.tokens || {});
  const dashboardApiUrl = normalizeDashboardApiUrl(options.dashboardApiUrl || dashboardApiUrlFromEnv());
  const dashboardApiKey = String(options.dashboardApiKey ?? process.env.DASHBOARD_API_KEY ?? "").trim();

  if (!dashboardApiUrl || (!dashboardApiKey && !isLoopbackDashboardApiUrl(dashboardApiUrl))) {
    return fallback;
  }

  try {
    const timeoutMs =
      options.timeoutMs ||
      finiteNumber(process.env.DREAM_DASHBOARD_API_TIMEOUT_MS) ||
      (isLoopbackDashboardApiUrl(dashboardApiUrl) ? 12000 : DEFAULT_DASHBOARD_TIMEOUT_MS);
    const status = await requestJson(dashboardApiUrl, {
      apiKey: dashboardApiKey,
      timeoutMs
    });
    return dashboardStatusToSystemSnapshot(status, fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  dashboardStatusToSystemSnapshot,
  fallbackSystemDashboardSnapshot,
  getSystemDashboardSnapshot,
  normalizeDashboardApiUrl
};
