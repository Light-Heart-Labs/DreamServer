const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { normalizeToolResult } = require("../tool-registry");
const { getToolRegistry } = require("../tools");
const { RuntimeCallbacks } = require("./callbacks");
const { compactText } = require("./transcript");

const DEFAULT_RESULT_THRESHOLD = 120_000;
const DEFAULT_PREVIEW_CHARS = 14_000;

function safeToolId(action = {}) {
  const name = String(action.type || "tool").replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 60) || "tool";
  return `${Date.now()}-${name}-${crypto.randomBytes(4).toString("hex")}`;
}

function stringifyResult(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

class ToolRuntime {
  constructor(options = {}) {
    if (typeof options.executeTool !== "function") {
      throw new TypeError("ToolRuntime requires executeTool(action, context).");
    }
    this.executeTool = options.executeTool;
    this.registry = options.registry || getToolRegistry();
    this.callbacks = options.callbacks || new RuntimeCallbacks();
    this.resultThreshold = Number.isFinite(Number(options.resultThreshold))
      ? Number(options.resultThreshold)
      : DEFAULT_RESULT_THRESHOLD;
    this.previewChars = Number.isFinite(Number(options.previewChars))
      ? Number(options.previewChars)
      : DEFAULT_PREVIEW_CHARS;
    this.resultRoot = path.resolve(options.resultRoot || path.join(os.tmpdir(), "dream-server-tool-results"));
  }

  checkAvailability(action, context = {}) {
    const type = String(action?.type || "").trim();
    if (!type) {
      return { available: false, reason: "Ferramenta sem type." };
    }
    return this.registry.checkAvailability(type, context);
  }

  async execute(action, context = {}) {
    const actionKey = String(context.actionKey || safeToolId(action));
    const type = String(action?.type || "").trim();
    const availability = this.checkAvailability(action, context);
    if (!availability.available) {
      const result = `Ferramenta indisponivel: ${type}. ${availability.reason}`;
      const structuredResult = normalizeToolResult(action, false, result, this.registry);
      this.callbacks.safeEmit("tool_finished", {
        actionKey,
        action,
        ok: false,
        result,
        structuredResult,
        unavailable: true
      });
      return { ok: false, result, structuredResult, unavailable: true };
    }

    this.callbacks.safeEmit("tool_started", { actionKey, action });
    try {
      const rawResult = await this.executeTool(action, context);
      const result = await this.maybePersistResult(action, actionKey, rawResult);
      const structuredResult = normalizeToolResult(action, true, result, this.registry);
      this.callbacks.safeEmit("tool_finished", {
        actionKey,
        action,
        ok: true,
        result,
        structuredResult
      });
      return { ok: true, result, structuredResult };
    } catch (error) {
      const result = error?.message || "Erro ao executar a ferramenta.";
      const structuredResult = normalizeToolResult(action, false, result, this.registry);
      this.callbacks.safeEmit("tool_finished", {
        actionKey,
        action,
        ok: false,
        result,
        structuredResult,
        error
      });
      return { ok: false, result, structuredResult, error };
    }
  }

  async maybePersistResult(action, actionKey, rawResult) {
    const content = stringifyResult(rawResult);
    if (content.length <= this.resultThreshold) {
      return rawResult;
    }

    const toolName = String(action?.type || "tool").replace(/[^a-z0-9_.-]+/gi, "-") || "tool";
    const fileName = `${String(actionKey || safeToolId(action)).replace(/[^a-z0-9_.-]+/gi, "-")}-${toolName}.txt`;
    const filePath = path.join(this.resultRoot, fileName);
    await fs.mkdir(this.resultRoot, { recursive: true });
    await fs.writeFile(filePath, content, "utf8");

    const preview = compactText(content, this.previewChars);
    return [
      `<persisted-output>`,
      `Tool result was too large (${content.length.toLocaleString()} chars).`,
      `Full output saved to: ${filePath}`,
      "",
      `Preview:`,
      preview,
      `</persisted-output>`
    ].join("\n");
  }
}

module.exports = {
  ToolRuntime,
  stringifyResult
};
