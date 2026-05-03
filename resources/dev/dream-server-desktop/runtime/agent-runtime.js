const fs = require("fs");
const os = require("os");
const path = require("path");
const { fileURLToPath } = require("url");
const { normalizeLocalEvent } = require("./state");
const {
  createLocalEvent,
  executeTool,
  isPermissionAutoAllowed,
  makeActionLabel,
  normalizePathText,
  normalizeToolResult,
  permissionClassForAction
} = require("./tools");
const { sendLocalExecutionResult, sendManusTurn } = require("./providers/manus");
const { resolveHermesRoutingSettings, sendHermesTurn } = require("./providers/hermes");
const { ToolRuntime } = require("./platform/tool-runtime");
const { AgentTranscript } = require("./platform/transcript");

const MAX_ACTIONS_PER_BATCH = 12;
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_MAX_TOOL_BATCHES = 6;
const MAX_INGESTED_FILE_CHARS = 512 * 1024;
const FINAL_PHASES = new Set(["final", "stopped", "blocked"]);
const SITE_RELATED_TOOL_TYPES = new Set([
  "project_prepare_vite",
  "verify_site",
  "browser_check",
  "browser_control",
  "verify_browser_console",
  "background_command_start",
  "background_command_logs"
]);

function hermesRouteNeedsManagedLocalLlama(settings = {}) {
  const route = resolveHermesRoutingSettings(settings);
  if (route.provider === "custom" || route.provider === "lmstudio") {
    return true;
  }
  if (route.provider !== "auto") {
    return false;
  }
  return /^(https?:\/\/)?(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    String(route.baseUrl || "")
  );
}

function looksLikeChessObjective(value = "") {
  return /\b(lichess|xadrez|chess|tabuleiro|browser_chess)\b/i.test(String(value || ""));
}

function isChessRunState(runState, chat = null) {
  return looksLikeChessObjective([
    runState?.objective,
    chat?.title,
    ...(Array.isArray(chat?.messages) ? chat.messages.slice(-6).map((message) => message?.content || "") : []),
    ...(Array.isArray(runState?.lastActions) ? runState.lastActions.map((action) => `${action?.type || ""}:${action?.command || ""}`) : [])
  ].join("\n"));
}

function looksLikeChessGameEnded(value = "") {
  return /\b(checkmate|xeque-mate|stalemate|game over|resigned|partida encerrad[ao]s?|partida terminad[ao]s?|jogo encerrad[ao]|jogo terminad[ao]|vitoria|vit[oó]ria|derrota)\b/i.test(String(value || ""));
}

function wantsChessWait(value = "") {
  return /\b(aguard|esper|waiting|wait|opponent|oponente|advers[aá]rio|computador|stockfish|proximo lance|pr[oó]xima jogada|next move|pensando)\b/i.test(String(value || ""));
}

function isChessHarnessAction(action = {}) {
  return String(action?.type || "") === "browser_harness" && /^chess_/.test(String(action?.command || ""));
}

function isChessObservationAction(action = {}) {
  const command = String(action?.command || "");
  return String(action?.type || "") === "browser_harness" && (command === "chess_state" || command === "chess_wait_turn");
}

function forcedChessContinuationAction(assistantText = "", runState = null) {
  const wait = wantsChessWait(assistantText);
  return {
    type: "browser_harness",
    command: wait ? "chess_wait_turn" : "chess_state",
    timeoutMs: wait ? 30000 : 10000,
    reason: "runtime_chess_continuation",
    runtimeChessContinuation: Number(runState?.iteration || 0)
  };
}

class AgentRuntime {
  constructor(runtime, options = {}) {
    this.runtime = runtime;
    this.executeTool = options.executeTool || executeTool;
    this.createLocalEvent = options.createLocalEvent || createLocalEvent;
    this.maxIterations = Number.isFinite(Number(options.maxIterations))
      ? Number(options.maxIterations)
      : DEFAULT_MAX_ITERATIONS;
    this.maxToolBatches = Number.isFinite(Number(options.maxToolBatches))
      ? Number(options.maxToolBatches)
      : DEFAULT_MAX_TOOL_BATCHES;
    this.toolRuntime = options.toolRuntime || new ToolRuntime({
      executeTool: this.executeTool,
      registry: options.toolRegistry
    });
  }

  createRunState(payload = {}) {
    const chat = payload.chat;
    const objective = String(payload.userText || this.runtime._getLatestVisibleUserText(chat) || "").trim();
    const chessObjective = looksLikeChessObjective([
      objective,
      chat?.title,
      ...(Array.isArray(chat?.messages) ? chat.messages.slice(-4).map((message) => message?.content || "") : [])
    ].join("\n"));
    return {
      runId: payload.runId,
      chatId: chat?.id || "",
      objective,
      routeId: payload.route?.id || chat?.activeRoute?.id || "general-purpose",
      workspaceRoot: this.runtime._getChatWorkspaceRoot(chat),
      provider: payload.provider || chat?.provider || "cloud",
      phase: "plan",
      iteration: 0,
      toolBatchCount: 0,
      maxIterations: chessObjective ? Math.max(this.maxIterations, 80) : this.maxIterations,
      maxToolBatches: chessObjective ? Math.max(this.maxToolBatches, 80) : this.maxToolBatches,
      lastActions: [],
      lastResults: [],
      evidence: [],
      automaticVerifications: new Set(),
      noActionRepairCount: 0,
      invalidActionRepairCount: 0,
      blockedReason: "",
      direct: false,
      transcript: new AgentTranscript()
    };
  }

  async run(payload = {}) {
    const chat = payload.chat;
    const runState = this.createRunState(payload);
    try {
      await this._runWithState(chat, runState, payload);
    } finally {
      this.runtime._finishRun(chat.id, payload.runId);
    }
  }

  async _runWithState(chat, runState, payload) {
    if (this._isAborted(chat, runState)) {
      this._stop(chat, runState, "aborted");
      return;
    }

    this._setPhase(runState, "plan", "Solicitando ao provider o proximo passo operacional.");

    await this.runProviderTurn(chat, {
      userText: payload.userText || runState.objective,
      attachmentPaths: payload.attachmentPaths || [],
      userMessageId: payload.userMessageId,
      cloudApiKey: payload.cloudApiKey,
      signal: payload.signal,
      chainDepth: 0,
      runId: payload.runId,
      runState
    });
  }

  async _runDirectPlan(chat, runState, directPlan, payload) {
    runState.direct = true;
    this._setPhase(runState, "plan", "Acao direta mapeada para uma ferramenta.");

    const userMessage = chat.messages.find((message) => message.id === payload.userMessageId);
    if (userMessage) {
      userMessage.pending = false;
    }

    if (directPlan.workspaceRoot) {
      chat.workspaceRoot = String(directPlan.workspaceRoot);
      runState.workspaceRoot = this.runtime._getChatWorkspaceRoot(chat);
    }

    const assistantMessage = this.runtime._finalizeAssistantMessage(
      chat,
      null,
      directPlan.body,
      directPlan.actions
    );

    if (!assistantMessage.actions.length) {
      this._setPhase(runState, "final", "Acao direta concluida sem ferramentas.");
      this.runtime._setChatStatus(chat, "stopped", {
        provider: chat.provider
      });
      return;
    }

    await this.registerOrRunBatch(chat, assistantMessage, {
      provider: chat.provider,
      cloudApiKey: payload.cloudApiKey,
      signal: payload.signal,
      chainDepth: 0,
      runId: payload.runId,
      runState,
      continueAfterExecution: directPlan.continueAfterExecution
    });
  }

  async runProviderTurn(chat, context = {}) {
    const runState = context.runState || this.createRunState({
      chat,
      userText: context.userText,
      runId: context.runId,
      provider: chat.provider,
      route: chat.activeRoute
    });

    if (this._isAborted(chat, runState)) {
      this._stop(chat, runState, "aborted");
      return;
    }

    if (runState.iteration >= runState.maxIterations) {
      this._block(chat, runState, `O agente atingiu o limite de ${runState.maxIterations} iteracoes nesta tarefa.`);
      return;
    }

    runState.iteration += 1;
    const inputText = String(context.userText || "").trim();
    const phase = runState.lastResults.some((entry) => !entry.ok) ? "repair" : "plan";
    this._setPhase(
      runState,
      phase,
      phase === "repair"
        ? "Reparando a partir do ultimo erro observado."
        : "Pedindo ao provider o proximo passo concreto."
    );

    const draft = this.runtime._createDraftAssistant(chat);
    try {
      const turn = await this._sendProviderTurn(chat, runState, {
        inputText,
        attachmentPaths: context.attachmentPaths || [],
        userMessageId: context.userMessageId,
        cloudApiKey: context.cloudApiKey,
        signal: context.signal,
        draft
      });

      if (this._isAborted(chat, runState)) {
        this.runtime._quietDraft(chat, draft);
        this._stop(chat, runState, "aborted");
        return;
      }

      const assistantMessage = turn.assistantMessage;
      const actions = Array.isArray(assistantMessage?.actions) ? assistantMessage.actions : [];
      if (actions.length) {
        await this.registerOrRunBatch(chat, assistantMessage, {
          provider: chat.provider,
          cloudApiKey: context.cloudApiKey,
          signal: context.signal,
          chainDepth: Number(context.chainDepth || 0),
          runId: context.runId,
          runState
        });
        return;
      }

      if (isChessRunState(runState, chat) && !looksLikeChessGameEnded(turn.assistantText || "")) {
        const forcedAction = forcedChessContinuationAction(turn.assistantText || "", runState);
        assistantMessage.actions = [forcedAction];
        assistantMessage.runtimeGeneratedAction = "chess_continuation";
        runState.transcript?.tool?.("browser_harness", `Forcando continuidade de xadrez sem escolher lance: ${forcedAction.command}.`);
        await this.registerOrRunBatch(chat, assistantMessage, {
          provider: chat.provider,
          cloudApiKey: context.cloudApiKey,
          signal: context.signal,
          chainDepth: Number(context.chainDepth || 0),
          runId: context.runId,
          runState,
          continueAfterExecution: true
        });
        return;
      }

      if (!turn.selfContained && this._needsMoreEvidence(runState, chat)) {
        const repaired = await this._repairMissingProviderActions(chat, runState, {
          ...context,
          assistantText: turn.assistantText || "",
          reason:
            "O provider respondeu sem ferramentas, mas o objetivo exige evidencia concreta de execucao/verificacao.",
          invalidReasons: []
        });
        if (!repaired) {
          this._block(
            chat,
            runState,
            "O provider respondeu sem acoes validas e nao conseguiu reparar o proximo passo operacional.",
            "invalid_batch"
          );
        }
        return;
      }

      this._setPhase(runState, "final", "Resposta final aceita pelo runtime.");
      this.runtime._setChatStatus(
        chat,
        String(turn.status || "stopped").toLowerCase() === "running" ? "running" : "stopped",
        {
          provider: chat.provider,
          taskId: chat.taskId
        }
      );
    } catch (error) {
      if (context.signal?.aborted) {
        this.runtime._quietDraft(chat, draft);
        this._stop(chat, runState, "aborted");
        return;
      }
      if (draft) {
        draft.pending = false;
        if (!String(draft.content || "").trim()) {
          draft.content = `Falha ao executar o provider: ${error.message || "erro desconhecido"}`;
        }
      }
      chat.status = "error";
      chat.updatedAt = Date.now();
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "message_final",
        messageId: draft?.id,
        actions: [],
        content: draft?.content || `Falha ao executar o provider: ${error.message || "erro desconhecido"}`
      });
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "error",
        message: error.message || "Falha ao executar a sessao."
      });
    }
  }

  async _sendProviderTurn(chat, runState, context = {}) {
    const provider = String(chat.provider || runState.provider || "cloud").toLowerCase() === "local" ? "local" : "cloud";
    if (provider === "local") {
      const visibleUserMessage = chat.messages.find((message) => message.id === context.userMessageId);
      if (visibleUserMessage) {
        visibleUserMessage.pending = false;
      }

      const useHermes = String(this.runtime.state.settings.agentBackend || "hermes").toLowerCase() === "hermes";
      let result = null;
      if (useHermes) {
        if (
          this.runtime.state.settings.localLlamaEnabled &&
          this.runtime.state.settings.localLlamaAutoStart &&
          hermesRouteNeedsManagedLocalLlama(this.runtime.state.settings) &&
          typeof this.runtime.ensureManagedLocalLlama === "function"
        ) {
          await this.runtime.ensureManagedLocalLlama({
            reason: "provider_turn",
            signal: context.signal
          });
        }
        result = await sendHermesTurn({
          chat,
          settings: this.runtime.state.settings,
          userText: context.inputText || "",
          attachmentPaths: context.attachmentPaths || [],
          route: chat.activeRoute,
          signal: context.signal,
          onTextDelta: (delta) => this.runtime._appendAssistantDelta(chat, delta, context.draft),
          onEvent: (event) => this.runtime._emitRuntimeEvent(chat.id, event)
        });
      } else {
        throw new Error(
          "Backend local legado desativado nesta build. Configure agentBackend=hermes para usar o Hermes Agent como cérebro único."
        );
      }
      this._ingestHermesToolEvents(chat, runState, result?.hermes?.events || []);

      const assistantMessage = this.runtime._finalizeAssistantMessage(
        chat,
        context.draft,
        result.assistantText,
        result.actions
      );
      runState.transcript?.provider("assistant", result.assistantText || "");

      return {
        assistantText: result.assistantText || "",
        actions: result.actions || [],
        status: result.status || "stopped",
        selfContained: Boolean(result.selfContained),
        assistantMessage
      };
    }

    const result = await sendManusTurn({
      apiKey: context.cloudApiKey,
      chat,
      settings: this.runtime.state.settings,
      text: context.inputText || "",
      attachmentPaths: context.attachmentPaths || [],
      route: chat.activeRoute,
      mcpState: this.runtime.mcpManager.getState(),
      projectMemory: this.runtime.formatProjectMemory(context.inputText || runState.objective || ""),
      signal: context.signal,
      onAssistantDelta: (delta) => this.runtime._appendAssistantDelta(chat, delta, context.draft)
    });

    const finalAssistant =
      [...chat.messages].reverse().find((message) => message.kind === "assistant" && !message.pending) || null;
    if (context.draft && context.draft.pending) {
      if (finalAssistant) {
        context.draft.pending = false;
        context.draft.content = finalAssistant.content;
        context.draft.actions = finalAssistant.actions || [];
      } else {
        context.draft.pending = false;
        context.draft.content = context.draft.content || "";
        context.draft.actions = [];
      }
    }

    const assistantMessage = finalAssistant || context.draft;
    runState.transcript?.provider("assistant", assistantMessage?.content || "");
    return {
      assistantText: assistantMessage?.content || "",
      actions: assistantMessage?.actions || [],
      status: result.status,
      assistantMessage
    };
  }

  async registerOrRunBatch(chat, message, context = {}) {
    const runState = context.runState || this.createRunState({
      chat,
      userText: this.runtime._getLatestVisibleUserText(chat),
      runId: context.runId,
      provider: context.provider || chat.provider,
      route: chat.activeRoute
    });
    const workspaceRoot = this.runtime._getChatWorkspaceRoot(chat);
    const rawActions = Array.isArray(message.actions) ? message.actions : [];
    const actions = this.runtime
      ._sanitizeBatchActions(rawActions)
      .map((action) => this._linkActionToTask(action, chat))
      .filter((action) => action && typeof action === "object" && String(action.type || "").trim());

    message.actions = actions;
    if (!actions.length) {
      const repaired = await this._repairMissingProviderActions(chat, runState, {
        ...context,
        assistantText: message.content || "",
        reason: rawActions.length
          ? "O provider retornou ferramentas sem contrato executavel."
          : "O provider nao retornou ferramentas executaveis.",
        invalidReasons: rawActions.length
          ? ["Cada ferramenta precisa ser um objeto com type e argumentos estruturados."]
          : []
      });
      if (!repaired) {
        this._block(
          chat,
          runState,
          rawActions.length
            ? "O provider retornou ferramentas sem contrato executavel."
            : "O provider nao retornou nenhuma ferramenta executavel para o objetivo atual.",
          "invalid_batch"
        );
      }
      return;
    }

    const batchValidation = this._validateActionBatchContract(actions);
    if (!batchValidation.ok) {
      const repaired = await this._repairMissingProviderActions(chat, runState, {
        ...context,
        assistantText: message.content || "",
        reason: "O lote de ferramentas nao passou no contrato operacional.",
        invalidReasons: [batchValidation.reason]
      });
      if (!repaired) {
        this._block(chat, runState, batchValidation.reason, "invalid_batch");
      }
      return;
    }

    if (this._isAborted(chat, runState)) {
      this._stop(chat, runState, "aborted");
      return;
    }

    if (actions.length > MAX_ACTIONS_PER_BATCH) {
      this._block(
        chat,
        runState,
        `O agente tentou executar ${actions.length} acoes de uma vez. O limite desta build e ${MAX_ACTIONS_PER_BATCH}.`,
        "loop_guard"
      );
      return;
    }

    if (runState.toolBatchCount >= runState.maxToolBatches) {
      this._block(
        chat,
        runState,
        `O agente atingiu o limite de ${runState.maxToolBatches} lotes de ferramentas nesta tarefa.`,
        "loop_guard"
      );
      return;
    }

    const loopGuard = this.runtime._registerLoopGuard(
      chat.id,
      this.runtime._batchSignature(actions),
      Number(context.chainDepth || 0)
    );
    if (!loopGuard.ok) {
      this._block(chat, runState, loopGuard.reason, "loop_guard");
      return;
    }

    runState.toolBatchCount += 1;
    runState.lastActions = actions;

    const batch = {
      messageId: message.id,
      chatId: chat.id,
      provider: context.provider || chat.provider,
      actions,
      cloudApiKey: context.cloudApiKey,
      chainDepth: Number(context.chainDepth || 0),
      runId: context.runId || runState.runId,
      runState,
      executing: false,
      continueAfterExecution:
        typeof context.continueAfterExecution === "undefined" ? true : context.continueAfterExecution
    };
    this.runtime.pendingBatches.set(message.id, batch);

    this._setPhase(runState, "act", `Executando ${actions.length} ferramenta(s).`);
    for (const [index, action] of actions.entries()) {
      const actionKey = `${message.id}:${index}`;
      const permissionClass = permissionClassForAction(action, {
        workspaceRoot
      });
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "tool_call_started",
        actionKey,
        action,
        permissionClass
      });
    }

    const shouldAutoRun =
      this.runtime.state.settings.desktopBridgeEnabled &&
      this.runtime.state.settings.fullAccessMode &&
      !actions.some((action) => action?.type === "run_command" && action?.wait === false) &&
      actions.every((action) =>
        isPermissionAutoAllowed(
          permissionClassForAction(action, { workspaceRoot }),
          this.runtime.state.settings
        )
      );

    if (!shouldAutoRun) {
      const firstAction = actions[0];
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "permission_request",
        requestId: `${message.id}:batch`,
        action: firstAction,
        permissionClass: permissionClassForAction(firstAction, {
          workspaceRoot
        })
      });
      this._setPhase(runState, "stopped", "Aguardando aprovacao manual para executar a acao sugerida.");
      this.runtime._setChatStatus(chat, "stopped", {
        provider: chat.provider,
        reason: "awaiting_permission",
        pendingActionCount: actions.length
      });
      return;
    }

    await this.executeBatch(batch);
  }

  _validateActionBatchContract(actions = []) {
    if (!Array.isArray(actions) || !actions.length) {
      return { ok: false, reason: "Nenhuma ferramenta executavel foi retornada." };
    }

    for (const action of actions) {
      const type = String(action?.type || "").trim();
      if (!type) {
        return { ok: false, reason: "Ferramenta sem campo type." };
      }

      const label = makeActionLabel(action);
      if (["open_url", "verify_url", "verify_site", "browser_check"].includes(type) && !String(action.url || "").trim()) {
        return { ok: false, reason: `${label}: campo url obrigatorio.` };
      }
      if (["open_path", "reveal_path"].includes(type) && !String(action.path || "").trim()) {
        return { ok: false, reason: `${label}: campo path obrigatorio.` };
      }
      if (["read_file", "write_file", "append_file", "file_edit", "verify_file"].includes(type) && !String(action.path || "").trim()) {
        return { ok: false, reason: `${label}: campo path obrigatorio.` };
      }
      if (type === "apply_patch" && !String(action.patch || "").trim()) {
        return { ok: false, reason: `${label}: campo patch obrigatorio.` };
      }
      if (["run_command", "verify_command"].includes(type) && !String(action.command || "").trim()) {
        return { ok: false, reason: `${label}: campo command obrigatorio.` };
      }
      if (["terminal_exec", "terminal_close"].includes(type) && !String(action.session || action.sessionId || action.name || "").trim()) {
        return { ok: false, reason: `${label}: sessionId/name obrigatorio.` };
      }
      if (["background_command_logs", "background_command_stop"].includes(type) && !String(action.jobId || action.name || "").trim()) {
        return { ok: false, reason: `${label}: jobId/name obrigatorio.` };
      }
    }

    return { ok: true };
  }

  async runSuggestedAction(options = {}) {
    const messageId = String(options.actionKey || "").split(":")[0];
    const batch = this.runtime.pendingBatches.get(messageId);
    if (!batch) {
      const recoveredBatch = this._recoverSuggestedActionBatch(options);
      if (!recoveredBatch) {
        throw new Error("Acao sugerida nao encontrada.");
      }
      await this.executeBatch(recoveredBatch).finally(() => {
        this.runtime._finishRun(recoveredBatch.chatId, recoveredBatch.runId);
      });
      return this.runtime.getPublicState({ hasCloudApiKey: Boolean(options.cloudApiKey) });
    }
    if (batch.executing) {
      return this.runtime.getPublicState({ hasCloudApiKey: Boolean(options.cloudApiKey) });
    }
    if (this.runtime._isStopped(batch.chatId) || !this.runtime._isCurrentRun(batch.chatId, batch.runId)) {
      this.runtime.pendingBatches.delete(messageId);
      throw new Error("Essa acao pertence a uma execucao antiga e nao pode mais ser retomada.");
    }

    void this.executeBatch(batch).finally(() => {
      this.runtime._finishRun(batch.chatId, batch.runId);
    });
    return this.runtime.getPublicState({ hasCloudApiKey: Boolean(options.cloudApiKey) });
  }

  _recoverSuggestedActionBatch(options = {}) {
    const chat = this.runtime.getChat(options.chatId);
    if (!chat) {
      return null;
    }

    const actionKey = String(options.actionKey || "").trim();
    const [messageId, indexText] = actionKey.split(":");
    const index = Number(indexText);
    const sourceMessage = messageId
      ? (chat.messages || []).find((message) => message.id === messageId)
      : null;
    const sourceAction = Number.isInteger(index)
      ? sourceMessage?.actions?.[index]
      : null;
    const action = sourceAction || (options.action && typeof options.action === "object" ? options.action : null);
    if (!action || typeof action !== "object" || !String(action.type || "").trim()) {
      return null;
    }

    const runId = this.runtime._bumpRunId(chat.id);
    this.runtime._clearTurnGuards(chat.id);
    const runState = this.createRunState({
      chat,
      userText: this.runtime._getLatestVisibleUserText(chat),
      runId,
      provider: chat.provider,
      route: chat.activeRoute
    });
    runState.direct = true;

    return {
      messageId: messageId || `manual-${Date.now()}`,
      chatId: chat.id,
      provider: chat.provider,
      actions: [action],
      actionKeys: [actionKey || `${messageId || "manual"}:0`],
      cloudApiKey: options.cloudApiKey,
      chainDepth: 0,
      runId,
      runState,
      executing: false,
      continueAfterExecution: false,
      recovered: true
    };
  }

  async executeBatch(batch) {
    const chat = this.runtime.getChat(batch.chatId);
    const runState = batch.runState || this.createRunState({
      chat,
      userText: this.runtime._getLatestVisibleUserText(chat),
      runId: batch.runId,
      provider: batch.provider,
      route: chat.activeRoute
    });
    const workspaceRoot = this.runtime._getChatWorkspaceRoot(chat);

    if (batch.executing) {
      return;
    }
    if (this._isAborted(chat, runState)) {
      this.runtime.pendingBatches.delete(batch.messageId);
      this._stop(chat, runState, "aborted");
      return;
    }

    batch.executing = true;
    this._setPhase(runState, "act", `Executando lote ${runState.toolBatchCount}.`);
    this.runtime._setChatStatus(chat, "running", {
      provider: chat.provider
    });

    const controller = new AbortController();
    this.runtime._attachController(chat.id, controller, batch.runId);

    const results = [];
    for (const [index, originalAction] of batch.actions.entries()) {
      if (this._isAborted(chat, runState)) {
        break;
      }

      const action = this._linkActionToTask(originalAction, chat);
      batch.actions[index] = action;
      const actionKey = Array.isArray(batch.actionKeys) && batch.actionKeys[index]
        ? batch.actionKeys[index]
        : `${batch.messageId}:${index}`;
      const permissionClass = permissionClassForAction(action, {
        workspaceRoot
      });

      this.runtime._emitRuntimeEvent(chat.id, {
        type: "permission_result",
        requestId: `${batch.messageId}:batch`,
        approved: true,
        actionKey,
        permissionClass
      });

      const duplicate = this._checkDuplicateAction(chat, batch, action, actionKey, permissionClass);
      if (duplicate) {
        results.push(duplicate);
        break;
      }

      const outcome = await this.toolRuntime.execute(action, {
        workspaceRoot,
        fullAccessMode: this.runtime.state.settings.fullAccessMode,
        signal: controller.signal,
        mcpManager: this.runtime.mcpManager,
        runtime: this.runtime,
        cloudApiKey: batch.cloudApiKey,
        chatId: chat.id,
        runId: batch.runId,
        objective: runState.objective,
        actionKey
      });

      if (outcome.ok) {
        const result = outcome.result;
        const localEvent = this.createLocalEvent(action, actionKey, true, result, permissionClass);
        this.runtime._upsertLocalEvent(chat, localEvent);
        const structuredResult = outcome.structuredResult || normalizeToolResult(action, true, result);
        const runtimeResult = this._compactToolResultForRuntime(action, result, structuredResult);
        const resultEntry = { action, ok: true, result: runtimeResult, structuredResult, actionKey };
        results.push(resultEntry);
        this._recordEvidence(runState, resultEntry);
        if (String(action?.type || "") === "verify_site") {
          this.runtime.markProjectVerification(action, true, result);
        }
        this.runtime._recordExecutedAction(chat.id, batch.runId, action, true, runtimeResult);
        this.runtime._rememberRecentAction(chat.id, action, true, runtimeResult);
        this.runtime._emitRuntimeEvent(chat.id, {
          type: "tool_call_finished",
          actionKey,
          action,
          ok: true,
          result: runtimeResult,
          structuredResult
        });
      } else {
        const message = outcome.result || "Erro ao executar a ferramenta.";
        const localEvent = this.createLocalEvent(action, actionKey, false, message, permissionClass);
        this.runtime._upsertLocalEvent(chat, localEvent);
        const structuredResult = outcome.structuredResult || normalizeToolResult(action, false, message);
        const runtimeResult = this._compactToolResultForRuntime(action, message, structuredResult);
        const resultEntry = { action, ok: false, result: runtimeResult, structuredResult, actionKey };
        results.push(resultEntry);
        this._recordEvidence(runState, resultEntry);
        if (String(action?.type || "") === "verify_site") {
          this.runtime.markProjectVerification(action, false, message);
        }
        this.runtime._recordExecutedAction(chat.id, batch.runId, action, false, runtimeResult);
        this.runtime._emitRuntimeEvent(chat.id, {
          type: "tool_call_finished",
          actionKey,
          action,
          ok: false,
          result: runtimeResult,
          structuredResult
        });
        if (action?.stopOnFailure) {
          this.runtime._emitRuntimeEvent(chat.id, {
            type: "error",
            message
          });
          break;
        }
      }
    }

    batch.executing = false;
    batch.completed = true;
    runState.lastResults = results;
    this.runtime.pendingBatches.delete(batch.messageId);

    if (this._isAborted(chat, runState)) {
      this._stop(chat, runState, "aborted");
      return;
    }

    this._setPhase(runState, "observe", `Observados ${results.length} resultado(s) de ferramenta.`);
    if (
      !results.some((entry) => !entry.ok) &&
      this._requiresSiteEvidence(runState) &&
      !this._hasSufficientEvidenceForFinal(runState)
    ) {
      await this._maybeAutoVerifySite(chat, batch, results, controller.signal);
    }
    const shouldContinue = this.shouldContinueAfterBatch(batch, results);
    if (!shouldContinue) {
      if (!FINAL_PHASES.has(runState.phase)) {
        this._setPhase(runState, "final", "Execucao finalizada com evidencia suficiente ou acao autocontida.");
      }
      this._maybeAppendRuntimeFinal(chat, runState, results);
      this.runtime._setChatStatus(chat, "stopped", {
        provider: chat.provider,
        reason: runState.blockedReason ? "blocked" : undefined
      });
      return;
    }

    await this.continueAfterBatch(chat, batch, results);
  }

  _linkActionToTask(action, chat) {
    const taskId = String(chat?.taskId || "").trim();
    if (!taskId || !action || typeof action !== "object") {
      return action;
    }
    const type = String(action.type || "").trim();
    const next = { ...action };
    if (["terminal_open", "terminal_exec"].includes(type)) {
      next.taskId ||= taskId;
      if (!next.session && typeof this.runtime.getTaskRecord === "function") {
        const task = this.runtime.getTaskRecord(taskId);
        next.session = task?.terminalSessionId || this.runtime._taskTerminalSessionId?.(taskId) || `task-${taskId.slice(-8)}`;
      }
    }
    if (["task_update", "task_stop", "task_delete", "task_recover", "task_cleanup_worktree", "task_create_pr", "task_logs"].includes(type)) {
      next.id ||= taskId;
    }
    if (type === "agent_spawn") {
      next.taskId ||= taskId;
    }
    return next;
  }

  _checkDuplicateAction(chat, batch, action, actionKey, permissionClass) {
    const runState = batch.runState;
    if (isChessRunState(runState, chat) && isChessObservationAction(action)) {
      return null;
    }
    if (this.runtime._hasSuccessfulActionAlready(chat.id, batch.runId, action)) {
      const message = `Repeticao bloqueada para evitar loop: ${makeActionLabel(action)} ja foi executada com sucesso neste turno.`;
      const localEvent = this.createLocalEvent(action, actionKey, false, message, permissionClass);
      this.runtime._upsertLocalEvent(chat, localEvent);
      this._setPhase(runState, "blocked", message);
      runState.blockedReason = message;
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "tool_call_finished",
        actionKey,
        action,
        ok: false,
        skipped: true,
        result: message
      });
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "error",
        message
      });
      this._appendRuntimeBlockedFinal(chat, runState, message);
      return { action, ok: false, result: message, actionKey, repeatBlocked: true };
    }

    const recentSuccess = this.runtime._wasRecentlyExecuted(chat.id, action);
    if (recentSuccess) {
      const message = `Repeticao bloqueada para evitar loop: ${makeActionLabel(action)} ja foi executada ha instantes neste chat. Resultado anterior: ${recentSuccess.result}`;
      const localEvent = this.createLocalEvent(action, actionKey, false, message, permissionClass);
      this.runtime._upsertLocalEvent(chat, localEvent);
      this._setPhase(runState, "blocked", message);
      runState.blockedReason = message;
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "tool_call_finished",
        actionKey,
        action,
        ok: false,
        skipped: true,
        result: message
      });
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "error",
        message
      });
      this._appendRuntimeBlockedFinal(chat, runState, message);
      return { action, ok: false, result: message, actionKey, repeatBlocked: true };
    }

    return null;
  }

  async _maybeAutoVerifySite(chat, batch, results, signal = null) {
    const runState = batch.runState;
    if (!runState || runState.blockedReason || this._isAborted(chat, runState)) {
      return null;
    }

    const url = this._inferLocalUrlFromRun(chat, batch, results);
    if (!url) {
      return null;
    }

    const expectedFiles = this._inferExpectedFiles(batch, results);
    const signature = JSON.stringify({ url, expectedFiles });
    if (runState.automaticVerifications.has(signature)) {
      return null;
    }
    runState.automaticVerifications.add(signature);

    const action = {
      type: "verify_site",
      url,
      expectedText: [],
      expectedFiles,
      timeoutMs: 20000,
      browserRequired: false
    };
    const actionKey = `${batch.messageId}:auto-verify-${runState.automaticVerifications.size}`;
    const permissionClass = permissionClassForAction(action, {
      workspaceRoot: runState.workspaceRoot
    });

    this._setPhase(runState, "verify", `Verificando automaticamente ${url}.`);
    this.runtime._emitRuntimeEvent(chat.id, {
      type: "tool_call_started",
      actionKey,
      action,
      permissionClass,
      automatic: true
    });
    this.runtime._emitRuntimeEvent(chat.id, {
      type: "permission_result",
      requestId: `${batch.messageId}:auto-verify`,
      approved: true,
      actionKey,
      permissionClass
    });

    const outcome = await this.toolRuntime.execute(action, {
      workspaceRoot: runState.workspaceRoot,
      fullAccessMode: this.runtime.state.settings.fullAccessMode,
      signal,
      mcpManager: this.runtime.mcpManager,
      runtime: this.runtime,
      cloudApiKey: batch.cloudApiKey,
      chatId: chat.id,
      runId: batch.runId,
      objective: runState.objective,
      actionKey
    });

    if (outcome.ok) {
      const result = outcome.result;
      const localEvent = this.createLocalEvent(action, actionKey, true, result, permissionClass);
      this.runtime._upsertLocalEvent(chat, localEvent);
      const structuredResult = outcome.structuredResult || normalizeToolResult(action, true, result);
      const runtimeResult = this._compactToolResultForRuntime(action, result, structuredResult);
      const entry = { action, ok: true, result: runtimeResult, structuredResult, actionKey, automatic: true };
      results.push(entry);
      runState.lastResults = results;
      this._recordEvidence(runState, entry);
      this.runtime.markProjectVerification(action, true, result);
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "tool_call_finished",
        actionKey,
        action,
        ok: true,
        result: runtimeResult,
        structuredResult,
        automatic: true
      });
      return entry;
    }

    {
      const message = outcome.result || "Falha ao verificar site automaticamente.";
      const localEvent = this.createLocalEvent(action, actionKey, false, message, permissionClass);
      this.runtime._upsertLocalEvent(chat, localEvent);
      const structuredResult = outcome.structuredResult || normalizeToolResult(action, false, message);
      const runtimeResult = this._compactToolResultForRuntime(action, message, structuredResult);
      const entry = { action, ok: false, result: runtimeResult, structuredResult, actionKey, automatic: true };
      results.push(entry);
      runState.lastResults = results;
      this._recordEvidence(runState, entry);
      this.runtime.markProjectVerification(action, false, message);
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "tool_call_finished",
        actionKey,
        action,
        ok: false,
        result: runtimeResult,
        structuredResult,
        automatic: true
      });
      return entry;
    }
  }

  _inferLocalUrlFromRun(chat, batch, results) {
    const sources = [];
    for (const action of batch.actions || []) {
      sources.push(action?.url, action?.checkUrl, action?.command, Array.isArray(action?.args) ? action.args.join(" ") : "");
    }
    for (const entry of results || []) {
      sources.push(entry?.result, entry?.action?.url, entry?.action?.checkUrl, entry?.action?.command);
    }
    for (const event of chat.localEvents || []) {
      sources.push(event?.content, event?.summary, event?.result);
    }

    const urls = [];
    const urlPattern = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/gi;
    for (const source of sources) {
      const text = String(source || "");
      for (const match of text.matchAll(urlPattern)) {
        urls.push(match[0].replace(/[.,;]+$/, ""));
      }
    }

    if (urls.length) {
      return this._preferLocalUrl(urls);
    }

    const portPattern = /(?:--port\s+|:(?:port=)?)(\d{2,5})\b/gi;
    const ports = [];
    for (const source of sources) {
      const text = String(source || "");
      for (const match of text.matchAll(portPattern)) {
        const port = Number(match[1]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) {
          ports.push(port);
        }
      }
    }
    if (ports.length) {
      return `http://127.0.0.1:${ports[0]}/`;
    }

    return "";
  }

  _preferLocalUrl(urls = []) {
    const clean = [...new Set(urls.map((entry) => String(entry || "").trim()).filter(Boolean))];
    clean.sort((a, b) => {
      const score = (url) => {
        let value = 0;
        if (/127\.0\.0\.1/i.test(url)) value += 4;
        if (/localhost/i.test(url)) value += 3;
        if (/:(5173|4173|3000|4409)\b/.test(url)) value += 2;
        if (/\/$/.test(url)) value += 1;
        return value;
      };
      return score(b) - score(a);
    });
    return clean[0] || "";
  }

  _inferExpectedFiles(batch, results) {
    const files = new Set();
    const maybeAdd = (value) => {
      const text = String(value || "").trim();
      if (!text || !/\.(html|css|js|jsx|ts|tsx|json)$/i.test(text)) {
        return;
      }
      files.add(text);
    };
    for (const action of batch.actions || []) {
      maybeAdd(action?.path);
      for (const file of action?.files || []) {
        maybeAdd(file);
      }
    }
    for (const entry of results || []) {
      maybeAdd(entry?.action?.path);
      for (const file of entry?.action?.files || []) {
        maybeAdd(file);
      }
    }
    return [...files].slice(0, 12);
  }

  shouldContinueAfterBatch(batch, results) {
    const runState = batch.runState;
    if (!batch.continueAfterExecution) {
      return false;
    }
    if (!results.length) {
      return false;
    }
    if (runState.blockedReason || results.some((entry) => entry.repeatBlocked)) {
      return false;
    }
    if (batch.continueAfterExecution === "on_problem") {
      return results.some((entry) => !entry.ok);
    }
    if (results.some((entry) => !entry.ok)) {
      return true;
    }
    if (isChessRunState(runState, this.runtime.getChat(batch.chatId))) {
      const chessBatch = (batch.actions || []).some((action) => isChessHarnessAction(action)) ||
        results.some((entry) => isChessHarnessAction(entry.action));
      if (chessBatch) {
        const resultText = results.map((entry) => `${entry.result || ""} ${entry.structuredResult?.summary || ""}`).join("\n");
        return !looksLikeChessGameEnded(resultText);
      }
    }
    if (this._needsMoreEvidence(runState, this.runtime.getChat(batch.chatId))) {
      return true;
    }
    if (this._hasSufficientEvidenceForFinal(runState)) {
      return false;
    }
    if (batch.actions.every((action) => this.runtime._isSelfContainedAction(action))) {
      return false;
    }
    if (results.every((entry) => entry.ok && this.runtime._looksLikeNoOpResult(entry.action, entry.result))) {
      return false;
    }
    return true;
  }

  _maybeAppendRuntimeFinal(chat, runState, results) {
    if (!chat || !runState || runState.direct || runState.blockedReason) {
      return;
    }
    if (isChessRunState(runState, chat)) {
      return;
    }
    if (!Array.isArray(results) || !results.length || results.some((entry) => !entry.ok)) {
      return;
    }
    if (!this._hasSufficientEvidenceForFinal(runState)) {
      return;
    }
    const lastVisibleAssistant = [...(chat.messages || [])]
      .reverse()
      .find((message) => message.kind === "assistant" && !message.hidden);
    if (lastVisibleAssistant?.status === "runtime_final") {
      return;
    }

    const content = this._buildRuntimeFinalSummary(chat, runState, results);
    if (!content) {
      return;
    }

    const message = this.runtime._finalizeAssistantMessage(chat, null, content, []);
    message.status = "runtime_final";
    message.runtimeGenerated = true;
  }

  _buildRuntimeFinalSummary(chat, runState, results) {
    if (isChessRunState(runState, chat)) {
      return "";
    }
    const projects = Array.isArray(this.runtime.state?.projects) ? this.runtime.state.projects : [];
    const project =
      projects.find((entry) => entry.path && runState.runId && entry.runId === runState.runId) ||
      projects.find((entry) => entry.path && chat?.id && entry.chatId === chat.id) ||
      this.runtime.findRecentProject(runState.objective);
    const lastResult = [...results].reverse().find((entry) => entry.ok);
    const lastType = String(lastResult?.action?.type || "");
    const lastSummary = this._summarizeResult(lastResult?.result, 320);
    const url =
      String(lastResult?.action?.url || "").trim() ||
      String(project?.url || "").trim() ||
      this._inferLocalUrlFromRun(chat, { actions: runState.lastActions || [] }, results);

    if (this._requiresSiteEvidence(runState)) {
      const parts = ["Concluido. Projeto verificado"];
      if (project?.path) {
        parts.push(`em ${project.path}`);
      }
      if (url) {
        parts.push(`e rodando em ${url}`);
      }
      return `${parts.join(" ")}.`;
    }

    if (lastType === "open_path" || lastType === "reveal_path") {
      return `Concluido. ${lastSummary}`;
    }
    if (lastType === "open_url") {
      return `Concluido. URL aberta: ${url || lastResult.action.url}.`;
    }
    if (lastType.startsWith("verify_") || lastType === "browser_check" || lastType === "browser_control") {
      return `Concluido. Verificacao finalizada com sucesso.`;
    }

    return `Concluido. Tarefa executada com sucesso.`;
  }

  buildBatchSummary(results, chat = null, runState = null) {
    const originalUserText = runState?.objective || this.runtime._getLatestVisibleUserText(chat);
    const workspaceRoot = runState?.workspaceRoot || (chat ? this.runtime._getChatWorkspaceRoot(chat) : "");
    const evidence = Array.isArray(runState?.evidence) ? runState.evidence : [];
    const transcript = runState?.transcript?.summarize?.(10) || "";
    return [
      originalUserText ? `Original user request: ${originalUserText}` : "",
      workspaceRoot ? `Current workspace: ${workspaceRoot}` : "",
      runState ? `Runtime phase: ${runState.phase}, iteration: ${runState.iteration}/${runState.maxIterations}` : "",
      transcript ? `Internal runtime transcript:\n${transcript}` : "",
      "Local action results:",
      ...results.map((entry) =>
        [
          `${entry.ok ? "SUCCESS" : "FAIL"} - ${makeActionLabel(entry.action)} - ${this._summarizeResult(entry.result)}`,
          entry.structuredResult?.errorType ? `errorType=${entry.structuredResult.errorType}` : "",
          entry.structuredResult?.repairHints?.length
            ? `repairHints=${entry.structuredResult.repairHints.join(" | ")}`
            : ""
        ].filter(Boolean).join(" ")
      ),
      evidence.length ? "Evidence collected:" : "",
      ...evidence.slice(-8).map((entry) => `${entry.ok ? "OK" : "FAIL"} ${entry.kind}: ${entry.summary}`),
      "Continue the same task and the same workspace. Do not create a different project unless the original user request explicitly asked for it.",
      "If a tool failed, repair the exact cause using the raw error above. Do not restart from scratch unless repair is impossible.",
      isChessRunState(runState, chat)
        ? "Chess continuation rule: this is an active game task. Do not produce a final/project/site summary while the game is active. If browser_chess_state says agentTurn=yes, think using the board state and execute browser_chess_move. If agentTurn=no, call browser_chess_wait_turn. Only final-answer when the game is over or the user stops."
        : "For local site/app tasks, verify the server, URL, browser console/render and expected content before finalizing.",
      "If the task is complete, reply once with the final result and do not call more tools.",
      "Do not repeat a successful tool call unless the user explicitly asked for another change."
    ].filter(Boolean).join("\n");
  }

  async continueAfterBatch(chat, batch, results) {
    if (this._isAborted(chat, batch.runState)) {
      this._stop(chat, batch.runState, "aborted");
      return;
    }

    const runState = batch.runState;
    this._setPhase(
      runState,
      results.some((entry) => !entry.ok) ? "repair" : "verify",
      results.some((entry) => !entry.ok)
        ? "Solicitando reparo baseado no erro observado."
        : "Solicitando verificacao/finalizacao com base na evidencia."
    );

    const summaryText = this.buildBatchSummary(results, chat, runState);
    if (batch.provider === "local") {
      const controller = new AbortController();
      this.runtime._attachController(chat.id, controller, batch.runId);
      await this.runProviderTurn(chat, {
        userText: summaryText,
        attachmentPaths: [],
        userMessageId: null,
        cloudApiKey: batch.cloudApiKey,
        signal: controller.signal,
        chainDepth: Number(batch.chainDepth || 0) + 1,
        runId: batch.runId,
        runState
      });
      return;
    }

    if (!batch.cloudApiKey || !chat.taskId) {
      if (results.some((entry) => !entry.ok) || this._needsMoreEvidence(runState, chat)) {
        this._block(chat, runState, "Nao foi possivel continuar a tarefa cloud porque nao ha API key/taskId ativo para devolver o resultado local.", "provider_blocked");
        return;
      }
      this.runtime._setChatStatus(chat, "stopped", {
        provider: "cloud"
      });
      return;
    }

    try {
      await sendLocalExecutionResult(batch.cloudApiKey, this.runtime.state.settings, chat, summaryText);
      if (this._isAborted(chat, runState)) {
        this._stop(chat, runState, "aborted");
        return;
      }
      const controller = new AbortController();
      this.runtime._attachController(chat.id, controller, batch.runId);
      await this.runProviderTurn(chat, {
        userText: "",
        attachmentPaths: [],
        userMessageId: null,
        cloudApiKey: batch.cloudApiKey,
        signal: controller.signal,
        chainDepth: Number(batch.chainDepth || 0) + 1,
        runId: batch.runId,
        runState
      });
    } catch (error) {
      this.runtime._upsertLocalEvent(
        chat,
        normalizeLocalEvent({
          actionKey: `${batch.messageId}:feedback`,
          ok: false,
          content: `A acao local foi executada, mas nao consegui devolver o resultado ao provider: ${error.message}`
        })
      );
      chat.status = "error";
      chat.updatedAt = Date.now();
      this.runtime._emitRuntimeEvent(chat.id, {
        type: "error",
        message: error.message || "Falha ao continuar a tarefa apos tool call."
      });
    }
  }

  async _repairMissingProviderActions(chat, runState, context = {}) {
    if (!chat || !runState || this._isAborted(chat, runState)) {
      return false;
    }

    const repairCountKey = context.invalidReasons?.length
      ? "invalidActionRepairCount"
      : "noActionRepairCount";
    const currentCount = Number(runState[repairCountKey] || 0);
    if (currentCount >= 2) {
      return false;
    }
    if (runState.iteration >= runState.maxIterations) {
      return false;
    }

    runState[repairCountKey] = currentCount + 1;
    const evidenceBefore = Array.isArray(runState.evidence) ? runState.evidence.length : 0;
    const lastActionsBefore = JSON.stringify(runState.lastActions || []);
    this._setPhase(
      runState,
      "repair",
      context.invalidReasons?.length
        ? "Reparando lote de ferramentas rejeitado pela validacao."
        : "Provider respondeu sem ferramenta; solicitando proximo passo executavel."
    );

    const repairPrompt = this.buildMissingActionPrompt(chat, runState, {
      assistantText: context.assistantText || "",
      reason: context.reason || "",
      invalidReasons: context.invalidReasons || []
    });

    await this.runProviderTurn(chat, {
      userText: repairPrompt,
      attachmentPaths: [],
      userMessageId: null,
      cloudApiKey: context.cloudApiKey,
      signal: context.signal,
      chainDepth: Number(context.chainDepth || 0) + 1,
      runId: context.runId || runState.runId,
      runState
    });

    return (
      FINAL_PHASES.has(runState.phase) ||
      (Array.isArray(runState.evidence) && runState.evidence.length > evidenceBefore) ||
      JSON.stringify(runState.lastActions || []) !== lastActionsBefore
    );
  }

  buildMissingActionPrompt(chat, runState, details = {}) {
    const invalidReasons = Array.isArray(details.invalidReasons) ? details.invalidReasons.filter(Boolean) : [];
    return [
      `Original user request: ${runState.objective}`,
      `Current workspace: ${runState.workspaceRoot}`,
      details.reason ? `Runtime problem: ${details.reason}` : "Runtime problem: the previous response had no executable tool calls.",
      invalidReasons.length ? `Rejected/invalid tool diagnostics:\n- ${invalidReasons.slice(0, 8).join("\n- ")}` : "",
      details.assistantText ? `Previous assistant text:\n${this._summarizeResult(details.assistantText, 1200)}` : "",
      "The previous response cannot complete the task because it did not provide valid accepted tool calls.",
      "Continue the same task now with valid tool calls. Do not only say what you will do.",
      "If the objective requires changing, observing, launching, or verifying local state, use the appropriate tools and collect evidence before the final answer.",
      "If this is a pure answer-only request, give the final answer directly without promising local execution.",
      "Do not create an unrelated project. Do not repeat rejected tools. Do not repeat successful tools."
    ].filter(Boolean).join("\n");
  }

  buildMissingEvidencePrompt(chat, runState, assistantText = "") {
    return [
      `Original user request: ${runState.objective}`,
      `Current workspace: ${runState.workspaceRoot}`,
      assistantText ? `Last assistant response without enough evidence: ${assistantText}` : "",
      "The runtime cannot finalize yet because the task needs concrete evidence.",
      "Continue the same task. Use tools to observe or verify the actual result.",
      this._requiresSiteEvidence(runState)
        ? "For this site/app request, verify the local server, URL response, browser render/console, expected text and created files."
        : "Verify the command/file/action result before finalizing.",
      "Do not create a new unrelated project. Do not repeat successful tools."
    ].filter(Boolean).join("\n");
  }

  _ingestHermesToolEvents(chat, runState, events = []) {
    if (!chat || !runState || !Array.isArray(events) || !events.length) {
      return [];
    }

    const ingested = [];
    const seenEvidenceKeys = new Set((runState.evidence || []).map((entry) => entry.actionKey).filter(Boolean));
    for (const [index, event] of events.entries()) {
      if (String(event?.type || "") !== "tool_complete") {
        continue;
      }
      const action = this._mapHermesToolEventToAction(event, runState);
      if (!action) {
        continue;
      }

      const actionKey = `hermes:${event.id || `${event.name || "tool"}:${index}`}`;
      const ok = this._hermesToolEventOk(event);
      const result = this._formatHermesToolResult(event);
      const permissionClass = permissionClassForAction(action, {
        workspaceRoot: runState.workspaceRoot
      });
      const localEvent = this.createLocalEvent(action, actionKey, ok, result, permissionClass);
      this.runtime._upsertLocalEvent(chat, localEvent);

      const structuredResult = normalizeToolResult(action, ok, result);
      const runtimeResult = this._compactToolResultForRuntime(action, result, structuredResult);
      const resultEntry = {
        action,
        ok,
        result: runtimeResult,
        structuredResult,
        actionKey,
        provider: "hermes",
        visualOnly: true
      };
      ingested.push(resultEntry);
      runState.lastActions.push(action);
      runState.lastResults.push(resultEntry);
      if (!seenEvidenceKeys.has(actionKey)) {
        this._recordEvidence(runState, resultEntry);
        seenEvidenceKeys.add(actionKey);
      }
      if (String(action.type || "") === "verify_site" && typeof this.runtime.markProjectVerification === "function") {
        this.runtime.markProjectVerification(action, ok, result);
      }
    }

    return ingested;
  }

  _mapHermesToolEventToAction(event, runState) {
    const name = String(event?.name || "").trim();
    const args = event?.args && typeof event.args === "object" ? event.args : {};
    const parsedResult = this._parseHermesToolResult(event?.result);
    if (!name) {
      return null;
    }

    if (name === "write_file") {
      const resolvedPath = this._resolveHermesPath(args.path, runState);
      if (!resolvedPath) {
        return null;
      }
      const inlineContent = typeof args.content === "string" ? args.content : "";
      return {
        type: "write_file",
        path: resolvedPath,
        content: inlineContent || this._readPreviewFileContent(resolvedPath)
      };
    }

    if (name === "read_file") {
      const resolvedPath = this._resolveHermesPath(args.path, runState);
      return resolvedPath
        ? {
            type: "read_file",
            path: resolvedPath,
            offset: args.offset,
            limit: args.limit,
            content:
              typeof parsedResult?.content === "string"
                ? parsedResult.content
                : typeof parsedResult?.text === "string"
                  ? parsedResult.text
                  : typeof parsedResult?.output === "string"
                    ? parsedResult.output
                    : ""
          }
        : null;
    }

    if (name === "patch") {
      const resolvedPath = this._resolveHermesPath(args.path, runState);
      if (String(args.mode || "") === "patch" || args.patch) {
        const patchText = String(args.patch || "");
        return patchText
          ? {
              type: "apply_patch",
              path: resolvedPath || this._extractHermesPatchPath(patchText) || "patch.diff",
              patch: patchText
            }
          : null;
      }
      if (!resolvedPath) {
        return null;
      }
      return {
        type: "file_edit",
        path: resolvedPath,
        edits: [
          {
            type: "replace",
            oldText: String(args.old_string || ""),
            newText: String(args.new_string || ""),
            replaceAll: Boolean(args.replace_all)
          }
        ]
      };
    }

    if (name === "search_files") {
      const pattern = String(args.pattern || args.query || "").trim();
      const searchPath = this._resolveHermesPath(args.path || args.directory || ".", runState);
      const mode = String(args.mode || args.kind || "").toLowerCase();
      if (mode.includes("file") || !pattern) {
        return {
          type: "glob_files",
          pattern: pattern || "*",
          path: searchPath || runState.workspaceRoot
        };
      }
      return {
        type: "grep_files",
        pattern,
        path: searchPath || runState.workspaceRoot
      };
    }

    if (name === "terminal") {
      const command = String(args.command || "").trim();
      if (!command) {
        return null;
      }
      const cwd = this._resolveHermesPath(args.workdir || args.cwd || ".", runState);
      if (args.background) {
        return {
          type: "background_command_start",
          command,
          cwd,
          wait: false
        };
      }
      return {
        type: "run_command",
        command,
        cwd,
        wait: true
      };
    }

    if (name === "browser_navigate") {
      const url = String(args.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      return url ? { type: "browser_control", operation: "navigate", url } : null;
    }
    if (name === "browser_snapshot") {
      const url = String(args.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      const screenshotPath = this._resolveHermesPath(
        args.screenshot_path ||
          args.screenshotPath ||
          this._extractHermesResultPath(parsedResult, ["screenshot_path", "screenshot", "image_path", "path"]),
        runState
      );
      return {
        type: "browser_check",
        url,
        screenshotPath,
        expectedText: String(args.expected_text || args.expectedText || "")
      };
    }
    if (name === "browser_console") {
      if (isChessRunState(runState, this.runtime.getChat?.(runState?.chatId))) {
        return {
          type: "browser_harness",
          command: "chess_state"
        };
      }
      const url = String(args.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      return {
        type: "verify_browser_console",
        url,
        expression: args.expression ? String(args.expression) : undefined,
        clear: typeof args.clear === "undefined" ? undefined : Boolean(args.clear)
      };
    }
    if (name === "browser_chess_state" || name === "browser_board_state") {
      return {
        type: "browser_harness",
        command: "chess_state"
      };
    }
    if (name === "browser_chess_move") {
      const fromSquare = String(args.from_square || args.fromSquare || args.from || "").trim().toLowerCase();
      const toSquare = String(args.to_square || args.toSquare || args.to || "").trim().toLowerCase();
      return {
        type: "browser_harness",
        command: "chess_move",
        fromSquare,
        toSquare,
        promotion: args.promotion ? String(args.promotion) : undefined,
        timeoutMs: 70000
      };
    }
    if (name === "browser_chess_wait_turn" || name === "browser_wait_chess_turn") {
      const timeoutSeconds = Number(args.timeout_seconds || args.timeoutSeconds || args.timeout || 30);
      return {
        type: "browser_harness",
        command: "chess_wait_turn",
        timeoutMs: Number.isFinite(timeoutSeconds) ? Math.max(800, Math.min(timeoutSeconds * 1000, 120000)) : 30000
      };
    }
    if (name === "browser_click_square") {
      return {
        type: "browser_harness",
        command: "click_square",
        square: String(args.square || args.chessSquare || args.chess_square || "").trim().toLowerCase()
      };
    }
    if (name.startsWith("browser_")) {
      const operation = name.replace(/^browser_/, "");
      const url = String(args.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      const screenshotPath = this._resolveHermesPath(
        args.screenshot_path ||
          args.screenshotPath ||
          this._extractHermesResultPath(parsedResult, ["screenshot_path", "screenshot", "image_path"]),
        runState
      );
      return {
        type: "browser_control",
        operation,
        url,
        selector: args.selector ? String(args.selector) : undefined,
        text: typeof args.text === "string" ? args.text : undefined,
        key: args.key ? String(args.key) : undefined,
        direction: args.direction ? String(args.direction) : undefined,
        screenshotPath,
        args: this._compactSerializable(args)
      };
    }

    if (name === "web_search") {
      return {
        type: "web_search",
        query: String(args.query || args.q || ""),
        topK: args.top_k || args.topK || args.limit
      };
    }
    if (name === "web_extract") {
      const urls = this._coerceStringArray(args.urls || args.url || this._extractHermesResultList(parsedResult, ["urls", "url"]));
      return {
        type: "web_fetch",
        url: urls[0] || "",
        urls
      };
    }

    if (name === "execute_code") {
      return {
        type: "execute_code",
        language: String(args.language || args.lang || "python"),
        code: String(args.code || ""),
        timeout: args.timeout || args.timeout_seconds || args.timeoutSeconds
      };
    }

    if (name === "todo") {
      return {
        type: "todo_write",
        todos: Array.isArray(args.todos)
          ? args.todos
          : Array.isArray(parsedResult?.todos)
            ? parsedResult.todos
            : [],
        action: args.action ? String(args.action) : undefined,
        merge: typeof args.merge === "undefined" ? undefined : Boolean(args.merge)
      };
    }

    if (name === "delegate_task") {
      return {
        type: "agent_spawn",
        objective: String(args.goal || args.prompt || args.task || ""),
        context: typeof args.context === "string" ? args.context : undefined,
        agent: args.agent ? String(args.agent) : undefined
      };
    }

    if (name === "process") {
      const processAction = String(args.action || args.operation || "").toLowerCase();
      const id = String(args.id || args.name || args.process_id || args.job_id || "").trim();
      if (["stop", "kill", "terminate", "cancel"].includes(processAction)) {
        return { type: "background_command_stop", jobId: id, name: id };
      }
      if (["logs", "status", "list", "inspect"].includes(processAction)) {
        return { type: "background_command_logs", jobId: id, name: id };
      }
      return {
        type: "process",
        action: processAction || "inspect",
        id,
        args: this._compactSerializable(args)
      };
    }

    if (name === "memory") {
      return {
        type: "memory",
        action: String(args.action || args.operation || "record"),
        target: String(args.target || args.key || args.name || ""),
        args: this._compactSerializable(args)
      };
    }

    if (name === "session_search") {
      return {
        type: "session_search",
        query: String(args.query || args.q || ""),
        args: this._compactSerializable(args)
      };
    }

    if (name === "vision_analyze") {
      return {
        type: "vision_analyze",
        path: this._resolveHermesPath(args.path || args.image_path || args.imagePath || "", runState),
        prompt: String(args.prompt || args.question || "")
      };
    }

    if (name === "image_generate") {
      return {
        type: "image_generate",
        path: this._resolveHermesPath(
          args.output_path ||
            args.outputPath ||
            this._extractHermesResultPath(parsedResult, ["output_path", "image_path", "artifact_path", "path"]),
          runState
        ),
        prompt: String(args.prompt || "")
      };
    }

    if (name === "text_to_speech") {
      return {
        type: "audio_generate",
        path: this._resolveHermesPath(
          args.output_path ||
            args.outputPath ||
            this._extractHermesResultPath(parsedResult, ["output_path", "audio_path", "artifact_path", "path"]),
          runState
        ),
        text: String(args.text || "")
      };
    }

    if (name === "dream_open_url") {
      const url = String(args.url || parsedResult?.action?.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      if (!url) {
        return null;
      }
      if (/^https?:\/\//i.test(url)) {
        const resultText = String(parsedResult?.result || "");
        const screenshotPath = this._resolveHermesPath(
          this._extractHermesResultPath(parsedResult, ["screenshot_path", "screenshot", "image_path"]) ||
            (resultText.match(/Screenshot:\s*([^\r\n]+)/i)?.[1] || ""),
          runState
        );
        return {
          type: "browser_control",
          operation: "navigate",
          url,
          screenshotPath
        };
      }
      return { type: "open_url", url };
    }
    if (name === "dream_browser_control") {
      const url = String(args.url || parsedResult?.action?.url || this._extractHermesResultUrl(parsedResult) || "").trim();
      const resultText = String(parsedResult?.result || "");
      const screenshotPath = this._resolveHermesPath(
        this._extractHermesResultPath(parsedResult, ["screenshot_path", "screenshot", "image_path"]) ||
          (resultText.match(/Screenshot:\s*([^\r\n]+)/i)?.[1] || ""),
        runState
      );
      const steps = Array.isArray(args.steps) ? args.steps : [];
      return {
        type: "browser_control",
        operation: steps.length ? "control" : url ? "navigate" : "snapshot",
        url: url || undefined,
        screenshotPath,
        steps: steps.length ? steps : undefined
      };
    }
    if (name === "dream_open_path") {
      const resolvedPath = this._resolveHermesPath(args.path, runState);
      return resolvedPath ? { type: "open_path", path: resolvedPath } : null;
    }
    if (name === "dream_reveal_path") {
      const resolvedPath = this._resolveHermesPath(args.path, runState);
      return resolvedPath ? { type: "reveal_path", path: resolvedPath } : null;
    }
    if (name === "dream_launch_app") {
      return {
        type: "launch_app",
        app: args.app ? String(args.app) : undefined,
        path: args.path ? this._resolveHermesPath(args.path, runState) : undefined,
        args: Array.isArray(args.args) ? args.args : undefined
      };
    }
    if (name === "dream_set_volume") {
      return {
        type: "set_volume",
        level: args.level,
        delta: args.delta,
        muted: args.muted
      };
    }
    if (name === "dream_media_control") {
      return args.action ? { type: "media_control", action: String(args.action) } : null;
    }
    if (name === "dream_set_preview_device") {
      const mode = String(args.mode || "").trim().toLowerCase();
      return {
        type: "set_preview_device",
        mode: mode === "mobile" ? "mobile" : "desktop"
      };
    }

    return {
      type: "hermes_tool",
      tool: name,
      args: this._compactSerializable(args),
      path: this._resolveHermesPath(
        this._extractHermesResultPath(parsedResult, [
          "path",
          "file",
          "file_path",
          "screenshot",
          "screenshot_path",
          "image_path",
          "output_path",
          "artifact_path"
        ]),
        runState
      ),
      url: this._extractHermesResultUrl(parsedResult) || undefined
    };
  }

  _hermesToolEventOk(event) {
    const parsed = this._parseHermesToolResult(event?.result);
    if (!parsed || typeof parsed !== "object") {
      return true;
    }
    if (parsed.error || parsed.exception) {
      return false;
    }
    if (parsed.ok === false || parsed.success === false) {
      return false;
    }
    const status = String(parsed.status || parsed.state || "").toLowerCase();
    if (["error", "failed", "fail", "blocked", "approval_required"].includes(status)) {
      return false;
    }
    if (typeof parsed.exit_code !== "undefined" && Number(parsed.exit_code) !== 0) {
      return false;
    }
    if (typeof parsed.exitCode !== "undefined" && Number(parsed.exitCode) !== 0) {
      return false;
    }
    return true;
  }

  _formatHermesToolResult(event) {
    const parsed = this._parseHermesToolResult(event?.result);
    if (parsed && typeof parsed === "object") {
      const parts = [];
      for (const key of [
        "status",
        "path",
        "url",
        "screenshot_path",
        "image_path",
        "output_path",
        "artifact_path",
        "title",
        "duration_seconds",
        "tool_calls_made",
        "exit_code",
        "exitCode",
        "summary",
        "message",
        "error"
      ]) {
        if (typeof parsed[key] !== "undefined" && parsed[key] !== null && String(parsed[key]).trim()) {
          parts.push(`${key}: ${String(parsed[key])}`);
        }
      }
      for (const key of ["stdout", "stderr", "output"]) {
        if (typeof parsed[key] === "string" && parsed[key].trim()) {
          parts.push(`${key.toUpperCase()}:\n${this._summarizeResult(parsed[key], 1500)}`);
        }
      }
      if (parts.length) {
        return parts.join("\n");
      }
      try {
        return JSON.stringify(parsed);
      } catch {}
    }
    return this._summarizeResult(event?.result || `${event?.name || "tool"} concluida.`, 2000);
  }

  _parseHermesToolResult(result) {
    if (!result || typeof result !== "string") {
      return result && typeof result === "object" ? result : null;
    }
    const trimmed = result.trim();
    if (!trimmed) {
      return null;
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  _coerceStringArray(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
    const text = String(value || "").trim();
    return text ? [text] : [];
  }

  _compactSerializable(value, limit = 4000) {
    if (typeof value === "undefined") {
      return undefined;
    }
    try {
      const json = JSON.stringify(value);
      if (json.length <= limit) {
        return value;
      }
      return {
        truncated: true,
        preview: `${json.slice(0, limit - 18)}... [truncated]`
      };
    } catch {
      return String(value || "").slice(0, limit);
    }
  }

  _extractHermesResultUrl(value) {
    const urls = this._extractHermesResultList(value, ["url", "urls", "uri", "href", "page_url", "pageUrl"]);
    return urls.find((entry) => /^https?:\/\//i.test(entry)) || "";
  }

  _extractHermesResultPath(value, keys = []) {
    const paths = this._extractHermesResultList(value, keys);
    return paths.find(Boolean) || "";
  }

  _extractHermesResultList(value, keys = []) {
    const keySet = new Set(keys.map((key) => String(key).toLowerCase()));
    const results = [];
    const visit = (entry, depth = 0, allowFreeText = false) => {
      if (depth > 5 || entry === null || typeof entry === "undefined") {
        return;
      }
      if (typeof entry === "string") {
        if (!keySet.size || allowFreeText) {
          const normalizedEntry = normalizePathText(entry);
          const urlMatches = normalizedEntry.match(/https?:\/\/[^\s"'<>`]+/gi) || [];
          for (const match of urlMatches) {
            results.push(match.replace(/[),.;]+$/, ""));
          }
          const pathMatches = normalizedEntry.match(/[A-Za-z]:[\\/][^\r\n"'<>`|]+|\/[^\r\n"'<>`|]+/g) || [];
          for (const match of pathMatches) {
            results.push(match.trim());
          }
        }
        return;
      }
      if (Array.isArray(entry)) {
        for (const item of entry.slice(0, 20)) {
          visit(item, depth + 1, allowFreeText);
        }
        return;
      }
      if (typeof entry !== "object") {
        return;
      }
      for (const [key, item] of Object.entries(entry)) {
        const normalizedKey = String(key).toLowerCase();
        if (keySet.has(normalizedKey)) {
          if (Array.isArray(item)) {
            for (const child of item) {
              if (typeof child === "string") {
                results.push(child.trim());
              } else {
                visit(child, depth + 1, true);
              }
            }
          } else if (typeof item === "string" || typeof item === "number") {
            results.push(String(item).trim());
          } else {
            visit(item, depth + 1, true);
          }
        } else {
          visit(item, depth + 1, false);
        }
      }
    };
    visit(value);
    return [...new Set(results.map((entry) => String(entry || "").trim()).filter(Boolean))];
  }

  _resolveHermesPath(rawPath, runState) {
    let input = normalizePathText(rawPath);
    if (!input) {
      return "";
    }
    const workspaceRoot = runState?.workspaceRoot || process.cwd();
    if (/^file:/i.test(input)) {
      try {
        const parsed = new URL(input);
        if (parsed.hostname && (!parsed.pathname || parsed.pathname === "/")) {
          input = parsed.hostname;
        } else if (parsed.hostname && parsed.pathname) {
          input = `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
        } else {
          input = fileURLToPath(parsed);
        }
      } catch {
        input = input.replace(/^file:\/{0,3}/i, "");
      }
      input = normalizePathText(input);
    }
    input = input
      .replace(/^~(?=$|[\\/])/, os.homedir())
      .replaceAll("%USERPROFILE%", os.homedir())
      .replaceAll("%HOME%", os.homedir())
      .replaceAll("%TEMP%", os.tmpdir())
      .replace(/%([^%]+)%/g, (_, name) => {
        const key = String(name || "").trim();
        return key && typeof process.env[key] === "string" ? process.env[key] : `%${key}%`;
      });
    input = normalizePathText(input);
    if (process.platform === "win32" && /^[/\\][^/\\]/.test(input) && !/^[/\\]{2}/.test(input)) {
      const driveRootPath = path.normalize(input);
      if (fs.existsSync(driveRootPath)) {
        return driveRootPath;
      }
      return path.normalize(path.join(workspaceRoot, input.replace(/^[/\\]+/, "")));
    }
    if (path.isAbsolute(input)) {
      return path.normalize(input);
    }
    return path.resolve(workspaceRoot, input);
  }

  _readPreviewFileContent(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_INGESTED_FILE_CHARS) {
        return "";
      }
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  }

  _extractHermesPatchPath(patchText) {
    const text = String(patchText || "");
    const match = text.match(/^\+\+\+\s+(?:b\/)?(.+)$/m) || text.match(/^\*\*\*\s+Update File:\s+(.+)$/m);
    return match ? match[1].trim() : "";
  }

  _compactToolResultForRuntime(action, result, structuredResult = null) {
    const type = String(action?.type || "").trim();
    if (type === "browser_control" || type === "browser_check" || type === "verify_browser_console") {
      return structuredResult?.summary || this._summarizeResult(result, 900);
    }
    return result;
  }

  _recordEvidence(runState, resultEntry) {
    if (!runState || !resultEntry) {
      return null;
    }
    const type = String(resultEntry.action?.type || "").trim();
    const verifierTypes = new Set(["verify_site", "verify_url", "verify_file", "verify_command", "verify_browser_console"]);
    const browserTypes = new Set(["browser_check", "browser_control", "verify_browser_console"]);
    const fileTypes = new Set([
      "write_file",
      "append_file",
      "file_edit",
      "apply_patch",
      "create_directory",
      "delete_path",
      "image_generate",
      "audio_generate"
    ]);
    const commandTypes = new Set([
      "run_command",
      "terminal_exec",
      "background_command_start",
      "background_command_logs",
      "background_command_stop",
      "execute_code",
      "process"
    ]);
    const webTypes = new Set(["web_search", "web_fetch"]);
    const taskTypes = new Set(["todo_write", "agent_spawn", "memory", "session_search"]);
    const mediaTypes = new Set(["vision_analyze", "image_generate", "audio_generate"]);
    const desktopTypes = new Set([
      "launch_app",
      "open_url",
      "open_path",
      "reveal_path",
      "set_volume",
      "set_preview_device",
      "media_control",
      "system_query"
    ]);
    let kind = "tool";
    if (type === "verify_site") {
      kind = "site";
    } else if (verifierTypes.has(type)) {
      kind = "verification";
    } else if (browserTypes.has(type)) {
      kind = "browser";
    } else if (fileTypes.has(type)) {
      kind = "file";
    } else if (commandTypes.has(type)) {
      kind = "command";
    } else if (webTypes.has(type)) {
      kind = "web";
    } else if (taskTypes.has(type)) {
      kind = "task";
    } else if (mediaTypes.has(type)) {
      kind = "media";
    } else if (desktopTypes.has(type)) {
      kind = "desktop";
    }

    const evidence = {
      kind,
      ok: Boolean(resultEntry.ok),
      summary: resultEntry.structuredResult?.summary || this._summarizeResult(resultEntry.result, 280),
      actionType: type,
      actionKey: resultEntry.actionKey,
      errorType: resultEntry.structuredResult?.errorType || "",
      repairHints: resultEntry.structuredResult?.repairHints || [],
      timestamp: Date.now()
    };
    runState.evidence.push(evidence);
    runState.transcript?.tool(resultEntry.action, resultEntry.result, resultEntry.ok);
    this.runtime._emitRuntimeEvent(runState.chatId, {
      type: "agent_evidence_added",
      kind: evidence.kind,
      ok: evidence.ok,
      summary: evidence.summary,
      errorType: evidence.errorType,
      repairHints: evidence.repairHints
    });
    return evidence;
  }

  _summarizeResult(value, limit = 500) {
    const text = String(value || "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length <= limit) {
      return text || "(vazio)";
    }
    return `${text.slice(0, limit - 18)}... [truncated]`;
  }

  _requiresOperationalEvidence(runState) {
    if (!runState || runState.direct) {
      return false;
    }
    return (
      (Array.isArray(runState.lastActions) && runState.lastActions.length > 0) ||
      (Array.isArray(runState.evidence) && runState.evidence.length > 0)
    );
  }

  _requiresSiteEvidence(runState) {
    if (!runState) {
      return false;
    }
    if (isChessRunState(runState, this.runtime.getChat?.(runState.chatId))) {
      return false;
    }
    const actionTypes = new Set(
      [
        ...(Array.isArray(runState.lastActions) ? runState.lastActions : [])
          .map((action) => String(action?.type || "").trim()),
        ...(Array.isArray(runState.evidence) ? runState.evidence : [])
          .map((entry) => String(entry?.actionType || "").trim())
      ].filter(Boolean)
    );
    return [...actionTypes].some((type) => SITE_RELATED_TOOL_TYPES.has(type));
  }

  _hasSufficientEvidenceForFinal(runState) {
    const evidence = Array.isArray(runState?.evidence) ? runState.evidence : [];
    if (isChessRunState(runState, this.runtime.getChat?.(runState?.chatId))) {
      return false;
    }
    if (!this._requiresOperationalEvidence(runState)) {
      return true;
    }
    if (this._requiresSiteEvidence(runState)) {
      return evidence.some((entry) => entry.ok && ["site", "browser", "verification"].includes(entry.kind));
    }
    return evidence.some((entry) =>
      entry.ok && ["verification", "site", "browser", "file", "command", "desktop", "web", "task", "media"].includes(entry.kind)
    );
  }

  _needsMoreEvidence(runState, chat) {
    if (!runState || FINAL_PHASES.has(runState.phase)) {
      return false;
    }
    if (runState.iteration >= runState.maxIterations) {
      this._block(chat, runState, `O agente atingiu o limite de ${runState.maxIterations} iteracoes sem evidencia suficiente.`, "max_iterations");
      return false;
    }
    if (!this._requiresOperationalEvidence(runState)) {
      return false;
    }
    return !this._hasSufficientEvidenceForFinal(runState);
  }

  _setPhase(runState, phase, summary = "") {
    if (!runState) {
      return;
    }
    runState.phase = phase;
    runState.transcript?.phase(phase, summary);
    this.runtime._emitRuntimeEvent(runState.chatId, {
      type: "agent_phase_changed",
      phase,
      iteration: runState.iteration,
      summary
    });
    this.runtime._emitRuntimeEvent(runState.chatId, {
      type: "task_state_changed",
      phase,
      iteration: runState.iteration,
      status: phase
    });
  }

  _block(chat, runState, reason, statusReason = "blocked") {
    if (!chat || !runState) {
      return;
    }
    runState.blockedReason = reason;
    this._setPhase(runState, "blocked", reason);
    this.runtime._setChatStatus(chat, "stopped", {
      provider: chat.provider,
      reason: statusReason
    });
    this._appendRuntimeBlockedFinal(chat, runState, reason);
    this.runtime._emitRuntimeEvent(chat.id, {
      type: "error",
      message: reason
    });
  }

  _appendRuntimeBlockedFinal(chat, runState, reason) {
    const lastVisibleAssistant = [...(chat.messages || [])]
      .reverse()
      .find((message) => message.kind === "assistant" && !message.hidden);
    if (lastVisibleAssistant?.status === "runtime_blocked") {
      return;
    }

    const evidence = Array.isArray(runState.evidence) ? runState.evidence : [];
    const lastEvidence = [...evidence].reverse().find(Boolean);
    const parts = [`Bloqueado. ${reason}`];
    if (lastEvidence?.summary) {
      parts.push(`Ultima evidencia: ${lastEvidence.summary}`);
    }

    const message = this.runtime._finalizeAssistantMessage(chat, null, parts.join("\n\n"), []);
    message.status = "runtime_blocked";
    message.runtimeGenerated = true;
  }

  _stop(chat, runState, reason = "aborted") {
    if (!chat || !runState) {
      return;
    }
    this._setPhase(runState, "stopped", reason);
    this.runtime._setChatStatus(chat, "stopped", {
      provider: chat.provider,
      reason
    });
    this.runtime._emitRuntimeEvent(chat.id, {
      type: "stopped",
      reason
    });
  }

  _isAborted(chat, runState) {
    return (
      !chat ||
      this.runtime._isStopped(chat.id) ||
      !this.runtime._isCurrentRun(chat.id, runState?.runId)
    );
  }
}

module.exports = {
  AgentRuntime,
  _test: {
    hermesRouteNeedsManagedLocalLlama
  }
};
