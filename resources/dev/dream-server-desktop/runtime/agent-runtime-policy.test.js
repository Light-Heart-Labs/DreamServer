const assert = require("assert");
const os = require("os");
const path = require("path");
const { AgentRuntime } = require("./agent-runtime");

function createRuntimeStub() {
  return {
    state: {
      projects: [],
      settings: {}
    },
    pendingBatches: new Map(),
    _getLatestVisibleUserText() {
      return "";
    },
    _getChatWorkspaceRoot() {
      return process.cwd();
    },
    _emitRuntimeEvent() {},
    _isSelfContainedAction(action) {
      return ["launch_app", "open_url", "open_path", "reveal_path", "set_volume", "media_control"].includes(
        String(action?.type || "")
      );
    },
    _looksLikeNoOpResult() {
      return false;
    },
    getChat(chatId) {
      return { id: chatId, messages: [], localEvents: [] };
    },
    findRecentProject() {
      return null;
    },
    _finalizeAssistantMessage() {
      return { status: "runtime_final" };
    }
  };
}

const runtime = new AgentRuntime(createRuntimeStub());

const qrImagePath = path.join(os.tmpdir(), "dream-server-hermes-test", "whatsapp", "qr.svg");
const gatewayQrAppendix = runtime._appendGatewayQrAppendix("Encontrei o QR.", [
  {
    name: "dream_gateway",
    result: JSON.stringify({
      result: `QR Code do WhatsApp:\n\n![QR Code do WhatsApp](${qrImagePath})`
    })
  }
]);
assert.ok(gatewayQrAppendix.includes(`![QR Code do WhatsApp](${qrImagePath})`));

const answerOnlyState = {
  routeId: "coding-project",
  lastActions: [],
  evidence: [],
  phase: "plan",
  iteration: 0,
  maxIterations: 8
};
assert.equal(runtime._requiresOperationalEvidence(answerOnlyState), false);
assert.equal(runtime._needsMoreEvidence(answerOnlyState, { id: "chat" }), false);

const siteState = {
  routeId: "general-purpose",
  lastActions: [{ type: "verify_site", url: "http://127.0.0.1:4173" }],
  evidence: [{ kind: "site", ok: true, actionType: "verify_site" }],
  phase: "observe",
  iteration: 1,
  maxIterations: 8
};
assert.equal(runtime._requiresOperationalEvidence(siteState), true);
assert.equal(runtime._requiresSiteEvidence(siteState), true);
assert.equal(runtime._hasSufficientEvidenceForFinal(siteState), true);
assert.equal(
  runtime.shouldContinueAfterBatch(
    {
      chatId: "chat",
      continueAfterExecution: true,
      runState: siteState,
      actions: siteState.lastActions
    },
    [{ action: siteState.lastActions[0], ok: true, result: "VERIFICATION PASSED" }]
  ),
  false
);

const openUrlState = {
  routeId: "general-purpose",
  lastActions: [{ type: "open_url", url: "https://example.com" }],
  evidence: [{ kind: "desktop", ok: true, actionType: "open_url" }],
  phase: "observe",
  iteration: 1,
  maxIterations: 8
};
assert.equal(runtime._requiresSiteEvidence(openUrlState), false);
assert.equal(runtime._hasSufficientEvidenceForFinal(openUrlState), true);

const contractFailure = runtime._validateActionBatchContract([{ type: "open_path", path: "" }]);
assert.equal(contractFailure.ok, false);

const contractSuccess = runtime._validateActionBatchContract([{ type: "media_control", action: "play" }]);
assert.equal(contractSuccess.ok, true);

console.log("agent-runtime policy tests passed");
