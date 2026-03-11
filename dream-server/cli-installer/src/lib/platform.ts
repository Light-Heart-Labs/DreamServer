// ── Platform Abstraction Layer ──────────────────────────────────────────────
// Centralizes all OS-specific logic so the rest of the codebase is cross-platform.

import { platform, homedir, tmpdir, totalmem, freemem } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { existsSync, cpSync, rmSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// ── Platform detection ──────────────────────────────────────────────────────

export const IS_WINDOWS = platform() === 'win32';
export const IS_MACOS = platform() === 'darwin';
export const IS_LINUX = !IS_WINDOWS && !IS_MACOS; // includes WSL

/**
 * Get the OS name for display and context purposes.
 */
export function getOsName(): 'windows' | 'macos' | 'linux' {
  if (IS_WINDOWS) return 'windows';
  if (IS_MACOS) return 'macos';
  return 'linux';
}

// ── Paths ───────────────────────────────────────────────────────────────────

/**
 * Resolve the real user's home directory, even under sudo.
 * On Windows, uses USERPROFILE / os.homedir().
 * On Linux with sudo, uses getent or /home/$SUDO_USER.
 */
export function getHome(): string {
  if (IS_WINDOWS) {
    return process.env.USERPROFILE || homedir();
  }

  // On Linux/macOS under sudo, resolve the original user's home
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && process.getuid?.() === 0) {
    try {
      const result = execFileSync('getent', ['passwd', sudoUser], {
        encoding: 'utf-8',
        timeout: 2000,
      });
      const home = result.trim().split(':')[5];
      if (home) return home;
    } catch { /* fallback */ }
    return `/home/${sudoUser}`;
  }
  return homedir() || process.env.HOME || '/root';
}

/**
 * Get the default installation directory for Dream Server.
 * Windows: %LOCALAPPDATA%\DreamServer
 * Linux/macOS: ~/dream-server
 */
export function getDefaultInstallDir(): string {
  if (IS_WINDOWS) {
    return join(process.env.LOCALAPPDATA || join(getHome(), 'AppData', 'Local'), 'DreamServer');
  }
  return join(getHome(), 'dream-server');
}

/**
 * Get the system temp directory.
 */
export function getTmpDir(): string {
  return tmpdir();
}

// ── Command detection ───────────────────────────────────────────────────────

/**
 * Check if a command exists on the system.
 * Uses `where.exe` on Windows, `which` on Unix.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const checkCmd = IS_WINDOWS ? ['where.exe', cmd] : ['which', cmd];
  try {
    const proc = Bun.spawn(checkCmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

// ── System detection ────────────────────────────────────────────────────────

/**
 * Get total system RAM in GB. Works on all platforms.
 */
export function getRamGB(): number {
  return Math.round(totalmem() / 1024 / 1024 / 1024);
}

/**
 * Get available system RAM in MB. Works on all platforms.
 */
export function getAvailableRamMB(): number {
  return Math.round(freemem() / 1024 / 1024);
}

/**
 * Get available disk space in GB for the given directory.
 */
export async function getDiskGB(dir: string): Promise<number> {
  if (IS_WINDOWS) {
    return getDiskGBWindows(dir);
  }
  return getDiskGBUnix(dir);
}

async function getDiskGBWindows(dir: string): Promise<number> {
  try {
    // Extract drive letter
    const resolved = resolve(dir);
    const drive = resolved.slice(0, 2); // e.g. "C:"
    const proc = Bun.spawn(
      ['powershell', '-NoProfile', '-Command',
        `(Get-PSDrive ${drive[0]}).Free`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && stdout.trim()) {
      const freeBytes = parseInt(stdout.trim(), 10);
      if (!isNaN(freeBytes)) return Math.round(freeBytes / 1024 / 1024 / 1024);
    }
  } catch { /* fallback */ }
  return 0;
}

async function getDiskGBUnix(dir: string): Promise<number> {
  try {
    const proc = Bun.spawn(['df', '-BG', dir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const lines = stdout.split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        return parseInt(parts[3]?.replace('G', '') || '0', 10);
      }
    }
  } catch { /* ignore */ }
  return 0;
}

// ── Port checking ───────────────────────────────────────────────────────────

/**
 * Check if a TCP port is free (not in use).
 * Returns true if the port is FREE, false if it's in use.
 */
export async function isPortFree(port: number): Promise<boolean> {
  if (IS_WINDOWS) {
    return isPortFreeWindows(port);
  }
  return isPortFreeUnix(port);
}

async function isPortFreeWindows(port: number): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      ['netstat', '-anop', 'TCP'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const regex = new RegExp(`:${port}\\s`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* fallback */ }
  return true; // Can't check — assume free
}

async function isPortFreeUnix(port: number): Promise<boolean> {
  // Try ss first (modern Linux)
  try {
    const proc = Bun.spawn(['ss', '-tln'], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* try netstat */ }

  // Fallback: netstat (net-tools)
  try {
    const proc = Bun.spawn(['netstat', '-tln'], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* neither tool available */ }

  return true; // Can't check — assume free
}

// ── File operations ─────────────────────────────────────────────────────────

/**
 * Copy a directory recursively (cross-platform).
 */
export function copyDir(src: string, dst: string): void {
  cpSync(src, dst, { recursive: true });
}

/**
 * Remove a directory recursively (cross-platform).
 */
export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Move (rename) a file. Falls back to copy+delete if rename fails
 * (e.g. across drives on Windows).
 */
export function moveFile(src: string, dst: string): void {
  try {
    renameSync(src, dst);
  } catch {
    // renameSync can fail across filesystem boundaries
    copyFileSync(src, dst);
    unlinkSync(src);
  }
}

// ── Docker helpers ──────────────────────────────────────────────────────────

/**
 * Get the COMPOSE_FILE separator for the current platform.
 * Docker Compose uses `:` on Linux/macOS and `;` on Windows.
 */
export function getComposeFileSeparator(): string {
  return IS_WINDOWS ? ';' : ':';
}

// ── Safety ──────────────────────────────────────────────────────────────────

/**
 * Check if a path is dangerous to delete (system directories).
 */
export function isDangerousPath(p: string): boolean {
  const target = resolve(p);

  if (IS_WINDOWS) {
    const normalized = target.toLowerCase().replace(/\\/g, '/');
    // Refuse drive roots (C:/, D:/, etc.)
    if (/^[a-z]:\/?\s*$/.test(normalized)) return true;
    // Refuse Windows system directories
    const winDangerous = [
      'c:/windows', 'c:/program files', 'c:/program files (x86)',
      'c:/users', 'c:/programdata',
    ];
    if (winDangerous.some((d) => normalized === d || normalized === d + '/')) return true;
    // Refuse if less than 3 path segments (e.g. C:\Users is only 2)
    const segments = target.split(/[\\/]/).filter(Boolean);
    return segments.length < 3;
  }

  // Unix
  const DANGEROUS_PATHS = [
    '/', '/home', '/root', '/usr', '/etc', '/var', '/boot',
    '/bin', '/sbin', '/lib', '/opt', '/tmp',
  ];
  if (DANGEROUS_PATHS.includes(target)) return true;
  return target.split('/').filter(Boolean).length < 2;
}

// ── Docker error messages ───────────────────────────────────────────────────

/**
 * Get the platform-appropriate Docker install instructions.
 */
export function getDockerInstallHint(): string {
  if (IS_WINDOWS) return 'Download Docker Desktop: https://docker.com/products/docker-desktop';
  if (IS_MACOS) return 'Download Docker Desktop: https://docker.com/products/docker-desktop';
  return 'Install: curl -fsSL https://get.docker.com | sh';
}

/**
 * Get the platform-appropriate Docker daemon fix instructions.
 */
export function getDockerDaemonFixHint(): string[] {
  if (IS_WINDOWS) {
    return [
      'Start Docker Desktop from the Start menu',
      'Wait for the whale icon to stabilize in the system tray',
    ];
  }
  return [
    'sudo usermod -aG docker $USER && newgrp docker',
    '# or start the daemon:',
    'sudo systemctl start docker',
  ];
}

/**
 * Get the platform-appropriate hint for permission errors.
 */
export function getPermissionFixHint(dataDir: string): string {
  if (IS_WINDOWS) {
    return 'Check that Docker Desktop has permission to access this directory in Settings → Resources → File sharing';
  }
  return `Fix: sudo chown -R 1000:1000 ${dataDir}`;
}
