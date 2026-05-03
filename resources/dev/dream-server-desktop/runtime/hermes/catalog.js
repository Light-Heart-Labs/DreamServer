const fs = require("fs");
const path = require("path");

const CACHE_TTL_MS = 15000;
const MAX_SKILLS = 400;

let catalogCache = null;
let catalogCacheAt = 0;
let catalogCacheRoot = "";

const BUILTIN_COMMANDS = [
  ["/new", "Start a new Hermes conversation", "conversation"],
  ["/clear", "Clear the current chat context", "conversation"],
  ["/history", "Show Hermes conversation history", "conversation"],
  ["/save", "Save the current conversation", "conversation"],
  ["/retry", "Retry the last turn", "conversation"],
  ["/undo", "Undo the last message", "conversation"],
  ["/title", "Rename the current conversation", "conversation"],
  ["/branch", "Manage branch context", "workspace"],
  ["/compress", "Compress context", "conversation"],
  ["/rollback", "Rollback to a previous snapshot", "workspace"],
  ["/snapshot", "Create or inspect a snapshot", "workspace"],
  ["/stop", "Stop the active Hermes turn", "runtime"],
  ["/approve", "Approve a pending action", "runtime"],
  ["/deny", "Deny a pending action", "runtime"],
  ["/background", "Manage background work", "runtime"],
  ["/btw", "Add a background note", "conversation"],
  ["/agents", "List or manage subagents", "agents"],
  ["/queue", "Inspect queued work", "agents"],
  ["/steer", "Steer a running agent", "agents"],
  ["/status", "Show Hermes status", "runtime"],
  ["/profile", "Switch or inspect profile", "settings"],
  ["/sethome", "Set Hermes home", "settings"],
  ["/resume", "Resume a prior conversation", "conversation"],
  ["/config", "Open or inspect Hermes config", "settings"],
  ["/model", "Switch model/provider in Hermes", "settings"],
  ["/provider", "Switch provider in Hermes", "settings"],
  ["/gquota", "Show gateway quota", "settings"],
  ["/personality", "Manage Hermes personality", "settings"],
  ["/statusbar", "Configure status bar", "settings"],
  ["/verbose", "Toggle verbose output", "settings"],
  ["/yolo", "Toggle YOLO approval mode", "settings"],
  ["/reasoning", "Configure reasoning mode", "settings"],
  ["/fast", "Toggle fast mode", "settings"],
  ["/skin", "Change Hermes skin/theme", "settings"],
  ["/voice", "Configure voice features", "settings"],
  ["/tools", "List or configure tools", "tools"],
  ["/toolsets", "List or configure toolsets", "tools"],
  ["/skills", "List and inspect skills", "skills"],
  ["/cron", "Manage cron jobs", "runtime"],
  ["/reload", "Reload Hermes configuration", "runtime"],
  ["/reload-mcp", "Reload MCP servers", "tools"],
  ["/browser", "Control the browser tool", "tools"],
  ["/plugins", "List or manage plugins", "tools"],
  ["/commands", "List available commands", "help"],
  ["/platforms", "List gateway platforms", "gateways"],
  ["/copy", "Copy from the terminal/session", "utility"],
  ["/paste", "Paste into Hermes", "utility"],
  ["/image", "Attach or inspect images", "utility"],
  ["/update", "Update Hermes", "runtime"],
  ["/debug", "Show debug diagnostics", "runtime"],
  ["/help", "Show Hermes help", "help"]
].map(([name, description, category]) => ({
  name,
  label: name.slice(1),
  title: name,
  description,
  category,
  source: "hermes"
}));

const GATEWAY_HINTS = {
  api_server: {
    label: "API Server",
    env: ["HERMES_API_TOKEN", "HERMES_GATEWAY_HOST", "HERMES_GATEWAY_PORT"]
  },
  bluebubbles: {
    label: "BlueBubbles",
    env: ["BLUEBUBBLES_SERVER_URL", "BLUEBUBBLES_PASSWORD"]
  },
  dingtalk: {
    label: "DingTalk",
    env: ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"]
  },
  discord: {
    label: "Discord",
    env: ["DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_USERS", "DISCORD_HOME_CHANNEL"]
  },
  email: {
    label: "Email",
    env: ["EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST", "EMAIL_USERNAME", "EMAIL_PASSWORD"]
  },
  feishu: {
    label: "Feishu",
    env: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"]
  },
  homeassistant: {
    label: "Home Assistant",
    env: ["HOMEASSISTANT_URL", "HOMEASSISTANT_TOKEN"]
  },
  matrix: {
    label: "Matrix",
    env: ["MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN", "MATRIX_ROOM_ID"]
  },
  mattermost: {
    label: "Mattermost",
    env: ["MATTERMOST_URL", "MATTERMOST_TOKEN", "MATTERMOST_TEAM"]
  },
  signal: {
    label: "Signal",
    env: ["SIGNAL_PHONE_NUMBER"]
  },
  slack: {
    label: "Slack",
    env: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]
  },
  sms: {
    label: "SMS",
    env: ["SMS_PROVIDER", "SMS_ACCOUNT_SID", "SMS_AUTH_TOKEN"]
  },
  telegram: {
    label: "Telegram",
    env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS", "TELEGRAM_HOME_CHAT"]
  },
  webhook: {
    label: "Webhook",
    env: ["WEBHOOK_SECRET", "WEBHOOK_BASE_URL"]
  },
  wecom: {
    label: "WeCom",
    env: ["WECOM_CORP_ID", "WECOM_SECRET"]
  },
  weixin: {
    label: "Weixin",
    env: ["WEIXIN_APP_ID", "WEIXIN_APP_SECRET"]
  },
  whatsapp: {
    label: "WhatsApp",
    env: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]
  }
};

function projectRootFromRuntime() {
  const root = path.resolve(__dirname, "..", "..");
  return root.includes("app.asar")
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;
}

function defaultHermesRoot() {
  return path.join(projectRootFromRuntime(), "vendor", "hermes-agent");
}

function slugifySkillName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFrontmatter(raw) {
  const text = String(raw || "");
  if (!text.startsWith("---")) {
    return {};
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return {};
  }
  const body = text.slice(3, end).split(/\r?\n/);
  const data = {};
  for (const line of body) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    data[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return data;
}

function descriptionFromSkill(raw, frontmatter) {
  if (frontmatter.description) {
    return frontmatter.description;
  }
  const withoutFrontmatter = String(raw || "").replace(/^---[\s\S]*?\n---\s*/, "");
  const firstUseful = withoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("```"));
  return firstUseful || "Hermes skill";
}

function safeReadText(filePath, maxBytes = 65536) {
  try {
    const stat = fs.statSync(filePath);
    const bytes = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytes);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, bytes, 0);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function readPythonStringConstants(raw) {
  const constants = {};
  const text = String(raw || "");
  for (const match of text.matchAll(/^([A-Z][A-Z0-9_]+)\s*=\s*(["'])(.*?)\2/gm)) {
    constants[match[1]] = match[3];
  }
  return constants;
}

function resolvePythonString(value, constants = {}) {
  const text = String(value || "").trim().replace(/\s+#.*$/, "");
  const quoted = text.match(/^(["'])([\s\S]*)\1$/);
  if (quoted) {
    return quoted[2].replace(/\\(["'])/g, "$1");
  }
  return constants[text] || "";
}

function readProviderField(block, field, constants) {
  const match = String(block || "").match(new RegExp(`${field}\\s*=\\s*([^,\\n]+)`));
  return match ? resolvePythonString(match[1], constants) : "";
}

function readProviders(hermesRoot) {
  const authPath = path.join(hermesRoot, "hermes_cli", "auth.py");
  const raw = safeReadText(authPath, 512 * 1024);
  if (!raw) {
    return [];
  }
  const constants = readPythonStringConstants(raw);
  const start = raw.indexOf("PROVIDER_REGISTRY");
  if (start === -1) {
    return [];
  }
  const registry = raw.slice(start);
  const providers = [];
  for (const match of registry.matchAll(/["']([^"']+)["']\s*:\s*ProviderConfig\(([\s\S]*?)\n\s*\),/g)) {
    const id = match[1];
    const block = match[2];
    const name = readProviderField(block, "name", constants) || id;
    const authType = readProviderField(block, "auth_type", constants);
    const inferenceBaseUrl = readProviderField(block, "inference_base_url", constants);
    const baseUrlEnvVar = readProviderField(block, "base_url_env_var", constants);
    providers.push({
      id,
      label: name,
      authType,
      inferenceBaseUrl,
      baseUrlEnvVar,
      source: "hermes-provider-registry"
    });
  }
  return providers;
}

function findSkillFiles(rootDir) {
  const results = [];
  const stack = [rootDir];
  while (stack.length && results.length < MAX_SKILLS) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "index-cache") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        results.push(fullPath);
        if (results.length >= MAX_SKILLS) {
          break;
        }
      }
    }
  }
  return results;
}

function readSkills(hermesRoot) {
  const roots = [
    { dir: path.join(hermesRoot, "skills"), source: "skill" },
    { dir: path.join(hermesRoot, "optional-skills"), source: "optional-skill" }
  ];
  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) {
      continue;
    }
    for (const skillPath of findSkillFiles(root.dir)) {
      const raw = safeReadText(skillPath);
      const frontmatter = parseFrontmatter(raw);
      const relative = path.relative(root.dir, path.dirname(skillPath)).replace(/\\/g, "/");
      const inferredName = frontmatter.name || path.basename(path.dirname(skillPath));
      const label = slugifySkillName(inferredName || relative);
      if (!label || seen.has(label)) {
        continue;
      }
      seen.add(label);
      skills.push({
        name: `/${label}`,
        label,
        title: frontmatter.name || inferredName,
        description: descriptionFromSkill(raw, frontmatter),
        category: relative.split("/")[0] || root.source,
        source: root.source,
        path: skillPath
      });
    }
  }
  return skills.sort((left, right) => left.label.localeCompare(right.label));
}

function readGateways(hermesRoot) {
  const platformsDir = path.join(hermesRoot, "gateway", "platforms");
  if (!fs.existsSync(platformsDir)) {
    return [];
  }
  let entries = [];
  try {
    entries = fs.readdirSync(platformsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py") && !entry.name.startsWith("__"))
    .map((entry) => path.basename(entry.name, ".py"))
    .filter((id) => !["base", "helpers", "telegram_network", "feishu_comment_rules", "wecom_crypto"].includes(id))
    .sort()
    .map((id) => ({
      id,
      label: GATEWAY_HINTS[id]?.label || id.replace(/_/g, " "),
      env: GATEWAY_HINTS[id]?.env || [],
      available: true,
      source: "hermes-gateway"
    }));
}

function getHermesCatalog(hermesRoot = defaultHermesRoot(), options = {}) {
  const root = path.resolve(String(hermesRoot || defaultHermesRoot()));
  const now = Date.now();
  if (!options.force && catalogCache && catalogCacheRoot === root && now - catalogCacheAt < CACHE_TTL_MS) {
    return catalogCache;
  }
  const skills = readSkills(root);
  const gateways = readGateways(root);
  const providers = readProviders(root);
  const commands = BUILTIN_COMMANDS;
  catalogCache = {
    hermesRoot: root,
    commands,
    skills,
    gateways,
    providers,
    counts: {
      commands: commands.length,
      skills: skills.length,
      gateways: gateways.length,
      providers: providers.length
    },
    updatedAt: now
  };
  catalogCacheRoot = root;
  catalogCacheAt = now;
  return catalogCache;
}

module.exports = {
  getHermesCatalog,
  _test: {
    slugifySkillName,
    parseFrontmatter,
    readGateways,
    readProviders,
    readSkills
  }
};
