const fs = require("fs/promises");
const fsNative = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const DEFAULT_PORTS = [3000, 6333, 7860, 8000, 8080, 8081, 11434, 11435, 1234];

function bytesToGB(value) { const n = Number(value || 0); return Math.round((n / 1024 / 1024 / 1024) * 10) / 10; }
async function execText(file, args = [], options = {}) {
  try {
    const result = await execFileAsync(file, args, { timeout: options.timeoutMs || 3000, windowsHide: true, maxBuffer: options.maxBuffer || 1024 * 1024 });
    return String(result.stdout || "").trim();
  } catch { return ""; }
}
async function commandExists(command, args = ["--version"]) { return Boolean(await execText(command, args, { timeoutMs: 1800 })); }
async function getDiskFreeGB(targetPath) {
  const probePath = path.resolve(targetPath || os.homedir());
  if (process.platform === "win32") {
    const root = path.parse(probePath).root.replace(/\\$/, "");
    const deviceId = root.replace(/'/g, "''");
    const output = await execText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${deviceId}'"; if($d){[math]::Round($d.FreeSpace/1GB,1)}`]);
    const parsed = Number(String(output).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const output = await execText("df", ["-k", probePath]);
  const parts = (output.split(/\r?\n/).filter(Boolean).pop() || "").trim().split(/\s+/);
  return Math.round((Number(parts[3] || 0) / 1024 / 1024) * 10) / 10;
}
async function isPortOpen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen({ host: "127.0.0.1", port });
  });
}
async function detectPorts(ports = DEFAULT_PORTS) { return Promise.all(ports.map(async (port) => ({ port, occupied: await isPortOpen(port) }))); }
function gpuVendorFromName(name = "") {
  const text = String(name || "").toLowerCase();
  if (!text) return "none";
  if (text.includes("nvidia") || text.includes("geforce") || text.includes("rtx") || text.includes("quadro")) return "nvidia";
  if (text.includes("amd") || text.includes("radeon")) return "amd";
  if (text.includes("apple")) return "apple";
  if (text.includes("intel")) return "intel";
  return "unknown";
}
async function detectNvidia() {
  const output = await execText("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], { timeoutMs: 2500 });
  const line = output.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
  if (!line) return null;
  const [name, memoryMb, driverVersion] = line.split(",").map((part) => part.trim());
  return { gpuVendor: "nvidia", gpuModel: name || "NVIDIA GPU", vramGB: Math.round((Number(memoryMb || 0) / 1024) * 10) / 10, driverVersion: driverVersion || "", nvidiaSmiAvailable: true, accelerationAvailable: true };
}
async function detectWindowsGpu() {
  if (process.platform !== "win32") return null;
  const output = await execText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$a=Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Sort-Object AdapterRAM -Descending | Select-Object -First 1 Name,AdapterRAM,DriverVersion; if($a){$a | ConvertTo-Json -Compress}"]);
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    const adapter = Array.isArray(parsed) ? parsed[0] : parsed;
    const name = String(adapter?.Name || "").trim();
    return { gpuVendor: gpuVendorFromName(name), gpuModel: name, vramGB: bytesToGB(adapter?.AdapterRAM), driverVersion: String(adapter?.DriverVersion || ""), accelerationAvailable: gpuVendorFromName(name) !== "none" };
  } catch { return null; }
}
async function detectMacGpu() {
  if (process.platform !== "darwin") return null;
  const hardware = await execText("system_profiler", ["SPHardwareDataType", "-json"], { timeoutMs: 6000, maxBuffer: 1024 * 1024 * 2 });
  let chip = "", memory = "";
  try { const item = JSON.parse(hardware)?.SPHardwareDataType?.[0] || {}; chip = String(item.chip_type || item.cpu_type || "").trim(); memory = String(item.physical_memory || "").trim(); } catch {}
  const ramGB = Number((memory.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const isAppleSilicon = process.arch === "arm64" || /apple|m\d/i.test(chip);
  return { gpuVendor: isAppleSilicon ? "apple" : "intel", gpuModel: chip || (isAppleSilicon ? "Apple Silicon" : "Intel Mac"), vramGB: 0, unifiedMemoryGB: ramGB || bytesToGB(os.totalmem()), metalAvailable: isAppleSilicon, accelerationAvailable: isAppleSilicon };
}
async function detectLinuxGpu() {
  if (process.platform !== "linux") return null;
  const rocmOutput = await execText("rocm-smi", ["--showproductname", "--showmeminfo", "vram"], { timeoutMs: 2500 });
  if (rocmOutput) return { gpuVendor: "amd", gpuModel: "AMD GPU", vramGB: 0, rocmAvailable: true, accelerationAvailable: true };
  const lspci = await execText("lspci", [], { timeoutMs: 2500 });
  const displayLine = lspci.split(/\r?\n/).find((line) => /vga|3d|display/i.test(line)) || "";
  return displayLine ? { gpuVendor: gpuVendorFromName(displayLine), gpuModel: displayLine.replace(/^.*?:\s*/, "").trim(), vramGB: 0, accelerationAvailable: !/intel/i.test(displayLine) } : null;
}
async function detectWsl() { if (process.platform !== "linux") return false; try { return /microsoft|wsl/i.test(await fs.readFile("/proc/version", "utf8")); } catch { return false; } }
async function detectWindowsWsl() {
  if (process.platform !== "win32") return { wslAvailable: false, wsl2Available: false, wslDistros: [] };
  const output = await execText("wsl.exe", ["-l", "-v"], { timeoutMs: 3500 });
  const lines = output.split(/\r?\n/).map((line) => line.replace(/\0/g, "").trim()).filter(Boolean);
  const distros = lines.slice(1).map((line) => { const parts = line.replace(/^\*\s*/, "").split(/\s{2,}/); return { name: parts[0] || line, state: parts[1] || "", version: parts[2] || "" }; });
  return { wslAvailable: Boolean(output), wsl2Available: distros.some((d) => String(d.version) === "2"), wslDistros: distros };
}
async function detectDocker() {
  const dockerOutput = await execText("docker", ["version", "--format", "{{json .Server.Version}}"], { timeoutMs: 3000 });
  const composeOutput = await execText("docker", ["compose", "version", "--short"], { timeoutMs: 3000 });
  return { dockerInstalled: Boolean(dockerOutput || await commandExists("docker")), dockerAvailable: Boolean(dockerOutput), dockerVersion: dockerOutput.replace(/^"|"$/g, ""), dockerComposeAvailable: Boolean(composeOutput), dockerComposeVersion: composeOutput };
}
async function detectLinuxDistro() {
  if (process.platform !== "linux") return { distro: "", packageManager: "", systemd: false };
  let distro = "";
  try { const osRelease = await fs.readFile("/etc/os-release", "utf8"); distro = (osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || osRelease.match(/^ID="?([^"\n]+)"?/m) || [])[1] || ""; } catch {}
  let packageManager = "";
  for (const command of ["apt", "dnf", "pacman", "zypper"]) { if (await commandExists(command, ["--version"])) { packageManager = command; break; } }
  return { distro, packageManager, systemd: fsNative.existsSync("/run/systemd/system") };
}
async function detectAdmin() {
  if (process.platform === "win32") {
    return /^true$/i.test(await execText("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"]));
  }
  return typeof process.getuid === "function" ? process.getuid() === 0 : false;
}
async function scanSystem(options = {}) {
  const installDir = options.installDir || os.homedir();
  const [nvidia, macGpu, windowsGpu, linuxGpu, docker, wsl, windowsWsl, distro, diskFreeGB, ports, admin] = await Promise.all([detectNvidia(), detectMacGpu(), detectWindowsGpu(), detectLinuxGpu(), detectDocker(), detectWsl(), detectWindowsWsl(), detectLinuxDistro(), getDiskFreeGB(installDir), detectPorts(options.ports || DEFAULT_PORTS), detectAdmin()]);
  const gpu = nvidia || macGpu || windowsGpu || linuxGpu || { gpuVendor: "none", gpuModel: "CPU-only", vramGB: 0, accelerationAvailable: false };
  const ramGB = bytesToGB(os.totalmem());
  return { scannedAt: new Date().toISOString(), os: process.platform, arch: process.arch, hostname: os.hostname(), cpu: os.cpus()[0]?.model || "", cpuCores: os.cpus().length, ramGB, diskFreeGB, isWsl: wsl, isAdmin: admin, ...windowsWsl, ...distro, ...docker, gpuVendor: gpu.gpuVendor, gpuModel: gpu.gpuModel, vramGB: gpu.vramGB || 0, unifiedMemoryGB: gpu.unifiedMemoryGB || (gpu.gpuVendor === "apple" ? ramGB : 0), driverVersion: gpu.driverVersion || "", accelerationAvailable: Boolean(gpu.accelerationAvailable), nvidiaSmiAvailable: Boolean(nvidia), rocmAvailable: Boolean(gpu.rocmAvailable || await commandExists("rocm-smi", ["--version"])), vulkanAvailable: await commandExists("vulkaninfo", ["--summary"]), nvidiaContainerToolkitAvailable: await commandExists("nvidia-ctk", ["--version"]), metalAvailable: Boolean(gpu.metalAvailable), powershellAvailable: process.platform === "win32" ? await commandExists("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]) : false, ports };
}

module.exports = { DEFAULT_PORTS, scanSystem, detectPorts, getDiskFreeGB, execText };
