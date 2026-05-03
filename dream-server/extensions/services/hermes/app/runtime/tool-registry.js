const { spawnSync } = require("child_process");

const commandAvailabilityCache = new Map();
const moduleAvailabilityCache = new Map();

const DEFAULT_LIMITED_TOOL_NAMES = new Set([
  "open_url",
  "open_path",
  "reveal_path",
  "launch_app",
  "set_preview_device",
  "read_file",
  "list_directory",
  "glob_files",
  "grep_files",
  "verify_file",
  "verify_url",
  "browser_check",
  "web_fetch",
  "web_search",
  "mcp_list_tools"
]);

const TOOLSET_RULES = [
  { toolset: "desktop", names: ["launch_app", "open_url", "open_path", "reveal_path", "set_preview_device", "set_volume", "media_control"] },
  { toolset: "filesystem", names: ["read_file", "write_file", "append_file", "file_edit", "apply_patch", "file_rollback", "create_directory", "delete_path", "list_directory", "glob_files", "grep_files", "verify_file"] },
  { toolset: "terminal", names: ["run_command", "verify_command", "terminal_open", "terminal_exec", "terminal_close", "background_command_start", "background_command_logs", "background_command_stop", "stop_all_local_activity"] },
  { toolset: "browser", names: ["browser_check", "browser_control", "verify_browser_console", "verify_site", "verify_url"] },
  { toolset: "web", names: ["web_fetch", "web_search"] },
  { toolset: "android", names: ["adb_command", "adb_shell", "fastboot_command"] },
  { toolset: "mcp", names: ["mcp_list_tools", "mcp_call"] },
  { toolset: "memory", names: ["todo_read", "todo_write", "task_create", "task_list", "task_get", "task_update", "task_stop"] },
  { toolset: "agent", names: ["agent_spawn", "agent_list", "agent_wait", "agent_result", "agent_stop"] },
  { toolset: "git", names: ["git_status", "git_create_branch", "git_worktree_add", "git_worktree_list", "git_worktree_remove"] },
  { toolset: "project", names: ["project_prepare_vite"] },
  { toolset: "language", names: ["file_symbols", "workspace_symbols", "lsp_document_symbols", "lsp_workspace_symbols", "lsp_definition", "lsp_references", "lsp_hover", "lsp_code_actions", "lsp_apply_code_action", "lsp_rename"] }
];

function commandExists(command) {
  const normalized = String(command || "").trim();
  if (!normalized) {
    return false;
  }
  if (commandAvailabilityCache.has(normalized)) {
    return commandAvailabilityCache.get(normalized);
  }

  const probe = process.platform === "win32"
    ? spawnSync("where.exe", [normalized], { windowsHide: true, encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${JSON.stringify(normalized)}`], { encoding: "utf8" });
  const ok = Number(probe.status || 0) === 0;
  commandAvailabilityCache.set(normalized, ok);
  return ok;
}

function moduleExists(moduleName) {
  const normalized = String(moduleName || "").trim();
  if (!normalized) {
    return false;
  }
  if (moduleAvailabilityCache.has(normalized)) {
    return moduleAvailabilityCache.get(normalized);
  }
  let ok = false;
  try {
    require.resolve(normalized);
    ok = true;
  } catch {
    ok = false;
  }
  moduleAvailabilityCache.set(normalized, ok);
  return ok;
}

function inferToolset(toolName) {
  const name = String(toolName || "").trim();
  for (const rule of TOOLSET_RULES) {
    if (rule.names.includes(name)) {
      return rule.toolset;
    }
  }
  return "system";
}

function normalizeManifest(manifest) {
  const tool = { ...(manifest || {}) };
  tool.name = String(tool.name || "").trim();
  tool.permissionClass = tool.permissionClass || "system-write";
  tool.supportedSurfaces = Array.isArray(tool.supportedSurfaces) && tool.supportedSurfaces.length
    ? tool.supportedSurfaces
    : ["desktop", "cli", "headless"];
  tool.toolset = tool.toolset || inferToolset(tool.name);
  tool.inputSchema = tool.inputSchema || { type: "object", properties: {} };
  return tool;
}

function checkToolAvailability(tool, context = {}) {
  const name = String(tool?.name || "").trim();
  if (!name) {
    return { available: false, reason: "Manifest sem nome." };
  }

  if (["browser_control", "browser_check", "verify_browser_console"].includes(name) && !moduleExists("playwright-core")) {
    return { available: false, reason: "playwright-core nao esta instalado." };
  }

  if (["adb_command", "adb_shell"].includes(name) && !commandExists("adb")) {
    return { available: false, reason: "adb nao esta disponivel no PATH." };
  }

  if (name === "fastboot_command" && !commandExists("fastboot")) {
    return { available: false, reason: "fastboot nao esta disponivel no PATH." };
  }

  if (name.startsWith("git_") && !commandExists("git")) {
    return { available: false, reason: "git nao esta disponivel no PATH." };
  }

  if (name === "mcp_call") {
    const connected = context.mcpState?.connected || context.mcpManager?.getState?.().connected || [];
    if (Array.isArray(connected) && connected.length === 0) {
      return { available: false, reason: "nenhum servidor MCP conectado." };
    }
  }

  return { available: true, reason: "" };
}

function summarizeText(value, maxLength = 260) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function inferErrorType(text) {
  const source = String(text || "");
  if (/ModuleNotFoundError:\s+No module named/i.test(source)) return "missing_python_module";
  if (/ENOENT|not recognized|n[aã]o.+reconhecido|command not found/i.test(source)) return "missing_executable";
  if (/EACCES|access denied|acesso negado/i.test(source)) return "permission_denied";
  if (/timed out|timeout|excedeu/i.test(source)) return "timeout";
  if (/verification failed|verifica[cç][aã]o.+falhou/i.test(source)) return "verification_failed";
  if (/exit code|codigo \d+|c[oó]digo \d+/i.test(source)) return "non_zero_exit";
  return source ? "tool_error" : "";
}

function inferRepairHints(text) {
  const source = String(text || "");
  const hints = [];
  const pythonModule = source.match(/ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i);
  if (pythonModule?.[1]) {
    hints.push(`Instalar o pacote Python ausente: ${pythonModule[1]}.`);
    hints.push("Reexecutar o comando original depois da instalacao ou usar uma alternativa sem essa dependencia.");
  }
  if (/ENOENT|not recognized|n[aã]o.+reconhecido|command not found/i.test(source)) {
    hints.push("Verificar se o executavel existe no PATH ou usar caminho absoluto.");
  }
  if (/verification failed|verifica[cç][aã]o.+falhou/i.test(source)) {
    hints.push("Observar o erro de verificacao, corrigir a causa concreta e verificar novamente antes de finalizar.");
  }
  if (/timed out|timeout|excedeu/i.test(source)) {
    hints.push("Checar se o processo travou, coletar logs e encerrar a arvore de processos se necessario.");
  }
  return [...new Set(hints)];
}

function normalizeToolResult(action, ok, rawResult, registry = null) {
  const type = String(action?.type || "").trim();
  const manifest = registry?.getManifest(type) || null;
  const text = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult ?? "");
  const errorType = ok ? "" : inferErrorType(text);
  return {
    ok: Boolean(ok),
    tool: type,
    toolset: manifest?.toolset || inferToolset(type),
    permissionClass: manifest?.permissionClass || "",
    summary: summarizeText(text),
    output: rawResult,
    errorType,
    repairHints: ok ? [] : inferRepairHints(text)
  };
}

class ToolRegistry {
  constructor(manifests = [], options = {}) {
    this.limitedToolNames = options.limitedToolNames || DEFAULT_LIMITED_TOOL_NAMES;
    this.manifests = manifests.map(normalizeManifest).filter((tool) => tool.name);
    this.byName = new Map(this.manifests.map((tool) => [tool.name, tool]));
  }

  getManifest(name) {
    return this.byName.get(String(name || "").trim()) || null;
  }

  checkAvailability(nameOrManifest, context = {}) {
    const manifest = typeof nameOrManifest === "string" ? this.getManifest(nameOrManifest) : normalizeManifest(nameOrManifest);
    if (!manifest?.name) {
      return { available: false, reason: "Tool desconhecida." };
    }
    return checkToolAvailability(manifest, context);
  }

  list(options = {}) {
    const fullAccessMode = Boolean(options.fullAccessMode);
    const surface = String(options.surface || "").trim();
    const includeUnavailable = Boolean(options.includeUnavailable);
    const context = options.context || options;

    return this.manifests
      .filter((tool) => fullAccessMode || this.limitedToolNames.has(tool.name))
      .filter((tool) => !surface || tool.supportedSurfaces.includes(surface))
      .map((tool) => {
        const availability = this.checkAvailability(tool, context);
        return { ...tool, availability };
      })
      .filter((tool) => includeUnavailable || tool.availability.available);
  }

  getOpenAIToolSchemas(options = {}) {
    return this.list(options).map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  getSupportedTools(options = {}) {
    return this.list({ ...options, includeUnavailable: true }).map((tool) => ({
      name: tool.name,
      toolset: tool.toolset,
      permissionClass: tool.permissionClass,
      supportedSurfaces: tool.supportedSurfaces,
      available: Boolean(tool.availability?.available),
      unavailableReason: tool.availability?.reason || ""
    }));
  }
}

function createToolRegistry(manifests = [], options = {}) {
  return new ToolRegistry(manifests, options);
}

module.exports = {
  DEFAULT_LIMITED_TOOL_NAMES,
  ToolRegistry,
  checkToolAvailability,
  createToolRegistry,
  inferRepairHints,
  inferToolset,
  normalizeToolResult
};
