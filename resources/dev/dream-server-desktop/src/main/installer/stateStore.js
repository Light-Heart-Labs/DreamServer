const fs = require("fs/promises");
const path = require("path");

function defaultState() {
  return {
    version: 1,
    status: "not_started",
    selectedMode: "local",
    selectedTier: "",
    features: {},
    installDir: "",
    summaryJsonPath: "",
    lastScan: null,
    lastPreflight: null,
    lastRun: null,
    logs: [],
    dreamServer: null,
    modelDownload: {
      status: "idle",
      modelName: "",
      ggufFile: "",
      modelPath: "",
      modelDir: "",
      bytesDownloaded: 0,
      totalBytes: 0,
      percent: 0,
      error: ""
    },
    localRoute: {
      provider: "custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: ""
    }
  };
}

class InstallerStateStore {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.statePath = path.join(userDataPath, "install-state.json");
    this.logsDir = path.join(userDataPath, "install-logs");
    this.dreamserverDir = path.join(userDataPath, "dreamserver");
    this.state = defaultState();
  }
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      this.state = { ...defaultState(), ...raw, features: raw.features && typeof raw.features === "object" ? raw.features : {}, logs: Array.isArray(raw.logs) ? raw.logs.slice(-500) : [] };
    } catch {
      this.state = defaultState();
    }
    return this.snapshot();
  }
  snapshot() {
    return { ...this.state, statePath: this.statePath, logsDir: this.logsDir, dreamserverDir: this.dreamserverDir };
  }
  async save(patch = {}) {
    this.state = { ...this.state, ...patch, updatedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
    await fs.mkdir(this.dreamserverDir, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), "utf8");
    return this.snapshot();
  }
  async appendLog(entry) {
    const next = { at: new Date().toISOString(), level: entry.level || "info", line: String(entry.line || entry.raw || "") };
    this.state.logs = [...(this.state.logs || []), next].slice(-1000);
    await this.save({ logs: this.state.logs });
    return next;
  }
}

module.exports = { InstallerStateStore, defaultState };
