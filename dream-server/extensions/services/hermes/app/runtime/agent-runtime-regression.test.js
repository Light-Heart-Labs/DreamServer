const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AgentRuntime } = require("./agent-runtime");
const { DreamRuntime } = require("./core");

function signature(value) {
  return JSON.stringify(value);
}

class FakeRuntime {
  constructor() {
    this.workspaceRoot = path.resolve(process.cwd());
    this.state = {
      settings: {
        desktopBridgeEnabled: true,
        fullAccessMode: true,
        trustMode: "always",
        allowedPermissionClasses: []
      },
      projects: []
    };
    this.mcpManager = {
      getState() {
        return { connected: [] };
      }
    };
    this.pendingBatches = new Map();
    this.events = [];
    this.chats = new Map();
    this.currentRuns = new Map();
    this.stopped = new Set();
    this.executed = [];
    this.recent = new Map();
  }

  addChat(chat) {
    this.chats.set(chat.id, chat);
    return chat;
  }

  getChat(chatId) {
    return this.chats.get(chatId) || null;
  }

  _getLatestVisibleUserText(chat) {
    const message = [...(chat.messages || [])].reverse().find((entry) => entry.kind === "user" && !entry.hidden);
    return message?.content || "";
  }

  _getChatWorkspaceRoot(chat) {
    return chat?.workspaceRoot || this.workspaceRoot;
  }

  _createDraftAssistant(chat) {
    const draft = {
      id: `draft-${crypto.randomUUID()}`,
      kind: "assistant",
      content: "",
      pending: true,
      hidden: false,
      actions: [],
      timestamp: Date.now()
    };
    chat.messages.push(draft);
    return draft;
  }

  _appendAssistantDelta(chat, delta, draft) {
    if (draft) {
      draft.content += String(delta || "");
    }
  }

  _finalizeAssistantMessage(chat, draft, content, actions = []) {
    const message = draft || {
      id: `msg-${crypto.randomUUID()}`,
      kind: "assistant",
      timestamp: Date.now()
    };
    message.kind = "assistant";
    message.content = String(content || "");
    message.pending = false;
    message.hidden = false;
    message.actions = Array.isArray(actions) ? actions : [];
    if (!draft) {
      chat.messages.push(message);
    }
    this._emitRuntimeEvent(chat.id, {
      type: "message_final",
      content: message.content
    });
    return message;
  }

  _quietDraft(chat, draft) {
    if (draft) {
      draft.pending = false;
      draft.hidden = true;
    }
  }

  _setChatStatus(chat, status, meta = {}) {
    chat.status = status;
    chat.statusMeta = meta;
    chat.updatedAt = Date.now();
  }

  _emitRuntimeEvent(chatId, event) {
    this.events.push({ chatId, ...event });
  }

  _sanitizeBatchActions(actions = []) {
    return Array.isArray(actions)
      ? actions.filter((action) => action && typeof action === "object").map((action) => ({ ...action }))
      : [];
  }

  _batchSignature(actions = []) {
    return signature(actions);
  }

  _registerLoopGuard(chatId, batchSignature, chainDepth) {
    if (chainDepth >= 8) {
      return { ok: false, reason: "chain limit" };
    }
    return { ok: true };
  }

  _hasSuccessfulActionAlready(chatId, runId, action) {
    const actionSignature = signature(action);
    return this.executed.find(
      (entry) => entry.chatId === chatId && entry.runId === runId && entry.ok && entry.signature === actionSignature
    );
  }

  _wasRecentlyExecuted(chatId, action) {
    return this.recent.get(`${chatId}:${signature(action)}`) || null;
  }

  _recordExecutedAction(chatId, runId, action, ok, result) {
    this.executed.push({
      chatId,
      runId,
      action,
      ok,
      result,
      signature: signature(action)
    });
  }

  _rememberRecentAction(chatId, action, ok, result) {
    if (ok) {
      this.recent.set(`${chatId}:${signature(action)}`, { result });
    }
  }

  _upsertLocalEvent(chat, event) {
    chat.localEvents.push(event);
  }

  _attachController(chatId, controller, runId) {
    this.currentRuns.set(chatId, runId);
    this.controller = controller;
  }

  _finishRun() {}

  _isStopped(chatId) {
    return this.stopped.has(chatId);
  }

  _isCurrentRun(chatId, runId) {
    return this.currentRuns.get(chatId) === runId;
  }

  _bumpRunId(chatId) {
    const runId = `run-${crypto.randomUUID()}`;
    this.currentRuns.set(chatId, runId);
    return runId;
  }

  _clearTurnGuards() {}

  getPublicState() {
    return {};
  }

  markProjectVerification(action, ok, result) {
    this.lastProjectVerification = { action, ok, result };
  }

  findRecentProject() {
    return this.state.projects[0] || null;
  }

  formatProjectMemory() {
    return "";
  }

  _isSelfContainedAction(action) {
    return ["launch_app", "open_url", "open_path", "reveal_path", "set_volume", "set_preview_device", "media_control", "system_query"].includes(
      String(action?.type || "")
    );
  }

  _looksLikeNoOpResult() {
    return false;
  }
}

class ScriptedAgentRuntime extends AgentRuntime {
  constructor(runtime, turns, options = {}) {
    const toolCalls = [];
    super(runtime, {
      ...options,
      executeTool: async (action, context) => {
        toolCalls.push({ action, context });
        if (options.toolHandler) {
          return await options.toolHandler(action, context, toolCalls.length);
        }
        return `${action.type} ok`;
      }
    });
    this.turns = [...turns];
    this.toolCalls = toolCalls;
    this.providerCalls = [];
  }

  async _sendProviderTurn(chat, runState, context = {}) {
    if (!this.turns.length) {
      throw new Error("No scripted provider turn left.");
    }
    this.providerCalls.push({
      inputText: context.inputText || "",
      attachmentPaths: context.attachmentPaths || []
    });
    const turn = this.turns.shift();
    const assistantMessage = this.runtime._finalizeAssistantMessage(
      chat,
      context.draft,
      turn.assistantText || "",
      turn.actions || []
    );
    return {
      assistantText: turn.assistantText || "",
      actions: turn.actions || [],
      status: turn.status || "stopped",
      assistantMessage
    };
  }
}

function createChat({ routeId = "general-purpose", workspaceRoot = process.cwd() } = {}) {
  return {
    id: `chat-${crypto.randomUUID()}`,
    provider: "local",
    status: "idle",
    activeRoute: { id: routeId, label: routeId },
    workspaceRoot,
    messages: [],
    localEvents: [],
    updatedAt: Date.now()
  };
}

async function runScriptedScenario({ userText, turns, routeId, toolHandler, attachmentPaths = [], beforeRun = null }) {
  const runtime = new FakeRuntime();
  const chat = runtime.addChat(createChat({ routeId }));
  const runId = `run-${crypto.randomUUID()}`;
  runtime.currentRuns.set(chat.id, runId);
  chat.messages.push({
    id: `user-${crypto.randomUUID()}`,
    kind: "user",
    content: userText,
    hidden: false,
    pending: false,
    timestamp: Date.now()
  });

  const agent = new ScriptedAgentRuntime(runtime, turns, { toolHandler });
  const payload = {
    chat,
    userText,
    attachmentPaths,
    provider: "local",
    route: chat.activeRoute,
    runId
  };
  if (beforeRun) {
    beforeRun({ runtime, chat, agent, payload });
  }
  await agent.run(payload);
  return { runtime, chat, agent };
}

async function testAnswerOnlyDoesNotDemandTools() {
  const { chat, agent } = await runScriptedScenario({
    userText: "explique closures em javascript",
    routeId: "coding-project",
    turns: [{ assistantText: "Closure e uma funcao que lembra o escopo externo.", actions: [] }]
  });

  assert.equal(agent.toolCalls.length, 0);
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /Closure/);
}

async function testChessNoToolTurnForcesContinuation() {
  const { chat, agent } = await runScriptedScenario({
    userText: "abra o lichess e jogue xadrez contra o computador",
    routeId: "general-purpose",
    turns: [
      { assistantText: "A posicao continua igual. O computador ainda esta pensando.", actions: [] },
      { assistantText: "Partida encerrada por checkmate.", actions: [] }
    ],
    toolHandler: async (action) => {
      assert.equal(action.type, "browser_harness");
      assert.equal(action.command, "chess_wait_turn");
      return "chess_wait_turn ok: playAs=white sideToMove=white agentTurn=yes gameOver=no fen=8/8/8/8/8/8/8/8";
    }
  });

  assert.equal(agent.toolCalls.length, 1);
  assert.equal(agent.providerCalls.length, 2);
  assert.equal(chat.status, "stopped");
}

async function testDirectActionRunsOnceAndFinalizes() {
  const { chat, agent } = await runScriptedScenario({
    userText: "de play na musica",
    turns: [
      {
        assistantText: "Dando play na midia ativa.",
        actions: [{ type: "media_control", action: "play" }]
      }
    ]
  });

  assert.equal(agent.toolCalls.length, 1);
  assert.equal(agent.toolCalls[0].action.type, "media_control");
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /Concluido/);
}

async function testRepairAfterFailureDoesNotRestartFromZero() {
  let verifyAttempts = 0;
  const { chat, agent } = await runScriptedScenario({
    userText: "crie um site e rode localmente",
    turns: [
      {
        assistantText: "Criando e verificando.",
        actions: [
          { type: "write_file", path: "index.html", content: "<div>bad</div>" },
          { type: "verify_site", url: "http://127.0.0.1:4173", expectedFiles: ["index.html"] }
        ]
      },
      {
        assistantText: "Corrigindo o erro observado.",
        actions: [
          { type: "file_edit", path: "index.html", search: "bad", replace: "ok" },
          { type: "verify_site", url: "http://127.0.0.1:4173", expectedFiles: ["index.html"] }
        ]
      }
    ],
    toolHandler: async (action) => {
      if (action.type === "verify_site") {
        verifyAttempts += 1;
        if (verifyAttempts === 1) {
          throw new Error("Browser blank=true console=SyntaxError");
        }
        return "VERIFICATION PASSED Browser blank=false text=ok";
      }
      return `${action.type} ok`;
    }
  });

  const actionTypes = agent.toolCalls.map((entry) => entry.action.type);
  assert.deepEqual(actionTypes, ["write_file", "verify_site", "file_edit", "verify_site"]);
  assert.equal(actionTypes.filter((type) => type === "write_file").length, 1);
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /Projeto verificado|Concluido/);
}

async function testFailedCommandRequiresRepairBeforeFinal() {
  let commandAttempts = 0;
  const { chat, agent } = await runScriptedScenario({
    userText: "crie um arquivo Excel com tabela de mercado",
    turns: [
      {
        assistantText: "Criando a planilha.",
        actions: [
          {
            type: "run_command",
            command: "python",
            args: ["-c", "import openpyxl"]
          }
        ]
      },
      {
        assistantText: "Instalando a dependencia ausente e criando a planilha.",
        actions: [
          {
            type: "run_command",
            command: "python",
            args: ["-m", "pip", "install", "openpyxl"]
          },
          {
            type: "run_command",
            command: "python",
            args: ["-c", "import openpyxl; print('xlsx criado')"]
          },
          {
            type: "verify_file",
            path: "mercado.xlsx"
          }
        ]
      }
    ],
    toolHandler: async (action) => {
      if (action.type === "run_command") {
        commandAttempts += 1;
        if (commandAttempts === 1) {
          throw new Error("Processo falhou com codigo 1.\nModuleNotFoundError: No module named 'openpyxl'");
        }
      }
      return `${action.type} ok`;
    }
  });

  const actionTypes = agent.toolCalls.map((entry) => entry.action.type);
  assert.deepEqual(actionTypes, ["run_command", "run_command", "run_command", "verify_file"]);
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /Concluido|verificado|executada/);
}

async function testDuplicateActionIsBlockedBeforeSecondExecution() {
  const { chat, agent } = await runScriptedScenario({
    userText: "de play duas vezes sem repetir",
    turns: [
      {
        assistantText: "Executando.",
        actions: [
          { type: "media_control", action: "play" },
          { type: "media_control", action: "play" }
        ]
      }
    ]
  });

  assert.equal(agent.toolCalls.length, 1);
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /Repeticao bloqueada/);
}

async function testTooManyActionsAreBlockedBeforeExecution() {
  const actions = Array.from({ length: 13 }, (_, index) => ({
    type: "launch_app",
    app: `app-${index}`
  }));
  const { chat, agent } = await runScriptedScenario({
    userText: "abra muitos apps",
    turns: [{ assistantText: "Abrindo apps.", actions }]
  });

  assert.equal(agent.toolCalls.length, 0);
  assert.equal(chat.status, "stopped");
  assert.match(chat.messages.at(-1).content, /limite/i);
}

async function testInvalidToolContractGetsRepairTurn() {
  const { chat, agent } = await runScriptedScenario({
    userText: "abra a pasta do projeto",
    turns: [
      {
        assistantText: "Abrindo.",
        actions: [{ type: "open_path", path: "" }]
      },
      {
        assistantText: "Corrigindo com caminho concreto.",
        actions: [{ type: "open_path", path: "C:\\Users\\Gabriel\\Documents\\DreamServerProjects\\snake" }]
      }
    ]
  });

  assert.equal(agent.toolCalls.length, 1);
  assert.equal(agent.toolCalls[0].action.type, "open_path");
  assert.equal(chat.status, "stopped");
}

async function testAttachmentsReachProviderWithoutToolHeuristics() {
  const attachmentPaths = [
    "C:\\Users\\Gabriel\\Pictures\\Screenshots\\example.png",
    "C:\\Users\\Gabriel\\Downloads\\documento.pdf"
  ];
  const { agent } = await runScriptedScenario({
    userText: "analise estes anexos",
    attachmentPaths,
    turns: [{ assistantText: "Recebi os anexos para analise.", actions: [] }]
  });

  assert.deepEqual(agent.providerCalls[0].attachmentPaths, attachmentPaths);
  assert.equal(agent.toolCalls.length, 0);
}

async function testStopBeforeExecutionDoesNotRunProviderOrTools() {
  const { chat, agent } = await runScriptedScenario({
    userText: "abra qualquer coisa",
    turns: [{ assistantText: "Abrindo.", actions: [{ type: "launch_app", app: "notepad" }] }],
    beforeRun: ({ runtime, chat }) => {
      runtime.stopped.add(chat.id);
    }
  });

  assert.equal(agent.providerCalls.length, 0);
  assert.equal(agent.toolCalls.length, 0);
  assert.equal(chat.status, "stopped");
}

async function testManualPermissionDoesNotLeaveChatRunning() {
  const { runtime, chat, agent } = await runScriptedScenario({
    userText: "crie uma calculadora em html",
    turns: [{ assistantText: "Vou criar uma calculadora.", actions: [{ type: "launch_app", app: "notepad" }] }],
    beforeRun: ({ runtime }) => {
      runtime.state.settings.fullAccessMode = false;
      runtime.state.settings.trustMode = "ask";
    }
  });

  assert.equal(agent.toolCalls.length, 0);
  assert.equal(chat.status, "stopped");
  assert.equal(chat.statusMeta.reason, "awaiting_permission");
  assert.equal(runtime.pendingBatches.size, 1);
  assert(runtime.events.some((event) => event.type === "permission_request"));
}

async function testProjectContextResolvesCurrentProjectPath() {
  const runtime = new DreamRuntime({
    workspaceRoot: "C:\\Users\\Gabriel\\Documents\\Playground\\manus-desktop"
  });
  const chat = {
    id: "chat-context",
    messages: [],
    localEvents: [],
    status: "idle",
    provider: "local"
  };
  runtime.state.chats.push(chat);
  const projectPath = "C:\\Users\\Gabriel\\Documents\\DreamServerProjects\\snake";
  runtime.upsertProjectRecord({
    name: "snake",
    slug: "snake",
    path: projectPath,
    chatId: chat.id,
    runId: "run-context"
  });

  assert.equal(chat.workspaceRoot, projectPath);
  assert.equal(
    runtime.resolveContextualPath({
      rawPath: "onde esta esse projeto",
      chatId: chat.id,
      runId: "run-context",
      workspaceRoot: "C:\\Users\\Gabriel\\Documents\\Playground\\manus-desktop"
    }),
    projectPath
  );
}

async function testAgentSpawnLinksExistingKanbanTask() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-kanban-agent-"));
  const runtime = new DreamRuntime({ workspaceRoot, disableTaskTerminals: true });
  runtime.state.settings.fullAccessMode = true;
  runtime._prepareAgentWorkspace = async () => ({
    workspaceRoot,
    worktreePath: "",
    worktreeBranch: "",
    warning: ""
  });
  runtime.sendMessage = async ({ chatId }) => {
    const chat = runtime.getChat(chatId);
    chat.messages.push({
      id: `msg-${crypto.randomUUID()}`,
      kind: "assistant",
      content: "Implementation ready for review.",
      timestamp: Date.now()
    });
    runtime._setChatStatus(chat, "stopped", { reason: "test" });
    return runtime.getPublicState();
  };

  const task = runtime.createTaskRecord({
    title: "Kanban task",
    objective: "Implement queue execution",
    status: "pending"
  });
  const agent = await runtime.spawnAgent({
    taskId: task.id,
    name: task.title,
    objective: task.objective,
    provider: "local",
    useWorktree: false
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime.state.tasks.length, 1);
  const updatedTask = runtime.getTaskRecord(task.id);
  const hiddenChat = runtime.getChat(agent.chatId);
  assert.equal(updatedTask.agentId, agent.id);
  assert.equal(updatedTask.status, "ai_review");
  assert.match(updatedTask.result, /Implementation ready/);
  assert.equal(hiddenChat.taskId, task.id);
}

async function testRecoveredDirectActionReturnsUpdatedState() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-direct-action-"));
  const runtime = new DreamRuntime({ workspaceRoot, disableTaskTerminals: true });
  runtime.state.settings.fullAccessMode = true;
  runtime.createChat("local");
  const chat = runtime.state.chats[0];
  const task = runtime.createTaskRecord({
    title: "Direct action task",
    objective: "Validate direct action state",
    status: "backlog"
  });

  const state = await runtime.runSuggestedAction({
    chatId: chat.id,
    actionKey: `manual-${crypto.randomUUID()}:0`,
    action: {
      type: "task_update",
      id: task.id,
      status: "in_progress"
    }
  });
  const updatedTask = state.tasks.find((entry) => entry.id === task.id);
  assert.equal(updatedTask.status, "in_progress");
}

async function testRecoveredAgentSpawnReturnsInProgressTask() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-direct-agent-"));
  const runtime = new DreamRuntime({ workspaceRoot, disableTaskTerminals: true });
  runtime.state.settings.fullAccessMode = true;
  runtime._prepareAgentWorkspace = async () => ({
    workspaceRoot,
    worktreePath: "",
    worktreeBranch: "",
    warning: ""
  });
  runtime.sendMessage = async () => runtime.getPublicState();
  runtime.createChat("local");
  const chat = runtime.state.chats[0];
  const task = runtime.createTaskRecord({
    title: "Open calculator",
    objective: "Abra a calculadora do Windows",
    status: "backlog"
  });

  const state = await runtime.runSuggestedAction({
    chatId: chat.id,
    actionKey: `manual-${crypto.randomUUID()}:0`,
    action: {
      type: "agent_spawn",
      taskId: task.id,
      name: task.title,
      objective: task.objective,
      provider: "local",
      useWorktree: false
    }
  });
  const updatedTask = state.tasks.find((entry) => entry.id === task.id);
  assert.equal(updatedTask.status, "in_progress");
  assert(updatedTask.agentId);
}

async function testHermesToolEventsPopulateWorkbenchArtifacts() {
  const runtime = new FakeRuntime();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-hermes-artifacts-"));
  const chat = runtime.addChat(createChat({ routeId: "coding-project", workspaceRoot }));
  const runId = `run-${crypto.randomUUID()}`;
  runtime.currentRuns.set(chat.id, runId);

  const agent = new AgentRuntime(runtime);
  const runState = agent.createRunState({
    chat,
    userText: "crie um html",
    runId,
    provider: "local",
    route: chat.activeRoute
  });

  agent._ingestHermesToolEvents(chat, runState, [
    {
      type: "tool_complete",
      id: "tool-1",
      name: "write_file",
      args: {
        path: "dino.html",
        content: "<!doctype html><html><body>Dino</body></html>"
      },
      result: JSON.stringify({ path: "dino.html", bytes: 43 })
    },
    {
      type: "tool_complete",
      id: "tool-2",
      name: "browser_navigate",
      args: {
        url: "http://127.0.0.1:4173"
      },
      result: JSON.stringify({ status: "ok", url: "http://127.0.0.1:4173" })
    },
    {
      type: "tool_complete",
      id: "tool-3",
      name: "browser_snapshot",
      args: {},
      result: JSON.stringify({
        status: "ok",
        url: "http://127.0.0.1:4173",
        screenshot_path: "browser-shot.png"
      })
    },
    {
      type: "tool_complete",
      id: "tool-4",
      name: "todo",
      args: {
        todos: [{ title: "Criar preview", status: "done" }]
      },
      result: JSON.stringify({ status: "ok", todos: [{ title: "Criar preview", status: "done" }] })
    },
    {
      type: "tool_complete",
      id: "tool-5",
      name: "made_up_tool",
      args: {
        value: 1
      },
      result: JSON.stringify({ status: "ok", artifact_path: "artifact.json" })
    }
  ]);

  assert.equal(chat.localEvents.length, 5);
  assert.equal(chat.localEvents[0].action.type, "write_file");
  assert.match(chat.localEvents[0].action.path, /dino\.html$/);
  assert.match(chat.localEvents[0].action.content, /Dino/);
  assert.equal(chat.localEvents[1].action.type, "browser_control");
  assert.equal(chat.localEvents[1].action.url, "http://127.0.0.1:4173");
  assert.equal(chat.localEvents[2].action.type, "browser_check");
  assert.match(chat.localEvents[2].action.screenshotPath, /browser-shot\.png$/);
  assert.equal(chat.localEvents[3].action.type, "todo_write");
  assert.equal(chat.localEvents[4].action.type, "hermes_tool");
  assert.equal(chat.localEvents[4].action.tool, "made_up_tool");
  assert(runState.evidence.some((entry) => entry.kind === "file" && entry.ok));
  assert(runState.evidence.some((entry) => entry.kind === "browser" && entry.ok));
  assert(runState.evidence.some((entry) => entry.kind === "task" && entry.ok));
  assert(runState.evidence.some((entry) => entry.kind === "tool" && entry.ok));
}

async function main() {
  const tests = [
    testAnswerOnlyDoesNotDemandTools,
    testChessNoToolTurnForcesContinuation,
    testDirectActionRunsOnceAndFinalizes,
    testRepairAfterFailureDoesNotRestartFromZero,
    testFailedCommandRequiresRepairBeforeFinal,
    testDuplicateActionIsBlockedBeforeSecondExecution,
    testTooManyActionsAreBlockedBeforeExecution,
    testInvalidToolContractGetsRepairTurn,
    testAttachmentsReachProviderWithoutToolHeuristics,
    testStopBeforeExecutionDoesNotRunProviderOrTools,
    testManualPermissionDoesNotLeaveChatRunning,
    testProjectContextResolvesCurrentProjectPath,
    testAgentSpawnLinksExistingKanbanTask,
    testRecoveredDirectActionReturnsUpdatedState,
    testRecoveredAgentSpawnReturnsInProgressTask,
    testHermesToolEventsPopulateWorkbenchArtifacts
  ];

  for (const test of tests) {
    await test();
    console.log(`ok - ${test.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
