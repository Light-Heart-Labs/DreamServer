const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function projectRootFromRuntime() {
  const root = path.resolve(__dirname, "..", "..");
  return root.includes("app.asar")
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;
}

function defaultHermesRoot() {
  return process.env.DREAM_HERMES_ROOT || path.join(projectRootFromRuntime(), "vendor", "hermes-agent");
}

function bridgeRunnerPath() {
  return path.join(projectRootFromRuntime(), "runtime", "hermes", "bridge_runner.py");
}

function defaultWorkspaceRoot() {
  return path.join(os.homedir(), "Documents", "DreamServerProjects");
}

const PATH_GLYPH_REPLACEMENTS = Object.freeze({
  "\uF03A": ":",
  "\uFF1A": ":",
  "\uFE55": ":",
  "\uA789": ":",
  "\u2236": ":",
  "\uF05C": "\\",
  "\uFF3C": "\\",
  "\u2216": "\\",
  "\u29F5": "\\",
  "\u2044": "/",
  "\u2215": "/",
  "\uFF0F": "/"
});

function normalizePathText(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\uF03A\uFF1A\uFE55\uA789\u2236\uF05C\uFF3C\u2216\u29F5\u2044\u2215\uFF0F]/g, (char) => PATH_GLYPH_REPLACEMENTS[char] || char)
    .replace(/^([a-zA-Z])\s*:\s*[\\/]+/, (_, drive) => `${drive}:\\`);
  if (process.platform !== "win32") {
    return normalized;
  }
  const wslDrive = normalized.match(/^[/\\]mnt[/\\]([a-zA-Z])(?=$|[/\\])([\s\S]*)$/i);
  const msysDrive = normalized.match(/^[/\\]([a-zA-Z])(?=$|[/\\])([\s\S]*)$/);
  const match = wslDrive || msysDrive;
  if (!match) {
    return normalized;
  }
  const rest = String(match[2] || "").replace(/^[/\\]+/, "").replace(/[\\/]+/g, "\\");
  return `${match[1].toUpperCase()}:\\${rest}`;
}

function normalizeWorkspaceRoot(value) {
  return path.resolve(normalizePathText(value) || defaultWorkspaceRoot());
}

function windowsToWslPath(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return "";
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/[\\/]+/g, "/")}`;
}

function nonEmptyText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildEmptyResponseFallback(result, events) {
  const errorEvent = [...events].reverse().find((event) => event.type === "error");
  const stoppedEvent = [...events].reverse().find((event) => event.type === "stopped");
  const eventMessage = errorEvent?.message || stoppedEvent?.reason || "";
  const processOutput = nonEmptyText(result?.stderr, summarizeStdout(result?.stdout));

  return nonEmptyText(
    eventMessage,
    processOutput,
    `Hermes finalizou sem resposta visivel (exitCode=${result?.exitCode ?? "desconhecido"}).`
  );
}

function summarizeStdout(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !parseJsonLine(line));
  const text = lines.join("\n").trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function pythonCandidates() {
  const envPython = String(process.env.DREAM_HERMES_PYTHON || "").trim();
  const projectRoot = projectRootFromRuntime();
  const candidates = [];
  if (envPython) {
    candidates.push({ command: envPython, args: [] });
  }
  candidates.push({ command: path.join(projectRoot, ".venv-hermes", "Scripts", "python.exe"), args: [] });
  candidates.push({ command: path.join(projectRoot, ".venv-hermes", "bin", "python"), args: [] });
  candidates.push({ command: path.join(projectRoot, ".venv-hermes", "bin", "python3"), args: [] });
  candidates.push(
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] }
  );
  return candidates;
}

function parseJsonLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function createAbortError() {
  const error = new Error("Hermes execution aborted.");
  error.name = "AbortError";
  return error;
}

function normalizeStreamDelta(state, rawDelta) {
  const raw = String(rawDelta || "");
  if (!raw) {
    return "";
  }

  state.lastRaw = state.lastRaw || "";
  state.text = state.text || "";

  if (raw === state.lastRaw) {
    return "";
  }

  if (raw.startsWith(state.text)) {
    const next = raw.slice(state.text.length);
    state.lastRaw = raw;
    state.text = raw;
    return next;
  }

  const maxOverlap = Math.min(state.text.length, raw.length);
  for (let size = maxOverlap; size >= 8; size -= 1) {
    if (state.text.endsWith(raw.slice(0, size))) {
      const next = raw.slice(size);
      state.lastRaw = raw;
      state.text += next;
      return next;
    }
  }

  state.lastRaw = raw;
  state.text += raw;
  return raw;
}

class HermesBackend {
  constructor(options = {}) {
    this.hermesRoot = path.resolve(options.hermesRoot || process.env.DREAM_HERMES_ROOT || defaultHermesRoot());
    this.runnerPath = path.resolve(options.runnerPath || bridgeRunnerPath());
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Number(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
    this.python = options.python || null;
  }

  async doctor(options = {}) {
    const errors = [];
    for (const candidate of this._pythonCandidates()) {
      try {
        const result = await this._runJsonProcess({
          command: candidate.command,
          args: [...candidate.args, this.runnerPath, "--doctor", "--hermes-root", this.hermesRoot],
          input: "",
          timeoutMs: options.timeoutMs || 20000
        });
        const doctorEvent = result.events.find((event) => event.type === "doctor");
        if (doctorEvent?.ok) {
          this.python = candidate;
          return {
            ...doctorEvent,
            command: candidate.command,
            args: candidate.args
          };
        }
        errors.push(doctorEvent?.error || result.stderr || `${candidate.command} nao conseguiu importar Hermes.`);
      } catch (error) {
        errors.push(`${candidate.command}: ${error.message}`);
      }
    }

    return {
      type: "doctor",
      ok: false,
      importable: false,
      hermesRoot: this.hermesRoot,
      python: null,
      error: errors.filter(Boolean).join(" | ") || "Nenhum Python compativel encontrado."
    };
  }

  async sendTurn(request = {}) {
    const doctor = await this.doctor({ timeoutMs: request.doctorTimeoutMs || 20000 });
    if (!doctor.ok) {
      return {
        ok: false,
        assistantText: [
          "Hermes Agent esta vendorizado neste projeto, mas o ambiente Python/dependencias ainda nao esta pronto.",
          `Diagnostico: ${doctor.error}`,
          "Instale o ambiente do Hermes ou configure DREAM_HERMES_PYTHON para o Python/WSL correto."
        ].join("\n"),
        actions: [],
        status: "blocked",
        events: [{ type: "error", message: doctor.error }]
      };
    }

    const candidate = this.python || {
      command: doctor.command,
      args: doctor.args || []
    };
    const workspaceRoot = normalizeWorkspaceRoot(request.workspaceRoot || defaultWorkspaceRoot());
    const payload = {
      hermesRoot: this.hermesRoot,
      inputText: request.inputText || "",
      workspaceRoot,
      baseUrl: request.baseUrl || "",
      model: request.model || "",
      apiKey: request.apiKey || null,
      provider: request.provider || null,
      apiMode: request.apiMode || null,
      providersAllowed: request.providersAllowed || null,
      providersIgnored: request.providersIgnored || null,
      providersOrder: request.providersOrder || null,
      providerSort: request.providerSort || null,
      providerRequireParameters: Boolean(request.providerRequireParameters),
      providerDataCollection: request.providerDataCollection || null,
      maxIterations: request.maxIterations || 12,
      maxTokens: request.maxTokens || null,
      reasoningConfig: request.reasoningConfig || null,
      requestOverrides: request.requestOverrides || null,
      enabledToolsets: Object.prototype.hasOwnProperty.call(request, "enabledToolsets")
        ? request.enabledToolsets
        : null,
      disabledToolsets: request.disabledToolsets || [],
      ephemeralSystemPrompt: request.ephemeralSystemPrompt || null,
      sessionId: request.sessionId || null,
      taskId: request.taskId || null,
      conversationHistory: request.conversationHistory || null,
      skipContextFiles: Boolean(request.skipContextFiles),
      desktopIntegrationEnabled: Boolean(request.desktopIntegrationEnabled),
      platform: request.platform || (request.desktopIntegrationEnabled ? "desktop" : "cli"),
      hostPlatform: process.platform,
      hostRelease: os.release(),
      hostLocale: request.locale || Intl.DateTimeFormat().resolvedOptions().locale || ""
    };

    const events = [];
    let finalResponse = "";
    const streamState = { text: "", lastRaw: "" };
    const result = await this._runJsonProcess({
      command: candidate.command,
      args: [...(candidate.args || []), this.runnerPath, "--hermes-root", this.hermesRoot],
      input: JSON.stringify(payload),
      timeoutMs: request.timeoutMs || this.timeoutMs,
      signal: request.signal,
      desktopIntegrationEnabled: Boolean(request.desktopIntegrationEnabled),
      workspaceRoot: payload.workspaceRoot,
      hostLocale: payload.hostLocale,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "text_delta" && request.onTextDelta) {
          const delta = normalizeStreamDelta(streamState, event.delta || "");
          if (delta) {
            request.onTextDelta(delta);
          }
        }
        if (event.type === "final") {
          finalResponse = event.finalResponse || "";
        }
        if (request.onEvent) {
          request.onEvent(event);
        }
      }
    });

    const finalEvent = [...events].reverse().find((event) => event.type === "final");
    const errorEvent = events.find((event) => event.type === "error");
    const assistantText =
      finalResponse ||
      finalEvent?.finalResponse ||
      errorEvent?.message ||
      result.stderr ||
      buildEmptyResponseFallback(result, events);

    return {
      ok: Boolean(finalEvent?.ok) && result.exitCode === 0,
      assistantText,
      actions: [],
      status: result.exitCode === 0 && finalEvent?.ok !== false ? "stopped" : "blocked",
      events,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    };
  }

  _pythonCandidates() {
    if (this.python) {
      return [this.python];
    }
    return pythonCandidates();
  }

  _runJsonProcess(options = {}) {
    return new Promise((resolve, reject) => {
      const desktopIntegrationEnabled = Boolean(options.desktopIntegrationEnabled);
      const workspaceRoot = options.workspaceRoot ? normalizeWorkspaceRoot(options.workspaceRoot) : "";
      const posixWorkspaceRoot = windowsToWslPath(workspaceRoot);
      const env = {
        ...process.env,
        DREAM_HERMES_ROOT: this.hermesRoot,
        DREAM_HERMES_SKILLS_DIR: path.join(this.hermesRoot, "skills"),
        HERMES_OPTIONAL_SKILLS: process.env.HERMES_OPTIONAL_SKILLS || path.join(this.hermesRoot, "optional-skills"),
        HERMES_MINIMUM_CONTEXT_LENGTH: process.env.HERMES_MINIMUM_CONTEXT_LENGTH || "16384",
        DREAM_HOST_PLATFORM: process.platform,
        DREAM_HOST_OS_RELEASE: os.release(),
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      };
      if (options.hostLocale) {
        env.DREAM_HOST_LOCALE = options.hostLocale;
      }
      if (workspaceRoot) {
        env.DREAM_WORKSPACE_ROOT = workspaceRoot;
        env.DREAM_PROJECTS_ROOT = workspaceRoot;
        env.HERMES_WORKSPACE_ROOT = workspaceRoot;
      }
      if (posixWorkspaceRoot) {
        env.DREAM_WORKSPACE_ROOT_POSIX = posixWorkspaceRoot;
        env.DREAM_PROJECTS_ROOT_POSIX = posixWorkspaceRoot;
      }
      if (desktopIntegrationEnabled) {
        env.DREAM_DESKTOP_INTEGRATION_ENABLED = "1";
        env.DREAM_DESKTOP_ROOT = projectRootFromRuntime();
        env.DREAM_DESKTOP_NODE = process.execPath;
        env.DREAM_DESKTOP_NODE_RUN_AS_NODE = "1";
        env.DREAM_BROWSER_BACKEND = process.env.DREAM_BROWSER_BACKEND || "desktop";
        if (process.env.DREAM_PREVIEW_CONTROL_PATH) {
          env.DREAM_PREVIEW_CONTROL_PATH = process.env.DREAM_PREVIEW_CONTROL_PATH;
        }
        if (process.env.DREAM_DESKTOP_BRIDGE_FILE) {
          env.DREAM_DESKTOP_BRIDGE_FILE = process.env.DREAM_DESKTOP_BRIDGE_FILE;
        }
        if (process.env.DREAM_DESKTOP_BRIDGE_PORT) {
          env.DREAM_DESKTOP_BRIDGE_PORT = process.env.DREAM_DESKTOP_BRIDGE_PORT;
        }
        if (process.env.DREAM_DESKTOP_BRIDGE_TOKEN) {
          env.DREAM_DESKTOP_BRIDGE_TOKEN = process.env.DREAM_DESKTOP_BRIDGE_TOKEN;
        }
      } else {
        env.DREAM_DESKTOP_INTEGRATION_ENABLED = "0";
      }

      const child = spawn(options.command, options.args || [], {
        cwd: projectRootFromRuntime(),
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let buffer = "";
      const events = [];
      let settled = false;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener("abort", abort);
        }
        fn(value);
      };

      const abort = () => {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, createAbortError());
      };

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, new Error(`Hermes demorou mais de ${Math.round((options.timeoutMs || this.timeoutMs) / 1000)}s para responder.`));
      }, options.timeoutMs || this.timeoutMs);

      if (options.signal) {
        if (options.signal.aborted) {
          abort();
          return;
        }
        options.signal.addEventListener("abort", abort, { once: true });
      }

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdout += text;
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const event = parseJsonLine(line);
          if (event) {
            events.push(event);
            if (options.onEvent) {
              options.onEvent(event);
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        finish(reject, error);
      });

      child.on("close", (exitCode) => {
        const trailingEvent = parseJsonLine(buffer);
        if (trailingEvent) {
          events.push(trailingEvent);
          if (options.onEvent) {
            options.onEvent(trailingEvent);
          }
        }
        finish(resolve, {
          exitCode,
          stdout,
          stderr,
          events
        });
      });

      if (typeof options.input === "string" && options.input.length) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }
}

module.exports = {
  HermesBackend,
  defaultHermesRoot,
  bridgeRunnerPath
};
