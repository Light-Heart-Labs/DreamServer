#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const venvDir = path.join(root, ".venv-hermes");
const requirementsPath = path.join(root, "vendor", "hermes-agent", "requirements.txt");
const hermesRoot = path.join(root, "vendor", "hermes-agent");
const bridgeRunnerPath = path.join(root, "runtime", "hermes", "bridge_runner.py");

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false });
  return result.status === 0;
}

function fileExists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function findGitBash() {
  const explicit = String(process.env.HERMES_GIT_BASH_PATH || "").trim();
  if (fileExists(explicit)) {
    return explicit;
  }
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe")
  ];
  return candidates.find(fileExists) || "";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...options
  });
  return result.status === 0;
}

function pickPython() {
  const explicit = String(process.env.DREAM_HERMES_PYTHON || process.env.PYTHON || "").trim();
  if (explicit) {
    return { command: explicit, args: [] };
  }
  if (process.platform === "win32" && commandExists("py", ["-3", "--version"])) {
    return { command: "py", args: ["-3"] };
  }
  for (const command of ["python3", "python"]) {
    if (commandExists(command)) {
      return { command, args: [] };
    }
  }
  console.error("Python 3 was not found. Install Python 3.10+ and rerun npm run setup:hermes.");
  process.exit(1);
}

function venvPython() {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

if (!fs.existsSync(requirementsPath)) {
  console.error(`Missing requirements file: ${requirementsPath}`);
  process.exit(1);
}

const python = pickPython();
console.log(`[setup:hermes] OS: ${process.platform}; Node: ${process.version}`);
if (process.platform === "win32") {
  const gitBash = findGitBash();
  if (!gitBash) {
    console.warn(
      [
        "[setup:hermes] Git Bash was not found.",
        "[setup:hermes] Continuing with native Windows setup; Dream Server will use cmd/PowerShell by default.",
        "[setup:hermes] Install Git for Windows or set HERMES_GIT_BASH_PATH only if you explicitly need Bash tools."
      ].join("\n")
    );
  }
  if (gitBash) {
    process.env.HERMES_GIT_BASH_PATH = gitBash;
    console.log(`[setup:hermes] Git Bash: ${gitBash}`);
  }
}

if (!fs.existsSync(venvPython())) {
  run(python.command, [...python.args, "-m", "venv", venvDir]);
}

run(venvPython(), ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython(), ["-m", "pip", "install", "-r", requirementsPath]);

if (fs.existsSync(bridgeRunnerPath)) {
  const ok = runChecked(venvPython(), [bridgeRunnerPath, "--doctor", "--hermes-root", hermesRoot]);
  if (!ok) {
    console.error("Hermes doctor failed after installation. Check the Python output above.");
    process.exit(1);
  }
}

console.log("[setup:hermes] Hermes environment is ready.");
