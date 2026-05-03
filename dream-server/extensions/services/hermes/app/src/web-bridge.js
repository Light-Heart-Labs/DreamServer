(() => {
  "use strict";

  const runtimeListeners = new Set();
  const previewHarnessListeners = new Set();
  const uploadPathMap = new Map();
  const AUTH_COOKIE_NAME = "dream_hermes_token";

  function readCookie(name) {
    const prefix = `${name}=`;
    return document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || "";
  }

  function authToken() {
    try {
      return decodeURIComponent(readCookie(AUTH_COOKIE_NAME));
    } catch {
      return readCookie(AUTH_COOKIE_NAME);
    }
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    if (!response.ok) {
      const message = payload && typeof payload === "object" && payload.error
        ? payload.error
        : `Hermes service returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  async function request(path, options = {}) {
    const init = {
      method: options.method || "GET",
      headers: { ...(options.headers || {}) }
    };
    const token = authToken();
    if (token) {
      init.headers["x-dream-hermes-token"] = token;
    }
    if (Object.prototype.hasOwnProperty.call(options, "body")) {
      if (options.body instanceof FormData) {
        init.body = options.body;
      } else {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(options.body || {});
      }
    }
    return parseResponse(await fetch(path, init));
  }

  function post(path, payload = {}) {
    return request(path, { method: "POST", body: payload });
  }

  function rememberUpload(file) {
    if (file?.url && file?.path) {
      uploadPathMap.set(file.url, file.path);
    }
    return {
      ...file,
      serverPath: file.path,
      path: file.url || file.path
    };
  }

  async function uploadFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) {
      return [];
    }
    const form = new FormData();
    selected.forEach((file) => form.append("files", file, file.name));
    const response = await request("/api/uploads", { method: "POST", body: form });
    return (response.files || []).map(rememberUpload);
  }

  function pickFiles({ accept = "", multiple = false } = {}) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.display = "none";
      input.multiple = Boolean(multiple);
      if (accept) {
        input.accept = accept;
      }
      input.addEventListener("change", async () => {
        try {
          resolve(await uploadFiles(input.files));
        } catch (error) {
          reject(error);
        } finally {
          input.remove();
        }
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  function mapAttachmentPaths(paths) {
    return Array.isArray(paths)
      ? paths.map((entry) => uploadPathMap.get(entry) || entry).filter(Boolean)
      : [];
  }

  function callListeners(listeners, payload) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function connectEvents() {
    if (!window.EventSource) {
      return;
    }
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.channel === "runtime:event") {
        callListeners(runtimeListeners, message.payload);
      }
      if (message.channel === "preview-harness:command") {
        callListeners(previewHarnessListeners, message.payload);
      }
    };
  }

  const desktopApi = {
    loadState: () => request("/api/state"),
    getSystemDashboard: () => request("/api/system"),
    saveSettings: (payload) => post("/api/settings", payload),
    clearApiKey: () => post("/api/settings/clear-api-key"),
    createChat: () => post("/api/chats"),
    selectChat: (chatId) => post("/api/chats/select", { chatId }),
    deleteChat: (chatId) => post("/api/chats/delete", { chatId }),
    stopChat: (chatId) => post("/api/chats/stop", { chatId }),
    setChatProvider: (payload) => post("/api/chats/set-provider", payload),
    pickAttachments: () => pickFiles({ multiple: true }),
    pickBackgroundMedia: async () => {
      const files = await pickFiles({ accept: "image/*", multiple: false });
      return files[0] || null;
    },
    listLocalModels: () => request("/api/provider/local-models"),
    getLocalLlamaStatus: () => request("/api/provider/local-llama-status"),
    startLocalLlama: (payload) => post("/api/provider/local-llama-start", payload),
    stopLocalLlama: () => post("/api/provider/local-llama-stop"),
    sendMessage: (payload = {}) => post("/api/chats/send", {
      ...payload,
      attachmentPaths: mapAttachmentPaths(payload.attachmentPaths)
    }),
    syncChat: () => request("/api/chats/sync"),
    runDesktopAction: (payload) => post("/api/desktop/run-action", payload),
    stopAllLocalActivity: () => post("/api/desktop/stop-all-local-activity"),
    stopBackgroundJob: (jobId) => post("/api/desktop/stop-background-job", { jobId }),
    closeTerminalSession: (sessionId) => post("/api/desktop/close-terminal-session", { sessionId }),
    saveCodeFile: (payload) => post("/api/code/save-file", payload),
    ensureMobilePreviewService: (payload) => post("/api/preview/ensure-mobile-service", payload),
    setPreviewMode: (payload) => post("/api/preview/set-mode", payload),
    requestPreviewHarness: (payload) => post("/api/preview-harness/request", payload),
    completePreviewHarnessCommand: (payload) => post("/api/preview-harness/result", payload),
    openExternal: async (target) => {
      const url = String(target || "").trim();
      if (!url) {
        return false;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
    minimizeWindow: async () => false,
    maximizeWindow: async () => false,
    closeWindow: async () => false,
    onRuntimeEvent: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    onPreviewHarnessCommand: (listener) => {
      previewHarnessListeners.add(listener);
      return () => previewHarnessListeners.delete(listener);
    }
  };

  window.dreamDesktop = desktopApi;
  connectEvents();
})();
