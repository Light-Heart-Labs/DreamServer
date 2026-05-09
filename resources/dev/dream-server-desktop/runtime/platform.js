const os = require("os");

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function isWslRuntime({
  platform = process.platform,
  release = os.release(),
  env = process.env
} = {}) {
  if (platform !== "linux") {
    return false;
  }
  const marker = `${release || ""} ${env.WSL_DISTRO_NAME || ""} ${env.WSL_INTEROP || ""}`;
  return /microsoft|wsl/i.test(marker);
}

function shouldExposeWslPaths(context = {}) {
  if (process.platform !== "win32") {
    return false;
  }
  const hostInfo = context.hostInfo || {};
  const shellText = `${hostInfo.defaultShell || ""} ${hostInfo.defaultShellLabel || ""}`;
  return Boolean(hostInfo.isWsl) ||
    /\bwsl\b/i.test(shellText) ||
    truthy(process.env.DREAM_EXPOSE_WSL_PATHS) ||
    truthy(process.env.DREAM_USE_WSL_PATHS) ||
    truthy(process.env.DREAM_USE_WSL);
}

function windowsToWslPath(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return "";
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/[\\/]+/g, "/")}`;
}

function maybeWindowsToWslPath(value, context = {}) {
  return shouldExposeWslPaths(context) ? windowsToWslPath(value) : "";
}

function hasWslMountPath(value) {
  return /(^|[\s"'`])[/\\]mnt[/\\][a-zA-Z](?=$|[/\\\s"'`])/i.test(String(value || ""));
}

function hasUnixBashPath(value) {
  return /(^|[\s"'`])\/usr\/bin\/(?:env\s+)?bash(?=$|[\s"'`])/i.test(String(value || ""));
}

function hasBareBashCommand(value) {
  return /(^|[\s;&|()])bash(?:\.exe)?(?=$|[\s;&|()])/i.test(String(value || ""));
}

function commandBaseName(command) {
  const raw = String(command || "").trim().replace(/^["']|["']$/g, "");
  const parts = raw.split(/[\\/]/);
  return (parts.pop() || raw).toLowerCase();
}

function isWslCommand(command) {
  const base = commandBaseName(command);
  return base === "wsl" || base === "wsl.exe";
}

function nativeWindowsPosixProblem({ command = "", args = [], script = "", cwd = "", shell = "" } = {}) {
  if (process.platform !== "win32") {
    return "";
  }
  const combined = [
    command,
    Array.isArray(args) ? args.join(" ") : String(args || ""),
    script,
    cwd,
    shell
  ].join(" ");
  if (isWslCommand(command)) {
    return "";
  }
  if (hasUnixBashPath(combined)) {
    return "Este app esta rodando em Windows nativo. /usr/bin/bash so existe dentro de Linux/WSL; use cmd/PowerShell nativo ou chame wsl.exe explicitamente.";
  }
  const shellName = String(shell || "").trim().toLowerCase();
  if (script && hasBareBashCommand(script) && !["bash", "sh", "zsh"].includes(shellName) && !shouldExposeWslPaths()) {
    return "Este app esta rodando em Windows nativo. Nao use bash generico em scripts de cmd/PowerShell; use cmd/PowerShell, configure Git Bash explicitamente, ou chame wsl.exe quando quiser WSL.";
  }
  if (hasWslMountPath(combined) && !shouldExposeWslPaths()) {
    return "Este app esta rodando em Windows nativo. Caminhos /mnt/<drive>/... sao de WSL; use caminhos Windows como C:\\Users\\... ou habilite WSL explicitamente.";
  }
  return "";
}

module.exports = {
  commandBaseName,
  hasBareBashCommand,
  hasUnixBashPath,
  hasWslMountPath,
  isWslCommand,
  isWslRuntime,
  maybeWindowsToWslPath,
  nativeWindowsPosixProblem,
  shouldExposeWslPaths,
  truthy,
  windowsToWslPath
};
