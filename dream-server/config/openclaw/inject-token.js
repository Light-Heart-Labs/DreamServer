// Inject gateway auth token into Control UI so it auto-connects
// Runs at container startup before the gateway starts
//
// Three tasks:
//   1. Patch the runtime config (origins, flags, auth, model names)
//   2. Inject auto-token.js into the Control UI HTML (CSP-compliant)
//   3. Fix model references to match what llama-server actually serves
//
// IMPORTANT: The gateway sets Content-Security-Policy: script-src 'self'
// which blocks inline scripts. So we must create an EXTERNAL .js file
// and reference it via <script src="./auto-token.js"> to satisfy CSP.

const fs = require('fs');
const path = require('path');

const token = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const EXTERNAL_PORT = process.env.OPENCLAW_EXTERNAL_PORT || '7860';
const LLM_MODEL = process.env.LLM_MODEL || '';
const OPENCLAW_LLM_URL = process.env.OPENCLAW_LLM_URL || '';
const CONFIG_PATH = path.join(process.env.HOME || '/home/node', '.openclaw', 'openclaw.json');
const HTML_PATH = '/app/dist/control-ui/index.html';
const JS_PATH = '/app/dist/control-ui/auto-token.js';

// ── Part 1: Patch runtime config ──────────────────────────────────────────────

try {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  if (!config.gateway) config.gateway = {};
  if (!config.gateway.controlUi) config.gateway.controlUi = {};

  // Add external port origins so the Control UI can connect through Docker port mapping
  const origins = config.gateway.controlUi.allowedOrigins || [];
  const needed = [
    `http://localhost:${EXTERNAL_PORT}`,
    `http://127.0.0.1:${EXTERNAL_PORT}`,
  ];
  try {
    const hostname = require('os').hostname();
    if (hostname) needed.push(`http://${hostname}:${EXTERNAL_PORT}`);
  } catch {}
  for (const origin of needed) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  config.gateway.controlUi.allowedOrigins = origins;

  // Ensure controlUi flags are set for local use
  config.gateway.controlUi.allowInsecureAuth = true;
  config.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
  config.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;

  // Keep token auth (required for LAN bind) with token from env
  if (token) {
    config.gateway.auth = { mode: 'token', token: token };
  }

  // Fix model references to match what llama-server actually serves
  if (LLM_MODEL) {
    // Find the provider name (first key under models.providers)
    const providerName = config.models?.providers
      ? Object.keys(config.models.providers)[0]
      : null;

    if (providerName && config.models.providers[providerName]) {
      const provider = config.models.providers[providerName];

      // Route through LiteLLM when OLLAMA_URL points to it, and pass credentials
      const ollamaUrl = process.env.OLLAMA_URL || '';
      const litellmKey = process.env.LITELLM_KEY || '';
      if (ollamaUrl) {
        const newBase = ollamaUrl.replace(/\/$/, '') + '/v1';
        if (provider.baseUrl !== newBase) {
          console.log(`[inject-token] updated provider baseUrl: ${provider.baseUrl} -> ${newBase}`);
          provider.baseUrl = newBase;
        }
        if (litellmKey && provider.apiKey !== litellmKey) {
          provider.apiKey = litellmKey;
          console.log(`[inject-token] updated provider apiKey from env`);
        }
      }

      // Update model list — replace the first model's id
      if (Array.isArray(provider.models) && provider.models.length > 0) {
        const oldId = provider.models[0].id;
        if (oldId !== LLM_MODEL) {
          provider.models[0].id = LLM_MODEL;
          console.log(`[inject-token] updated provider model: ${oldId} -> ${LLM_MODEL}`);
        }
      }
    }

    // Update agents.defaults model references
    if (config.agents?.defaults) {
      const d = config.agents.defaults;
      const fullOld = d.model?.primary || '';
      if (fullOld && providerName) {
        const fullNew = `${providerName}/${LLM_MODEL}`;
        if (fullOld !== fullNew) {
          d.model = { primary: fullNew };
          // Rebuild models map
          d.models = { [fullNew]: {} };
          // Fix subagent model
          if (d.subagents) d.subagents.model = fullNew;
          console.log(`[inject-token] updated agent model refs: ${fullOld} -> ${fullNew}`);
        }
      }
    }
  }

  // Override LLM baseUrl for Token Spy monitoring (if OPENCLAW_LLM_URL is set)
  const providers = config.models?.providers || config.providers || {};
  if (OPENCLAW_LLM_URL && Object.keys(providers).length > 0) {
    for (const [name, provider] of Object.entries(providers)) {
      if (provider.baseUrl) {
        const oldUrl = provider.baseUrl;
        provider.baseUrl = OPENCLAW_LLM_URL;
        console.log(`[inject-token] monitoring: provider ${name} baseUrl: ${oldUrl} -> ${OPENCLAW_LLM_URL}`);
      }
    }
  }

  // Enable OpenAI-compatible HTTP API (opt-in via OPENCLAW_HTTP_API=true)
  if (process.env.OPENCLAW_HTTP_API === 'true') {
    if (!config.gateway.http) config.gateway.http = {};
    if (!config.gateway.http.endpoints) config.gateway.http.endpoints = {};
    config.gateway.http.endpoints.chatCompletions = { enabled: true };
    console.log('[inject-token] enabled HTTP /v1/chat/completions endpoint');
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log('[inject-token] patched runtime config:', CONFIG_PATH);

  // Log the browser-accessible URL with token for Docker users
  if (token) {
    console.log(`[inject-token] ┌─────────────────────────────────────────────┐`);
    console.log(`[inject-token] │ OpenClaw Control UI:                        │`);
    console.log(`[inject-token] │ http://localhost:${EXTERNAL_PORT}/#token=${token}`);
    console.log(`[inject-token] └─────────────────────────────────────────────┘`);
  }
} catch (err) {
  console.error('[inject-token] config patch warning:', err.message);
}

// ── Part 2: Inject token into Control UI ──────────────────────────────────────

if (token && fs.existsSync(HTML_PATH)) {
  try {
    // 1. Create external JS file with token-setting code
    const jsCode = [
      '(function() {',
      '  var k = "openclaw.control.settings.v1";',
      '  var s = {};',
      '  try { s = JSON.parse(localStorage.getItem(k) || "{}"); } catch(e) {}',
      '  s.token = ' + JSON.stringify(token) + ';',
      '  s.gatewayUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;',
      '  localStorage.setItem(k, JSON.stringify(s));',
      '})();',
    ].join('\n');
    fs.writeFileSync(JS_PATH, jsCode);

    // 2. Inject <script src> tag as first element in <head> (satisfies CSP 'self')
    let html = fs.readFileSync(HTML_PATH, 'utf8');
    // Remove any previous injection (inline or external)
    html = html.replace(/<script[^>]*auto-token[^>]*>[^<]*<\/script>/g, '');
    html = html.replace(/<script[^>]*src="\.\/auto-token\.js"[^>]*><\/script>/g, '');
    // Add external script reference at start of <head>
    html = html.replace('<head>', '<head><script src="./auto-token.js"></script>');
    fs.writeFileSync(HTML_PATH, html);

    console.log('[inject-token] created auto-token.js and injected <script src> into Control UI');
  } catch (err) {
    console.error('[inject-token] UI injection warning:', err.message);
  }
} else {
  if (!token) console.warn('[inject-token] no OPENCLAW_GATEWAY_TOKEN set, skipping UI injection');
  if (!fs.existsSync(HTML_PATH)) console.warn('[inject-token] Control UI HTML not found at', HTML_PATH);
}

// ── Part 3: Create merged config ─────────────────────────────────────────────

try {
  const primaryConfigPath = process.env.OPENCLAW_CONFIG || '/config/openclaw.json';
  if (fs.existsSync(primaryConfigPath)) {
    const primary = JSON.parse(fs.readFileSync(primaryConfigPath, 'utf8'));

    // Enable HTTP API in merged config (opt-in via OPENCLAW_HTTP_API=true)
    if (process.env.OPENCLAW_HTTP_API === 'true') {
      if (!primary.gateway) primary.gateway = {};
      if (!primary.gateway.http) primary.gateway.http = {};
      if (!primary.gateway.http.endpoints) primary.gateway.http.endpoints = {};
      primary.gateway.http.endpoints.chatCompletions = { enabled: true };
    }

    // Ensure gateway.controlUi settings are present (required when --bind lan
    // exposes the gateway on a non-loopback interface).  Part 1 patches these
    // into ~/.openclaw/openclaw.json but that write may fail (EACCES on
    // Docker volume), so we must also set them here in the merged config.
    if (!primary.gateway) primary.gateway = {};
    if (!primary.gateway.controlUi) primary.gateway.controlUi = {};
    primary.gateway.controlUi.allowInsecureAuth = true;
    primary.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
    primary.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;
    const extPort = process.env.OPENCLAW_EXTERNAL_PORT || '7860';
    const origins = primary.gateway.controlUi.allowedOrigins || [];
    for (const o of [`http://localhost:${extPort}`, `http://127.0.0.1:${extPort}`]) {
      if (!origins.includes(o)) origins.push(o);
    }
    primary.gateway.controlUi.allowedOrigins = origins;

    // Fix provider baseUrl to match the actual LLM endpoint (OLLAMA_URL env)
    const ollamaUrl = process.env.OLLAMA_URL || '';
    if (ollamaUrl) {
      const provs = primary.providers || {};
      for (const [name, prov] of Object.entries(provs)) {
        if (prov.baseUrl) {
          const oldUrl = prov.baseUrl;
          prov.baseUrl = ollamaUrl.replace(/\/$/, '') + '/v1';
          if (oldUrl !== prov.baseUrl) {
            console.log(`[inject-token] merged config: provider ${name} baseUrl: ${oldUrl} -> ${prov.baseUrl}`);
          }
        }
      }
    }

    const mergedPath = '/tmp/openclaw-config.json';
    fs.writeFileSync(mergedPath, JSON.stringify(primary, null, 2), 'utf8');
    console.log('[inject-token] created merged config at', mergedPath);
  }
} catch (err) {
  console.error('[inject-token] merged config warning:', err.message);
}

// ── Part 4: OpenAI-compat shim (opt-in via OPENCLAW_HTTP_API=true) ──────────
// OpenClaw serves /v1/chat/completions but not /v1/models.
// Open WebUI needs /v1/models to discover available models.
// This shim runs on port 18790, serves /v1/models, and proxies everything
// else to the gateway on 18789.

if (process.env.OPENCLAW_HTTP_API === 'true') {
  try {
    const shimScript = `
const http = require('http');
const GATEWAY_PORT = 18789;
const MODELS = JSON.stringify({
  object: 'list',
  data: [{ id: 'openclaw', object: 'model', created: ${Math.floor(Date.now() / 1000)}, owned_by: 'openclaw-gateway' }],
});

let restarts = 0;
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(MODELS);
    }
    const proxy = http.request({ hostname: '127.0.0.1', port: GATEWAY_PORT, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('gateway unavailable'); });
    req.pipe(proxy);
  });
  server.on('error', (err) => {
    console.error('[openai-shim] server error: ' + err.message);
    if (restarts < 5) {
      restarts++;
      const delay = restarts * 2000;
      console.error('[openai-shim] restarting in ' + delay + 'ms (attempt ' + restarts + '/5)');
      setTimeout(startServer, delay);
    } else {
      console.error('[openai-shim] too many failures, giving up');
    }
  });
  server.listen(18790, '0.0.0.0', () => {
    restarts = 0;
    console.log('[openai-shim] /v1/models + proxy on :18790');
  });
}
startServer();

process.on('uncaughtException', (err) => {
  console.error('[openai-shim] uncaught exception: ' + err.message);
});
process.on('SIGTERM', () => {
  console.error('[openai-shim] received SIGTERM, shutting down');
  process.exit(0);
});
`;
    fs.writeFileSync('/tmp/openai-shim.js', shimScript);

    const { spawn } = require('child_process');
    const child = spawn('node', ['/tmp/openai-shim.js'], {
      detached: true,
      stdio: 'inherit',
    });
    child.unref();
    console.log('[inject-token] started openai-shim (pid %d)', child.pid);
  } catch (err) {
    console.error('[inject-token] shim warning:', err.message);
  }
}
