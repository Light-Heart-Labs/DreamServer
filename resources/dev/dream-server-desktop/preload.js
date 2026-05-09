const { contextBridge, ipcRenderer } = require("electron");

const desktopApi = {
  loadState: () => ipcRenderer.invoke("state:load"),
  getSystemDashboard: () => ipcRenderer.invoke("system:dashboard"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  clearApiKey: () => ipcRenderer.invoke("settings:clear-api-key"),
  createChat: () => ipcRenderer.invoke("chat:create"),
  selectChat: (chatId) => ipcRenderer.invoke("chat:select", chatId),
  deleteChat: (chatId) => ipcRenderer.invoke("chat:delete", chatId),
  stopChat: (chatId) => ipcRenderer.invoke("chat:stop", chatId),
  setChatProvider: (payload) => ipcRenderer.invoke("chat:set-provider", payload),
  pickAttachments: () => ipcRenderer.invoke("attachments:pick"),
  pickBackgroundMedia: () => ipcRenderer.invoke("background:pick-media"),
  listLocalModels: () => ipcRenderer.invoke("provider:list-local-models"),
  probeOpenAiModels: (payload) => ipcRenderer.invoke("provider:probe-openai-models", payload),
  getLocalLlamaStatus: () => ipcRenderer.invoke("provider:local-llama-status"),
  startLocalLlama: (payload) => ipcRenderer.invoke("provider:local-llama-start", payload),
  stopLocalLlama: () => ipcRenderer.invoke("provider:local-llama-stop"),
  getGatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  startGateway: () => ipcRenderer.invoke("gateway:start"),
  stopGateway: () => ipcRenderer.invoke("gateway:stop"),
  scanInstallerSystem: (payload) => ipcRenderer.invoke("installer:scan", payload),
  runInstallerPreflight: (payload) => ipcRenderer.invoke("installer:preflight", payload),
  startInstaller: (payload) => ipcRenderer.invoke("installer:start", payload),
  cancelInstaller: () => ipcRenderer.invoke("installer:cancel"),
  retryInstaller: () => ipcRenderer.invoke("installer:retry"),
  getInstallerStatus: () => ipcRenderer.invoke("installer:status"),
  getInstallerLogs: (payload) => ipcRenderer.invoke("installer:logs", payload),
  openInstallerDashboard: () => ipcRenderer.invoke("installer:open-dashboard"),
  openInstallerLogs: () => ipcRenderer.invoke("installer:open-logs"),
  openInstallerDataFolder: () => ipcRenderer.invoke("installer:open-data-folder"),
  exportInstallerDiagnostic: () => ipcRenderer.invoke("installer:diagnostic-report"),
  sendMessage: (payload) => ipcRenderer.invoke("manus:send", payload),
  syncChat: (chatId) => ipcRenderer.invoke("manus:sync", chatId),
  runDesktopAction: (payload) => ipcRenderer.invoke("desktop:run-action", payload),
  stopAllLocalActivity: () => ipcRenderer.invoke("desktop:stop-all-local-activity"),
  stopBackgroundJob: (jobId) => ipcRenderer.invoke("desktop:stop-background-job", jobId),
  closeTerminalSession: (sessionId) => ipcRenderer.invoke("desktop:close-terminal-session", sessionId),
  saveCodeFile: (payload) => ipcRenderer.invoke("code:save-file", payload),
  ensureMobilePreviewService: (payload) => ipcRenderer.invoke("preview:ensure-mobile-service", payload),
  setPreviewMode: (payload) => ipcRenderer.invoke("preview:set-mode", payload),
  requestPreviewHarness: (payload) => ipcRenderer.invoke("preview-harness:request", payload),
  completePreviewHarnessCommand: (payload) => ipcRenderer.invoke("preview-harness:result", payload),
  wakeDreamPet: () => ipcRenderer.invoke("pet:wake"),
  resetDreamPet: () => ipcRenderer.invoke("pet:reset"),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onRuntimeEvent: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on("runtime:event", handler);
    return () => ipcRenderer.removeListener("runtime:event", handler);
  },
  onInstallerEvent: (listener) => {
    const handler = (_, payload) => {
      if (payload?.type === "installer:event") listener(payload.installer || payload);
    };
    ipcRenderer.on("runtime:event", handler);
    return () => ipcRenderer.removeListener("runtime:event", handler);
  },
  onPreviewHarnessCommand: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on("preview-harness:command", handler);
    return () => ipcRenderer.removeListener("preview-harness:command", handler);
  }
};

contextBridge.exposeInMainWorld("dreamDesktop", desktopApi);
contextBridge.exposeInMainWorld("manusDesktop", desktopApi);
