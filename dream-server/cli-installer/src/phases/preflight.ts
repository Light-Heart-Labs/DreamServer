// ── Phase 01: Preflight ─────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, commandExists } from '../lib/shell.ts';
import { IS_WINDOWS, IS_MACOS, getOsName, getDockerInstallHint, getDockerDaemonFixHint } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';
import { existsSync } from 'node:fs';

export interface PreflightResult {
  os: string;
  distro: string;
  arch: string;
  hasDocker: boolean;
  hasDockerCompose: boolean;
  hasGit: boolean;
  hasCurl: boolean;
  hasNvidiaSmi: boolean;
  dockerRunning: boolean;
  tailscaleIp: string | null;
}

export async function preflight(ctx: InstallContext): Promise<PreflightResult> {
  ui.phase(1, 6, 'Preflight', '~5s');
  ui.step('Scanning system...');

  // Root check — Linux/macOS only (Windows has no getuid)
  if (!IS_WINDOWS && process.getuid?.() === 0 && !process.env.SUDO_USER) {
    ui.fail('Do not run as root. Use sudo instead: sudo dream-installer install');
    process.exit(1);
  }

  // OS Detection
  const os = getOsName();
  let distro = '';
  if (IS_WINDOWS) {
    try {
      const result = await exec(
        ['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Caption'],
        { throwOnError: false, timeout: 5000 },
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        distro = result.stdout.trim();
      }
    } catch { /* Windows version detection failed — not critical */ }
  } else if (!IS_MACOS && existsSync('/etc/os-release')) {
    const content = await Bun.file('/etc/os-release').text();
    const match = content.match(/^PRETTY_NAME="?(.+?)"?$/m);
    if (match) distro = match[1];
  }
  ctx.system.os = os;
  ctx.system.distro = distro;
  ctx.system.arch = process.arch;
  ui.ok(`OS: ${distro || os} (${process.arch})`);

  // Tool checks
  const [hasGit, hasCurl, hasNvidiaSmi] = await Promise.all([
    commandExists('git'),
    commandExists('curl'),
    commandExists('nvidia-smi'),
  ]);

  // Docker: verify we can actually talk to the daemon, not just that the binary exists
  let hasDocker = false;
  let hasDockerCompose = false;
  let dockerRunning = false;

  try {
    const { getComposeCommand } = await import('../lib/docker.ts');
    const composeCmd = await getComposeCommand();
    hasDocker = true;
    hasDockerCompose = true;
    dockerRunning = true;
    ui.ok(`Docker ready (${composeCmd.join(' ')})`);
  } catch (e) {
    // Check if Docker binary exists at all
    const hasBinary = await commandExists('docker');
    if (!hasBinary) {
      ui.fail('Docker not found');
      ui.info(getDockerInstallHint());
    } else {
      hasDocker = true;
      // Binary exists but daemon access failed
      ui.fail('Cannot connect to Docker daemon');
      console.log('');
      ui.info('Fix with one of:');
      for (const hint of getDockerDaemonFixHint()) {
        console.log(`     ${hint}`);
      }
    }
    if (!ctx.dryRun && !ctx.force) {
      console.log('');
      ui.fail('Docker access is required. Fix the issue above and re-run.');
      process.exit(1);
    }
  }

  if (hasGit) ui.ok('git installed');
  else ui.warn('git not found — will attempt install');

  if (hasCurl) ui.ok('curl installed');
  else ui.warn('curl not found');

  // Tailscale detection
  let tailscaleIp: string | null = null;
  const hasTailscale = await commandExists('tailscale');
  if (hasTailscale) {
    try {
      const result = await exec(['tailscale', 'ip', '-4'], { throwOnError: false, timeout: 3000 });
      if (result.exitCode === 0 && result.stdout.trim()) {
        tailscaleIp = result.stdout.trim();
        ui.ok(`Tailscale detected (${tailscaleIp})`);
      }
    } catch { /* not connected */ }
    if (!tailscaleIp) {
      ui.info('Tailscale installed but not connected');
    }
  }

  return { os, distro, arch: process.arch, hasDocker, hasDockerCompose, hasGit, hasCurl, hasNvidiaSmi, dockerRunning, tailscaleIp };
}

