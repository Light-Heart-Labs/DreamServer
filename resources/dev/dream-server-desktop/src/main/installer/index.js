const fs = require("fs/promises");
const path = require("path");
const { shell } = require("electron");
const { InstallerStateStore } = require("./stateStore");
const { scanSystem } = require("./systemDetection");
const { buildPreflight } = require("./preflight");
const { recommendModel, catalog } = require("./modelTier");
const { InstallerRunner } = require("./runner");
const { getServiceStatus } = require("./serviceStatus");
const { detectDreamServer } = require("./dreamServerInstall");

class DesktopInstallerManager {
  constructor({ appRoot, userDataPath, broadcast }) {
    this.appRoot = appRoot;
    this.userDataPath = userDataPath;
    this.broadcast = typeof broadcast === "function" ? broadcast : () => {};
    this.store = new InstallerStateStore(userDataPath);
    this.runner = new InstallerRunner({
      appRoot,
      userDataPath,
      stateStore: this.store,
      onEvent: (event) => this.broadcast({ type: "installer:event", installer: event })
    });
  }
  async init() { await this.store.load(); return this.status(); }
  async scan(options = {}) {
    const profile = await scanSystem({ installDir: options.installDir || this.store.snapshot().dreamserverDir });
    const dreamServer = await detectDreamServer(this.userDataPath);
    const recommendation = recommendModel(profile, options);
    await this.store.save({ lastScan: profile, dreamServer, selectedTier: recommendation.tier.id, selectedMode: recommendation.mode });
    return { profile, recommendation, state: this.store.snapshot() };
  }
  async preflight(options = {}) {
    const profile = options.profile || this.store.state.lastScan || await scanSystem({ installDir: this.store.snapshot().dreamserverDir });
    const result = buildPreflight(profile, options);
    const dreamServer = await detectDreamServer(this.userDataPath);
    await this.store.save({ lastScan: profile, dreamServer, lastPreflight: result });
    return { ...result, profile, state: this.store.snapshot() };
  }
  async start(options = {}) { return this.runner.start(options); }
  async retry() {
    const last = this.store.state.lastRun || {};
    return this.start({ mode: this.store.state.selectedMode || "local", tier: this.store.state.selectedTier || "", features: this.store.state.features || {}, installDir: this.store.state.installDir || this.store.snapshot().dreamserverDir, noBootstrap: Boolean(last.noBootstrap), dryRun: Boolean(last.dryRun) });
  }
  async cancel() { return this.runner.cancel(); }
  async status() { return { state: this.store.snapshot(), running: this.runner.isRunning(), catalog, services: await getServiceStatus({ installDir: this.store.state.installDir }) }; }
  async logs(options = {}) {
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 1000)));
    return { logs: (this.store.state.logs || []).slice(-limit), logsDir: this.store.logsDir, statePath: this.store.statePath };
  }
  async openDashboard() {
    const endpoints = (await getServiceStatus({ installDir: this.store.state.installDir })).endpoints;
    const dashboard = endpoints.find((entry) => entry.id === "dashboard") || endpoints[0];
    if (dashboard?.url) await shell.openExternal(dashboard.url);
    return { ok: Boolean(dashboard?.url), url: dashboard?.url || "" };
  }
  async openLogs() { await fs.mkdir(this.store.logsDir, { recursive: true }); await shell.openPath(this.store.logsDir); return { ok: true, path: this.store.logsDir }; }
  async openDataFolder() { await fs.mkdir(this.store.dreamserverDir, { recursive: true }); await shell.openPath(this.store.dreamserverDir); return { ok: true, path: this.store.dreamserverDir }; }
  async diagnosticReport() {
    const payload = { generatedAt: new Date().toISOString(), state: this.store.snapshot(), status: await this.status() };
    const reportPath = path.join(this.userDataPath, `installer-diagnostic-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(payload, null, 2), "utf8");
    return { ok: true, path: reportPath, report: payload };
  }
}
module.exports = { DesktopInstallerManager };
