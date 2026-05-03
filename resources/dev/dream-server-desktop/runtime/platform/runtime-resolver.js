"use strict";

/**
 * Runtime Resolver — detects the current platform/arch and returns correct
 * paths for bundled runtimes (Python venv, llama binaries, etc.).
 *
 * Works across all three deployment modes:
 *   - Electron desktop (dev + packaged app.asar)
 *   - CLI  (node ./bin/dream.js)
 *   - gRPC server (node ./runtime/grpc-server.js)
 *
 * Canonical platform keys used for directory naming:
 *   darwin-arm64 | darwin-x64 | linux-x64 | win32-x64
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const PLATFORM = process.platform; // "darwin" | "linux" | "win32"
const ARCH = process.arch; // "x64" | "arm64"
const PLATFORM_KEY = `${PLATFORM}-${ARCH}`;

// ---------------------------------------------------------------------------
// App root — works in dev and in packaged (app.asar.unpacked) mode
// ---------------------------------------------------------------------------

/**
 * Absolute path to the project root directory.
 * In packaged mode, binary assets live in app.asar.unpacked, not app.asar.
 */
function appRoot() {
  const dir = path.resolve(__dirname, "..", "..");
  return dir.includes("app.asar")
    ? dir.replace("app.asar", "app.asar.unpacked")
    : dir;
}

/**
 * True when running inside a packaged Electron application.
 * Gracefully returns false in CLI / gRPC contexts where `electron` is absent.
 */
function isPackaged() {
  try {
    return Boolean(require("electron").app?.isPackaged);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Legacy directory aliases
// ---------------------------------------------------------------------------

/**
 * Maps canonical platform keys to the directory names that already exist
 * in this repo (created before the canonical naming scheme was adopted).
 */
const LEGACY_LLAMA_DIRS = {
  "darwin-arm64": "mac-arm64",
  "darwin-x64": "mac-x86_64",
  "win32-x64": "cuda-12.4",
  "linux-x64": "linux-x86_64",
};

// ---------------------------------------------------------------------------
// Python resolver
// ---------------------------------------------------------------------------

/**
 * Returns an ordered list of Python interpreter candidates for Hermes Agent.
 *
 * Priority:
 *   1. DREAM_HERMES_PYTHON env var  (developer / CI override)
 *   2. Hermes venv                  (created on first use or by `npm run setup:hermes`)
 *   3. Bundled standalone Python    (packaged in `resources/python/<platform-key>/`)
 *   4. System Python 3 commands     (last resort — packages not guaranteed)
 *
 * Each candidate: { command: string, args: string[], source: string }
 */
function pushUniqueCandidate(results, candidate) {
  if (!candidate?.command) {
    return;
  }
  const key = `${candidate.command}\0${(candidate.args || []).join("\0")}`;
  if (results.some((entry) => `${entry.command}\0${(entry.args || []).join("\0")}` === key)) {
    return;
  }
  results.push(candidate);
}

function userDataRoot() {
  const envRoot = String(process.env.DREAM_APP_USER_DATA || "").trim();
  if (envRoot) {
    return envRoot;
  }
  try {
    const electronApp = require("electron").app;
    if (typeof electronApp?.getPath === "function") {
      return electronApp.getPath("userData");
    }
  } catch {}
  return "";
}

function hermesVenvDir() {
  const explicit = String(process.env.DREAM_HERMES_VENV_DIR || "").trim();
  if (explicit) {
    return explicit;
  }
  const userData = userDataRoot();
  if (isPackaged() && userData) {
    return path.join(userData, "hermes", ".venv-hermes");
  }
  return path.join(appRoot(), ".venv-hermes");
}

function hermesVenvPythonCandidates() {
  const base = hermesVenvDir();
  if (PLATFORM === "win32") {
    return [
      {
        command: path.join(base, "Scripts", "python.exe"),
        args: [],
        source: "venv:win32",
      }
    ];
  }
  return [
    {
      command: path.join(base, "bin", "python3"),
      args: [],
      source: "venv:unix-python3",
    },
    {
      command: path.join(base, "bin", "python"),
      args: [],
      source: "venv:unix-python",
    }
  ];
}

function bundledPythonCandidates() {
  const base = path.join(appRoot(), "resources", "python", PLATFORM_KEY, "python");
  if (PLATFORM === "win32") {
    return [
      {
        command: path.join(base, "python.exe"),
        args: [],
        source: "bundled:standalone-win32",
      }
    ];
  }
  return [
    {
      command: path.join(base, "bin", "python3"),
      args: [],
      source: "bundled:standalone-python3",
    },
    {
      command: path.join(base, "bin", "python3.11"),
      args: [],
      source: "bundled:standalone-python3.11",
    },
    {
      command: path.join(base, "bin", "python"),
      args: [],
      source: "bundled:standalone-python",
    }
  ];
}

function systemPythonCandidates() {
  if (PLATFORM === "win32") {
    return [
      { command: "python", args: [], source: "system:python" },
      { command: "py", args: ["-3"], source: "system:py-launcher" }
    ];
  }
  return [
    { command: "python3", args: [], source: "system:python3" },
    { command: "python", args: [], source: "system:python" }
  ];
}

function bootstrapPythonCandidates() {
  const envPython = String(process.env.DREAM_HERMES_PYTHON || "").trim();
  const candidates = [];

  if (envPython) {
    pushUniqueCandidate(candidates, {
      command: envPython,
      args: [],
      source: "env:DREAM_HERMES_PYTHON"
    });
  }

  for (const candidate of bundledPythonCandidates()) {
    pushUniqueCandidate(candidates, candidate);
  }

  for (const candidate of systemPythonCandidates()) {
    pushUniqueCandidate(candidates, candidate);
  }

  return candidates;
}

function pythonCandidates() {
  const envPython = String(process.env.DREAM_HERMES_PYTHON || "").trim();
  const candidates = [];

  if (envPython) {
    pushUniqueCandidate(candidates, {
      command: envPython,
      args: [],
      source: "env:DREAM_HERMES_PYTHON"
    });
  }

  for (const candidate of hermesVenvPythonCandidates()) {
    pushUniqueCandidate(candidates, candidate);
  }

  for (const candidate of bundledPythonCandidates()) {
    pushUniqueCandidate(candidates, candidate);
  }

  for (const candidate of systemPythonCandidates()) {
    pushUniqueCandidate(candidates, candidate);
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// llama.cpp binary resolver
// ---------------------------------------------------------------------------

/**
 * Returns the platform-specific subdirectory inside `bin/llama/`.
 * Checks canonical name first (e.g. darwin-arm64), then legacy alias
 * (e.g. mac-arm64), then falls back to the llama root so callers can walk.
 */
function llamaRuntimeDir() {
  const base = path.join(appRoot(), "bin", "llama");

  const canonical = path.join(base, PLATFORM_KEY);
  if (fs.existsSync(canonical)) return canonical;

  const legacyName = LEGACY_LLAMA_DIRS[PLATFORM_KEY];
  if (legacyName) {
    const legacyDir = path.join(base, legacyName);
    if (fs.existsSync(legacyDir)) return legacyDir;
  }

  return base; // caller must walk
}

/** Expected server binary filename for the current platform. */
function llamaBinaryName() {
  return PLATFORM === "win32" ? "llama-server.exe" : "llama-server";
}

/**
 * Returns the absolute path to the llama-server binary for the current
 * platform, or an empty string if not found.
 */
function llamaBinaryPath() {
  const dir = llamaRuntimeDir();

  for (const name of [llamaBinaryName(), PLATFORM === "win32" ? "server.exe" : "server"]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }

  return "";
}

/**
 * Returns directories that contain .dll files inside the llama runtime dir.
 * Used on Windows to expand PATH so that llama-server.exe can load CUDA/ggml
 * DLLs. Returns [] on non-Windows platforms.
 */
function llamaDllDirs() {
  if (PLATFORM !== "win32") return [];

  const dir = llamaRuntimeDir();
  if (!fs.existsSync(dir)) return [];

  const seen = new Set();
  const results = [];

  function walk(d, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name.toLowerCase().endsWith(".dll")) {
        const parent = path.dirname(full);
        if (!seen.has(parent)) {
          seen.add(parent);
          results.push(parent);
        }
      }
    }
  }

  walk(dir, 0);
  return results;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Returns a plain-object snapshot of resolved runtime paths.
 * Useful for log output and --doctor style checks.
 */
function runtimeDiagnostics() {
  const pythons = pythonCandidates();
  const llamaBin = llamaBinaryPath();
  const llamaDir = llamaRuntimeDir();

  return {
    platformKey: PLATFORM_KEY,
    appRoot: appRoot(),
    isPackaged: isPackaged(),
    python: {
      envOverride: String(process.env.DREAM_HERMES_PYTHON || "").trim() || null,
      venvDir: hermesVenvDir(),
      candidates: pythons.map((c) => ({
        source: c.source,
        path: c.command,
        exists: fs.existsSync(c.command),
      })),
    },
    llama: {
      runtimeDir: llamaDir,
      runtimeDirExists: fs.existsSync(llamaDir),
      binaryPath: llamaBin || null,
      binaryExists: Boolean(llamaBin),
    },
  };
}

// ---------------------------------------------------------------------------

module.exports = {
  PLATFORM,
  ARCH,
  PLATFORM_KEY,
  appRoot,
  hermesVenvDir,
  hermesVenvPythonCandidates,
  bundledPythonCandidates,
  bootstrapPythonCandidates,
  isPackaged,
  pythonCandidates,
  llamaRuntimeDir,
  llamaBinaryName,
  llamaBinaryPath,
  llamaDllDirs,
  runtimeDiagnostics,
};
