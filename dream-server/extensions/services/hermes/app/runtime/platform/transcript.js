const DEFAULT_MAX_ENTRIES = 180;
const DEFAULT_MAX_TEXT = 1600;

function compactText(value, limit = DEFAULT_MAX_TEXT) {
  const text = String(value || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 18))}... [truncated]`;
}

class AgentTranscript {
  constructor(options = {}) {
    this.maxEntries = Number.isFinite(Number(options.maxEntries))
      ? Number(options.maxEntries)
      : DEFAULT_MAX_ENTRIES;
    this.entries = [];
  }

  add(type, payload = {}) {
    const entry = {
      type: String(type || "event"),
      timestamp: Date.now(),
      ...payload
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entry;
  }

  phase(phase, summary = "") {
    return this.add("phase", {
      phase,
      summary: compactText(summary, 500)
    });
  }

  tool(action, result, ok) {
    return this.add("tool", {
      tool: String(action?.type || ""),
      ok: Boolean(ok),
      summary: compactText(result, 700)
    });
  }

  provider(role, text) {
    return this.add("provider", {
      role: String(role || "assistant"),
      summary: compactText(text, 1000)
    });
  }

  recent(limit = 12) {
    return this.entries.slice(-Math.max(1, Number(limit) || 12));
  }

  summarize(limit = 12) {
    return this.recent(limit)
      .map((entry) => {
        if (entry.type === "phase") {
          return `phase:${entry.phase} ${entry.summary || ""}`.trim();
        }
        if (entry.type === "tool") {
          return `tool:${entry.ok ? "ok" : "fail"} ${entry.tool} ${entry.summary || ""}`.trim();
        }
        if (entry.type === "provider") {
          return `provider:${entry.role} ${entry.summary || ""}`.trim();
        }
        return `${entry.type}: ${compactText(JSON.stringify(entry), 700)}`;
      })
      .join("\n");
  }
}

module.exports = {
  AgentTranscript,
  compactText
};
