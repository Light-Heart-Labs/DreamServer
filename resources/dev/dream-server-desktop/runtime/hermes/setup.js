const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  appRoot,
  bootstrapPythonCandidates,
  hermesVenvDir,
  hermesVenvPythonCandidates,
} = require("../platform/runtime-resolver");

function requirementsPath() {
  return path.join(appRoot(), "vendor", "hermes-agent", "requirements.txt");
}

function venvDir() {
  return hermesVenvDir();
}

function venvPython() {
  const candidates = hermesVenvPythonCandidates().map((candidate) => candidate.command);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function pythonMajorMinor(candidate) {
  const normalized = typeof candidate === "string"
    ? { command: candidate, args: [] }
    : candidate;
  if (!normalized?.command) {
    return null;
  }
  const r = spawnSync(normalized.command, [...(normalized.args || []), "--version"], {
    stdio: "pipe",
    shell: false,
    timeout: 4000
  });
  if (r.status !== 0 && r.status !== null) return null;
  if (r.error) return null;
  const m = String(r.stdout || r.stderr || "").match(/Python (\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function pickBootstrapPython() {
  for (const candidate of bootstrapPythonCandidates()) {
    if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) {
      continue;
    }
    const ver = pythonMajorMinor(candidate);
    if (!ver) continue;
    const [maj, min] = ver;
    if (maj < 3 || (maj === 3 && min < 10)) continue; // require 3.10+
    return candidate;
  }

  return null;
}

function venvPythonVersion() {
  const python = venvPython();
  if (!fs.existsSync(python)) return null;
  return pythonMajorMinor({ command: python, args: [] });
}

function needsSetup() {
  const python = venvPython();
  if (!fs.existsSync(python)) return true;
  const result = spawnSync(python, ["-c", "import openai"], {
    stdio: "ignore",
    shell: false,
    timeout: 5000
  });
  return result.status !== 0;
}

function isUsefulPipLine(line) {
  const l = line.toLowerCase();
  return (
    l.startsWith("installing") ||
    l.startsWith("successfully installed") ||
    l.startsWith("collecting") ||
    l.startsWith("downloading") ||
    l.startsWith("error") ||
    l.startsWith("warning")
  );
}

async function runAsync(command, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: appRoot(),
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const handleData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (isUsefulPipLine(line)) onProgress?.(line);
      }
    };
    proc.stdout.on("data", handleData);
    proc.stderr.on("data", handleData);
    const errLines = [];
    proc.stderr.on("data", (chunk) => errLines.push(String(chunk).trim()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(errLines.slice(-5).join("\n") || `exit code ${code}`));
      }
    });
  });
}

async function ensureHermesVenv({ onProgress = () => {} } = {}) {
  const reqPath = requirementsPath();
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Requirements nao encontrado: ${reqPath}`);
  }

  // If existing venv has Python < 3.10, it cannot install required packages.
  // Delete it so we recreate with a proper version.
  const existingVer = venvPythonVersion();
  if (existingVer && (existingVer[0] < 3 || (existingVer[0] === 3 && existingVer[1] < 10))) {
    onProgress(
      `Ambiente Python ${existingVer.join(".")} incompativel (requer 3.10+) — recriando...`
    );
    fs.rmSync(venvDir(), { recursive: true, force: true });
  }

  const python = venvPython();
  const venv = venvDir();

  if (!fs.existsSync(python)) {
    const bootstrapPython = pickBootstrapPython();
    if (!bootstrapPython) {
      throw new Error(
        "Python 3.10+ nao encontrado para preparar o Hermes Agent.\n" +
        "Empacote `resources/python/<plataforma>` com `npm run download:python` antes do build,\n" +
        "ou defina DREAM_HERMES_PYTHON para um Python 3.10+ valido."
      );
    }
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    onProgress(`Usando Python base (${bootstrapPython.source})...`);
    onProgress(`Criando ambiente Python em ${venv}...`);
    await runAsync(
      bootstrapPython.command,
      [...(bootstrapPython.args || []), "-m", "venv", venv],
      onProgress
    );
  }

  onProgress("Atualizando pip...");
  await runAsync(python, ["-m", "pip", "install", "--upgrade", "pip", "-q"], onProgress);

  onProgress("Instalando dependencias do Hermes (openai, httpx, rich...)");
  await runAsync(python, ["-m", "pip", "install", "-r", reqPath], onProgress);

  onProgress("Verificando instalacao...");
  const check = spawnSync(python, ["-c", "import openai; import httpx; import rich"], {
    stdio: "ignore",
    shell: false,
    timeout: 8000
  });
  if (check.status !== 0) {
    throw new Error("Instalacao concluida mas importacao falhou. Tente npm run setup:hermes manualmente.");
  }
}

module.exports = { needsSetup, ensureHermesVenv };
