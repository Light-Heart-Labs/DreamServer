const path = require("path");
const { redactSecrets } = require("./progressParser");
const { tierById, catalog } = require("./modelTier");
const { detectDreamServer, ensureModelDir } = require("./dreamServerInstall");
const { downloadModel } = require("./modelDownload");

function safeInstallDir(userDataPath, requested) {
  return path.resolve(String(requested || path.join(userDataPath, "dreamserver")).trim());
}

class InstallerRunner {
  constructor({ appRoot, userDataPath, stateStore, onEvent }) {
    this.appRoot = appRoot;
    this.userDataPath = userDataPath;
    this.stateStore = stateStore;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.running = false;
    this.cancelled = false;
  }

  isRunning() {
    return this.running;
  }

  async start(options = {}) {
    if (this.running) throw new Error("Preparacao de modelo ja esta em execucao.");
    this.running = true;
    this.cancelled = false;

    const installDir = safeInstallDir(this.userDataPath, options.installDir);
    const dreamServer = await detectDreamServer(this.userDataPath);
    const tier = tierById(options.tier || this.stateStore.state.selectedTier || "T1") || tierById("T1");
    const modelDir = await ensureModelDir(dreamServer);
    const logPath = path.join(this.stateStore.logsDir, `model-${Date.now()}.log`);

    await this.stateStore.save({
      status: "preparing_model",
      selectedMode: options.mode || "local",
      selectedTier: tier.id,
      installDir,
      dreamServer,
      lastRun: {
        startedAt: new Date().toISOString(),
        dryRun: Boolean(options.dryRun),
        logPath,
        command: "desktop-model-download",
        args: [redactSecrets(tier.downloadUrl || ""), tier.ggufFile].filter(Boolean)
      },
      modelDownload: {
        status: options.dryRun ? "dry_run" : "starting",
        modelName: tier.modelName,
        ggufFile: tier.ggufFile,
        modelPath: tier.ggufFile ? path.join(modelDir, tier.ggufFile) : "",
        modelDir,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: ""
      },
      localRoute: {
        provider: "custom",
        baseUrl: catalog.defaultLocalEndpoint,
        model: tier.modelName
      }
    });
    this.emit({ type: "installer:started", logPath, installDir, dryRun: Boolean(options.dryRun), phase: "model" });
    await this.log(`DreamServer ${dreamServer.installed ? "detectado" : "nao detectado"}: ${dreamServer.root || "usando pasta de modelos do app"}`);
    await this.log(`Tier DreamServer: ${tier.dreamTier} / ${tier.name}`);
    await this.log(`Modelo indicado: ${tier.modelName} (${tier.ggufFile || "cloud"})`);

    try {
      const result = await downloadModel({
        tier,
        modelDir,
        dryRun: Boolean(options.dryRun),
        onProgress: (progress) => {
          if (this.cancelled) throw new Error("Download cancelado.");
          const modelDownload = {
            status: progress.status,
            modelName: tier.modelName,
            ggufFile: tier.ggufFile,
            modelPath: progress.modelPath || path.join(modelDir, tier.ggufFile || ""),
            modelDir,
            bytesDownloaded: progress.bytesDownloaded || 0,
            totalBytes: progress.totalBytes || 0,
            percent: progress.percent || 0,
            error: ""
          };
          this.stateStore.save({ modelDownload }).catch(() => {});
          this.emit({ type: "installer:log", level: "info", raw: `${modelDownload.status} ${modelDownload.percent || 0}% ${tier.ggufFile}` });
          this.emit({ type: "installer:model-progress", modelDownload });
        }
      });

      const status = options.dryRun ? "dry_run_completed" : "model_ready";
      await this.stateStore.save({
        status,
        modelDownload: {
          status: result.status,
          modelName: tier.modelName,
          ggufFile: tier.ggufFile,
          modelPath: result.modelPath || "",
          modelDir,
          bytesDownloaded: result.bytesDownloaded || 0,
          totalBytes: result.totalBytes || 0,
          percent: 100,
          error: ""
        },
        lastRun: {
          ...this.stateStore.state.lastRun,
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          signal: "",
          error: ""
        }
      });
      await this.log(options.dryRun ? "Dry-run concluido. Nenhum modelo foi baixado." : "Modelo pronto para rota local.");
      this.emit({ type: "installer:finished", status, exitCode: 0, signal: "" });
      return this.stateStore.snapshot();
    } catch (error) {
      const message = error?.message || String(error);
      await this.stateStore.save({
        status: this.cancelled ? "cancelled" : "failed",
        modelDownload: {
          ...this.stateStore.state.modelDownload,
          status: this.cancelled ? "cancelled" : "failed",
          error: message
        },
        lastRun: {
          ...this.stateStore.state.lastRun,
          finishedAt: new Date().toISOString(),
          exitCode: this.cancelled ? 130 : 1,
          signal: this.cancelled ? "SIGTERM" : "",
          error: message
        }
      });
      await this.log(message, "error");
      this.emit({ type: "installer:finished", status: this.cancelled ? "cancelled" : "failed", exitCode: this.cancelled ? 130 : 1, signal: "" });
      return this.stateStore.snapshot();
    } finally {
      this.running = false;
    }
  }

  async cancel() {
    this.cancelled = true;
    if (!this.running) return this.stateStore.snapshot();
    await this.stateStore.save({ status: "cancelled", modelDownload: { ...this.stateStore.state.modelDownload, status: "cancelled" } });
    this.emit({ type: "installer:cancelled" });
    return this.stateStore.snapshot();
  }

  async log(line, level = "info") {
    await this.stateStore.appendLog({ level, line });
    this.emit({ type: "installer:log", level, raw: line });
  }

  emit(event) {
    this.onEvent(event);
  }
}

module.exports = { InstallerRunner, safeInstallDir };
