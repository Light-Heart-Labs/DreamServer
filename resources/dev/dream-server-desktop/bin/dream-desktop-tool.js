#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

function loadRuntimeTools() {
  const candidates = [
    path.join(__dirname, "..", "runtime", "tools"),
    path.join(
      __dirname.replace(`${path.sep}app.asar.unpacked${path.sep}`, `${path.sep}app.asar${path.sep}`),
      "..",
      "runtime",
      "tools"
    ),
    process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "runtime", "tools") : ""
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to load runtime tools.");
}

function readPayload() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function isPreviewHarnessAction(action = {}) {
  const type = String(action?.type || "").trim();
  return type === "browser_harness" || type === "browser_session_state";
}

function isGatewayAction(action = {}) {
  return String(action?.type || "").trim() === "gateway_control";
}

function normalizePreviewHarnessAction(action = {}) {
  if (String(action?.type || "") === "browser_session_state") {
    return {
      type: "browser_harness",
      command: "session_state",
      timeoutMs: action.timeoutMs || 5000
    };
  }
  return {
    ...action,
    type: "browser_harness"
  };
}

function readDesktopBridgeInfo() {
  const envPort = Number(process.env.DREAM_DESKTOP_BRIDGE_PORT || 0);
  const envToken = String(process.env.DREAM_DESKTOP_BRIDGE_TOKEN || "").trim();
  if (envPort && envToken) {
    return {
      host: "127.0.0.1",
      port: envPort,
      token: envToken
    };
  }

  const bridgeFile = String(process.env.DREAM_DESKTOP_BRIDGE_FILE || path.join(os.tmpdir(), "dream-server-desktop-bridge.json"));
  if (!bridgeFile || !fs.existsSync(bridgeFile)) {
    throw new Error(`Dream desktop live preview bridge not found: ${bridgeFile}`);
  }

  const parsed = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
  const port = Number(parsed.port || 0);
  const token = String(parsed.token || "").trim();
  if (!port || !token) {
    throw new Error(`Dream desktop live preview bridge descriptor is invalid: ${bridgeFile}`);
  }
  return {
    host: String(parsed.host || "127.0.0.1"),
    port,
    token
  };
}

function postJsonToDesktopBridgePath(pathname, payload = {}, timeoutMs = 20000) {
  const bridge = readDesktopBridgeInfo();
  const body = JSON.stringify(payload);
  const timeout = Math.max(1500, Math.min(Number(timeoutMs || 20000) + 2500, 125000));

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: bridge.host,
      port: bridge.port,
      path: pathname,
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "x-dream-bridge-token": bridge.token
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(new Error(`Dream desktop live preview bridge returned invalid JSON: ${error.message || error}`));
          return;
        }
        if (!parsed.ok) {
          reject(new Error(parsed.error || `Dream desktop bridge failed with HTTP ${res.statusCode}.`));
          return;
        }
        resolve(parsed.result || {});
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Dream desktop bridge timed out."));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function postPreviewHarnessToDesktopBridge(action = {}) {
  const normalized = normalizePreviewHarnessAction(action);
  return postJsonToDesktopBridgePath(
    "/preview-harness",
    {
      command: normalized,
      timeoutMs: normalized.timeoutMs || action.timeoutMs || 20000
    },
    normalized.timeoutMs || action.timeoutMs || 20000
  );
}

function postGatewayActionToDesktopBridge(action = {}) {
  const timeoutMs = action.timeoutMs || 30000;
  return postJsonToDesktopBridgePath(
    "/gateway-action",
    {
      action: {
        ...action,
        type: "gateway_control"
      },
      timeoutMs
    },
    timeoutMs
  );
}

async function main() {
  const payload = readPayload();
  const action = payload.action && typeof payload.action === "object" ? payload.action : {};
  const workspaceRoot = payload.workspaceRoot
    ? path.resolve(String(payload.workspaceRoot))
    : process.cwd();

  if (!String(action.type || "").trim()) {
    throw new Error("Missing action.type.");
  }

  if (isPreviewHarnessAction(action)) {
    const result = await postPreviewHarnessToDesktopBridge(action);
    process.stdout.write(JSON.stringify({
      ok: true,
      action,
      result: JSON.stringify(result)
    }));
    return;
  }

  if (isGatewayAction(action)) {
    const result = await postGatewayActionToDesktopBridge(action);
    process.stdout.write(JSON.stringify({
      ok: true,
      action,
      result: String(result?.formatted || JSON.stringify(result))
    }));
    return;
  }

  const { executeTool } = loadRuntimeTools();
  const result = await executeTool(action, {
    workspaceRoot,
    fullAccessMode: true,
    trustMode: "always"
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    action,
    result: String(result || "")
  }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error?.message || String(error)
  }));
  process.exitCode = 1;
});
