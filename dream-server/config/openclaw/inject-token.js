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

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log('[inject-token] patched runtime config:', CONFIG_PATH);
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
