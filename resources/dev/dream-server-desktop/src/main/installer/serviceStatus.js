const http = require("http");
const { execText } = require("./systemDetection");
const SERVICES = [
  { id: "dashboard", label: "Dashboard", url: "http://127.0.0.1:8080" },
  { id: "open-webui", label: "Chat UI", url: "http://127.0.0.1:3000" },
  { id: "llm", label: "LLM local", url: "http://127.0.0.1:11435/health" },
  { id: "qdrant", label: "Qdrant", url: "http://127.0.0.1:6333/health" },
  { id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:7860" },
  { id: "n8n", label: "n8n", url: "http://127.0.0.1:5678" }
];
function probeUrl(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode });
    });
    request.once("timeout", () => { request.destroy(); resolve({ ok: false, statusCode: 0 }); });
    request.once("error", () => resolve({ ok: false, statusCode: 0 }));
  });
}
async function dockerComposeServices() {
  const output = await execText("docker", ["compose", "ps", "--format", "json"], { timeoutMs: 3000, maxBuffer: 1024 * 1024 });
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
async function getServiceStatus() {
  const probes = await Promise.all(SERVICES.map(async (service) => {
    const result = await probeUrl(service.url);
    return { ...service, status: result.ok ? "running" : "stopped", statusCode: result.statusCode };
  }));
  return { sampledAt: new Date().toISOString(), endpoints: SERVICES.map((service) => ({ id: service.id, label: service.label, url: service.url })), services: probes, compose: await dockerComposeServices() };
}
module.exports = { SERVICES, getServiceStatus };
