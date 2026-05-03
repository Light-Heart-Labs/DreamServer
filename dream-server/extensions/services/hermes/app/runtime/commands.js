const { gitCreateBranch, gitStatus, gitWorktreeList } = require("./git");
const { getLspState, workspaceSymbolsLsp } = require("./lsp");
const { resolveHermesRoutingSettings } = require("./providers/hermes");
const { workspaceSymbols } = require("./symbols");

function parseJsonLoose(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const RUNTIME_SLASH_COMMANDS = new Set([
  "/help",
  "/provider",
  "/model",
  "/trust",
  "/agents",
  "/mcp",
  "/doctor",
  "/projects",
  "/stop-all",
  "/todo",
  "/task",
  "/agent",
  "/git",
  "/symbols",
  "/lsp"
]);

const PROVIDER_ALIASES = {
  cloud: "auto",
  manus: "auto",
  manuscloud: "auto",
  "manus-cloud": "auto",
  local: "custom",
  ollama: "custom",
  external: "custom",
  google: "gemini",
  claude: "anthropic",
  chatgpt: "openai",
  gpt: "openai",
  kimi: "kimi-coding",
  moonshot: "kimi-coding",
  "kimi-cn": "kimi-coding-cn",
  kimi_cn: "kimi-coding-cn",
  nvidia_nim: "nvidia",
  "nvidia-nim": "nvidia",
  hf: "huggingface",
  glm: "zai"
};

function normalizeProvider(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] || normalized;
}

function isRuntimeSlashCommand(input) {
  const [command] = String(input || "").trim().split(/\s+/);
  return RUNTIME_SLASH_COMMANDS.has(String(command || "").toLowerCase());
}

function hermesRouteSummary(settings = {}) {
  const route = resolveHermesRoutingSettings(settings);
  return [
    `provider=${route.provider || "custom"}`,
    route.model ? `model=${route.model}` : "",
    route.baseUrl ? `base=${route.baseUrl}` : "base=config/env"
  ].filter(Boolean).join(" · ");
}

function slashHelp() {
  return [
    "Comandos disponiveis:",
    "/provider [openrouter|openai|anthropic|gemini|kimi|nvidia|custom|auto] - troca o provider Dream Server DESKTOP ativo",
    "/model [nome] - troca o modelo Dream Server DESKTOP ativo",
    "/trust [ask|session|always] - define o modo de aprovacao",
    "/agents - mostra a rota atual e o catalogo de agentes",
    "/mcp list - mostra servidores MCP configurados/conectados",
    "/mcp add <nome> <comando> [args...] - adiciona um servidor MCP",
    "/mcp connect <nome> - conecta um servidor MCP",
    "/mcp tools <nome> - lista as tools do servidor",
    "/mcp remove <nome> - remove um servidor MCP",
    "/todo [list|add|done] - gerencia todos persistentes",
    "/task [list|create|get|stop] - gerencia tarefas persistentes",
    "/projects - lista projetos locais lembrados pelo runtime",
    "/stop-all - para jobs, terminais e execucoes locais ativas",
    "/agent [list|spawn|result|wait|stop] - gerencia subagentes",
    "/git [status|branch|worktrees] - fluxo git/worktree",
    "/symbols [query] - busca simbolos no workspace",
    "/lsp [status|symbols] - diagnostico e busca via language engine JS/TS",
    "/doctor - mostra diagnostico do provider local/cloud",
    "/help - mostra esta ajuda"
  ].join("\n");
}

async function runSlashCommand(runtime, chat, input) {
  const [rawCommand, ...rest] = String(input || "").trim().split(/\s+/);
  const command = String(rawCommand || "").toLowerCase();
  const value = rest.join(" ").trim();

  if (command === "/help") {
    return slashHelp();
  }

  if (command === "/provider") {
    if (!value) {
      return `Provider Dream Server DESKTOP atual: ${hermesRouteSummary(runtime.state.settings)}.`;
    }
    const provider = normalizeProvider(value) || "custom";
    const providerMode = "local";
    runtime.updateSettings({ hermesProvider: provider, providerMode });
    runtime.setChatProvider(chat.id, providerMode);
    return `Provider Dream Server DESKTOP ativo: ${hermesRouteSummary(runtime.state.settings)}.`;
  }

  if (command === "/model") {
    if (!value) {
      return `Modelo Dream Server DESKTOP atual: ${hermesRouteSummary(runtime.state.settings)}.`;
    }
    runtime.updateSettings({ localModel: value });
    return `Modelo Dream Server DESKTOP atualizado: ${hermesRouteSummary(runtime.state.settings)}.`;
  }

  if (command === "/trust") {
    const trustMode = ["ask", "session", "always"].includes(value.toLowerCase())
      ? value.toLowerCase()
      : "ask";
    runtime.updateSettings({ trustMode });
    return `Trust mode atualizado para ${trustMode}.`;
  }

  if (command === "/agents") {
    const route = chat.activeRoute?.id || "general-purpose";
    return [
      `Rota atual: ${route}`,
      runtime.getPublicState().routingCatalog
    ].join("\n");
  }

  if (command === "/mcp") {
    const [subcommand, name, ...tail] = rest;
    const action = String(subcommand || "list").toLowerCase();
    await runtime.mcpManager.ensureLoaded();

    if (action === "list") {
      const state = runtime.mcpManager.getState();
      const configured = state.configured.length
        ? state.configured.map((server) => `- ${server.name} -> ${server.command} ${server.args.join(" ")}`.trim()).join("\n")
        : "(nenhum configurado)";
      const connected = state.connected.length
        ? state.connected.map((server) => `- ${server.name}: ${server.tools.join(", ") || "sem tools cacheadas"}`).join("\n")
        : "(nenhum conectado)";
      return [`Servidores MCP configurados:`, configured, ``, `Servidores MCP conectados:`, connected].join("\n");
    }

    if (action === "add") {
      const serverName = String(name || "").trim();
      const serverCommand = String(tail[0] || "").trim();
      const serverArgs = tail.slice(1);
      if (!serverName || !serverCommand) {
        return "Uso: /mcp add <nome> <comando> [args...]";
      }
      const server = await runtime.mcpManager.addServer({
        name: serverName,
        command: serverCommand,
        args: serverArgs
      });
      return `Servidor MCP salvo: ${server.name} -> ${server.command} ${server.args.join(" ")}`.trim();
    }

    if (action === "connect") {
      if (!name) {
        return "Uso: /mcp connect <nome>";
      }
      const connection = await runtime.mcpManager.connect(name);
      return `Servidor MCP conectado: ${name}\nTools: ${connection.tools.map((tool) => tool.name).join(", ") || "(nenhuma)"}`;
    }

    if (action === "tools") {
      if (!name) {
        return "Uso: /mcp tools <nome>";
      }
      const tools = await runtime.mcpManager.listTools(name);
      return tools.length
        ? [`Tools do servidor ${name}:`, ...tools.map((tool) => `- ${tool.name}: ${tool.description || "sem descricao"}`)].join("\n")
        : `O servidor ${name} nao retornou tools.`;
    }

    if (action === "remove") {
      if (!name) {
        return "Uso: /mcp remove <nome>";
      }
      await runtime.mcpManager.removeServer(name);
      return `Servidor MCP removido: ${name}`;
    }

    if (action === "call") {
      const tool = String(name || "").trim();
      const serverName = String(tail[0] || "").trim();
      const rawArgs = tail.slice(1).join(" ").trim();
      if (!tool || !serverName) {
        return "Uso: /mcp call <tool> <servidor> [jsonArgs]";
      }
      const parsedArgs = rawArgs ? parseJsonLoose(rawArgs) || {} : {};
      const result = await runtime.mcpManager.callTool(serverName, tool, parsedArgs);
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }

    return "Uso: /mcp [list|add|connect|tools|remove|call]";
  }

  if (command === "/doctor") {
    const settings = runtime.state.settings;
    const workspaceRoot = runtime.getWorkspaceRoot(chat);
    const lspState = getLspState(workspaceRoot);
    return [
      "Diagnostico:",
      `- workspace: ${workspaceRoot}`,
      `- runtime: Dream Server DESKTOP`,
      `- rota Dream Server DESKTOP: ${hermesRouteSummary(settings)}`,
      `- trust mode: ${settings.trustMode}`,
      `- ponte local: ${settings.desktopBridgeEnabled ? "ativa" : "desligada"}`,
      `- acesso total: ${settings.fullAccessMode ? "ligado" : "desligado"}`,
      `- projetos lembrados: ${runtime.state.projects.length}`,
      `- lsp: ${lspState.available ? lspState.engine : lspState.lastError || "off"}`
    ].join("\n");
  }

  if (command === "/projects") {
    const projects = runtime.state.projects || [];
    return projects.length
      ? projects
          .slice(0, 12)
          .map((project) =>
            [
              `- [${project.status}] ${project.name || project.slug}`,
              project.path ? `  path: ${project.path}` : null,
              project.url ? `  url: ${project.url}` : null,
              project.lastError ? `  erro: ${project.lastError.slice(0, 240)}` : null
            ].filter(Boolean).join("\n")
          )
          .join("\n")
      : "(nenhum projeto registrado)";
  }

  if (command === "/stop-all") {
    const response = await runtime.stopAllLocalActivity();
    return response.result || "Atividade local interrompida.";
  }

  if (command === "/todo") {
    const [subcommand, ...tail] = rest;
    const action = String(subcommand || "list").toLowerCase();
    if (action === "list") {
      const todos = runtime.listTodos();
      return todos.length
        ? todos.map((todo) => `- [${todo.status}] (${todo.priority}) ${todo.id}: ${todo.text}`).join("\n")
        : "(nenhum todo)";
    }
    if (action === "add") {
      const text = tail.join(" ").trim();
      if (!text) {
        return "Uso: /todo add <texto>";
      }
      const [todo] = runtime.writeTodos({
        mode: "append",
        todos: [{ text }]
      });
      return `Todo criado: ${todo.id}`;
    }
    if (action === "done") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /todo done <id>";
      }
      runtime.writeTodos({
        mode: "append",
        todos: [{ id, status: "done" }]
      });
      return `Todo marcado como done: ${id}`;
    }
    return "Uso: /todo [list|add|done]";
  }

  if (command === "/task") {
    const [subcommand, ...tail] = rest;
    const action = String(subcommand || "list").toLowerCase();
    if (action === "list") {
      const tasks = runtime.listTaskRecords();
      return tasks.length
        ? tasks.map((task) => `- [${task.status}] ${task.id}: ${task.title}`).join("\n")
        : "(nenhuma tarefa)";
    }
    if (action === "create") {
      const joined = tail.join(" ");
      const [title, objective] = joined.split("|").map((item) => item.trim());
      if (!title || !objective) {
        return "Uso: /task create <titulo> | <objetivo>";
      }
      const task = runtime.createTaskRecord({ title, objective });
      return `Tarefa criada: ${task.id}`;
    }
    if (action === "get") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /task get <id>";
      }
      const task = runtime.getTaskRecord(id);
      return task ? JSON.stringify(task, null, 2) : `Tarefa nao encontrada: ${id}`;
    }
    if (action === "stop") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /task stop <id>";
      }
      runtime.updateTaskRecord(id, { status: "stopped" });
      return `Tarefa parada: ${id}`;
    }
    return "Uso: /task [list|create|get|stop]";
  }

  if (command === "/agent") {
    const [subcommand, ...tail] = rest;
    const action = String(subcommand || "list").toLowerCase();
    if (action === "list") {
      const agents = runtime.listAgents();
      return agents.length
        ? agents.map((agent) => `- [${agent.status}] ${agent.id}: ${agent.name}${agent.worktreeBranch ? ` [${agent.worktreeBranch}]` : ""}${agent.worktreePath ? ` @ ${agent.worktreePath}` : ""}`).join("\n")
        : "(nenhum subagente)";
    }
    if (action === "spawn") {
      const joined = tail.join(" ");
      const [name, objective] = joined.includes("|")
        ? joined.split("|").map((item) => item.trim())
        : ["Agent", joined.trim()];
      if (!objective) {
        return "Uso: /agent spawn <nome opcional> | <objetivo>";
      }
      const agent = await runtime.spawnAgent({
        name,
        objective,
        cloudApiKey: process.env.MANUS_API_KEY || process.env.MANUS_API_KEY_CLOUD || ""
      });
      return `Subagente criado: ${agent.id}`;
    }
    if (action === "result") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /agent result <id>";
      }
      const agent = runtime.getAgentRecord(id);
      return agent ? JSON.stringify(agent, null, 2) : `Subagente nao encontrado: ${id}`;
    }
    if (action === "wait") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /agent wait <id>";
      }
      const agent = await runtime.waitForAgent(id, 300000);
      return `${agent.id}: ${agent.status}\n${agent.summary || ""}`.trim();
    }
    if (action === "stop") {
      const id = String(tail[0] || "").trim();
      if (!id) {
        return "Uso: /agent stop <id>";
      }
      await runtime.stopAgent(id);
      return `Subagente parado: ${id}`;
    }
    return "Uso: /agent [list|spawn|result|wait|stop]";
  }

  if (command === "/git") {
    const [subcommand, ...tail] = rest;
    const action = String(subcommand || "status").toLowerCase();
    if (action === "status") {
      return await gitStatus(runtime.workspaceRoot);
    }
    if (action === "branch") {
      const name = tail[0];
      if (!name) {
        return "Uso: /git branch <nome>";
      }
      return await gitCreateBranch(runtime.workspaceRoot, name, "HEAD", false);
    }
    if (action === "worktrees") {
      const worktrees = await gitWorktreeList(runtime.workspaceRoot);
      return worktrees.length
        ? worktrees.map((entry) => `- ${entry.path}${entry.branch ? ` (${entry.branch})` : ""}`).join("\n")
        : "(nenhuma worktree)";
    }
    return "Uso: /git [status|branch|worktrees]";
  }

  if (command === "/symbols") {
    const query = value;
    const workspaceRoot = runtime.getWorkspaceRoot(chat);
    const lspState = getLspState(workspaceRoot);
    const hasAnyLsp =
      lspState.available ||
      (Array.isArray(lspState.externalServers) && lspState.externalServers.some((server) => server.available));
    const symbols = hasAnyLsp
      ? await workspaceSymbolsLsp(query, workspaceRoot, { maxResults: 60 })
      : await workspaceSymbols(query, workspaceRoot, { maxResults: 60 });
    return symbols.length
      ? symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} :: ${symbol.file}:${symbol.line}`).join("\n")
      : "Nenhum simbolo encontrado.";
  }

  if (command === "/lsp") {
    const [subcommand, ...tail] = rest;
    const action = String(subcommand || "status").toLowerCase();
    const workspaceRoot = runtime.getWorkspaceRoot(chat);
    const lspState = getLspState(workspaceRoot);

    if (action === "status") {
      return [
        `Workspace: ${workspaceRoot}`,
        `- available: ${lspState.available ? "yes" : "no"}`,
        `- engine: ${lspState.engine || "none"}`,
        `- projects: ${Array.isArray(lspState.projects) ? lspState.projects.length : 0}`,
        lspState.projects?.length
          ? lspState.projects
              .map((project) => `  - ${project.root}${project.configPath ? ` (${project.configPath})` : ""} :: ${project.fileCount} files`)
              .join("\n")
          : "",
        Array.isArray(lspState.externalServers) && lspState.externalServers.length
          ? `- external:\n${lspState.externalServers.map((server) => `  - ${server.id}: ${server.available ? `${server.candidate || server.command}` : "off"} [${(server.extensions || []).join(", ")}]`).join("\n")}`
          : "",
        Array.isArray(lspState.activeClients) && lspState.activeClients.length
          ? `- active clients:\n${lspState.activeClients.map((client) => `  - ${client.id}: ${client.initialized ? "ready" : "starting"} :: ${client.executablePath}`).join("\n")}`
          : "",
        lspState.lastError ? `- error: ${lspState.lastError}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (action === "symbols") {
      const query = tail.join(" ").trim();
      if (!lspState.available) {
        return lspState.lastError || "O motor LSP/TypeScript nao esta disponivel neste runtime.";
      }
      const symbols = await workspaceSymbolsLsp(query, workspaceRoot, { maxResults: 80 });
      return symbols.length
        ? symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} :: ${symbol.file}:${symbol.line}:${symbol.character}`).join("\n")
        : "Nenhum simbolo encontrado pelo motor LSP.";
    }

    return "Uso: /lsp [status|symbols]";
  }

  return `Comando desconhecido: ${command}\n\n${slashHelp()}`;
}

module.exports = {
  isRuntimeSlashCommand,
  runSlashCommand,
  slashHelp
};
