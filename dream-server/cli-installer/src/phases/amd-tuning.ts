// ── Phase 10: AMD System Tuning ─────────────────────────────────────────────
// Port of installers/phases/10-amd-tuning.sh
// Applies AMD APU (Strix Halo) sysctl, modprobe, GRUB, and tuned setup.

import { type InstallContext } from '../lib/config.ts';
import { exec, commandExists } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdirSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export async function amdTuning(ctx: InstallContext): Promise<void> {
  if (ctx.gpu.backend !== 'amd') return;

  // AMD tuning is Linux-only (sysctl, modprobe, systemd)
  if (process.platform !== 'linux') return;

  ui.phase(0, 0, 'AMD APU System Tuning');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would apply AMD APU system tuning:');
    ui.info('[DRY RUN]   - Install systemd user timers (session cleanup, memory shepherd)');
    ui.info('[DRY RUN]   - Apply sysctl tuning (swappiness=10, vfs_cache_pressure=50)');
    ui.info('[DRY RUN]   - Install amdgpu modprobe options');
    ui.info('[DRY RUN]   - Install GTT memory optimization');
    ui.info('[DRY RUN]   - Configure tuned accelerator-performance profile');
    return;
  }

  const home = homedir();
  const installDir = ctx.installDir;

  // ── Memory Shepherd check ──
  if (existsSync(join(installDir, 'memory-shepherd'))) {
    ui.ok('Memory Shepherd installed');
  }

  // ── Install systemd user timers ──
  ui.info('Installing maintenance timers...');
  const systemdDir = join(home, '.config', 'systemd', 'user');
  mkdirSync(systemdDir, { recursive: true });

  // Ensure scripts are executable
  for (const script of [
    join(installDir, 'scripts', 'session-cleanup.sh'),
    join(installDir, 'memory-shepherd', 'memory-shepherd.sh'),
  ]) {
    if (existsSync(script)) {
      try { chmodSync(script, 0o755); } catch { /* ignore */ }
    }
  }

  // Copy systemd unit files
  const systemdSource = join(installDir, 'scripts', 'systemd');
  if (existsSync(systemdSource)) {
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(systemdSource);
      for (const f of files) {
        if (f.endsWith('.service') || f.endsWith('.timer')) {
          copyFileSync(join(systemdSource, f), join(systemdDir, f));
        }
      }
    } catch { /* ignore */ }
  }

  // Create archive directories for memory shepherd
  const archiveBase = join(installDir, 'data', 'memory-archives', 'dream-agent');
  for (const sub of ['memory', 'agents', 'tools']) {
    mkdirSync(join(archiveBase, sub), { recursive: true });
  }

  // Reload and enable all timers
  await exec(['systemctl', '--user', 'daemon-reload'], { throwOnError: false });
  const timers = [
    'openclaw-session-cleanup',
    'openclaw-session-manager',
    'memory-shepherd-workspace',
    'memory-shepherd-memory',
  ];
  for (const timer of timers) {
    await exec(
      ['systemctl', '--user', 'enable', '--now', `${timer}.timer`],
      { throwOnError: false, timeout: 10_000 },
    );
  }
  ui.ok('Maintenance timers enabled (session cleanup, session manager, memory shepherd)');

  // Enable lingering so user timers survive logout
  const user = process.env.USER || process.env.LOGNAME || '';
  const linger = await exec(['loginctl', 'enable-linger', user], { throwOnError: false });
  if (linger.exitCode !== 0) {
    const sudoLinger = await exec(['sudo', '-n', 'loginctl', 'enable-linger', user], { throwOnError: false });
    if (sudoLinger.exitCode !== 0) {
      ui.warn(`Could not enable linger. Timers may stop after logout. Run: loginctl enable-linger ${user}`);
    }
  }

  // ── sysctl tuning ──
  const sysctlConf = join(installDir, 'config', 'system-tuning', '99-dream-server.conf');
  if (existsSync(sysctlConf)) {
    const cp = await exec(
      ['sudo', '-n', 'cp', sysctlConf, '/etc/sysctl.d/'],
      { throwOnError: false },
    );
    if (cp.exitCode === 0) {
      await exec(['sudo', '-n', 'sysctl', '--system'], { throwOnError: false });
      ui.ok('sysctl tuning applied (swappiness=10, vfs_cache_pressure=50)');
    } else {
      ui.warn('Could not install sysctl tuning (needs sudo). Copy manually:');
      ui.info('  sudo cp config/system-tuning/99-dream-server.conf /etc/sysctl.d/');
    }
  }

  // ── amdgpu modprobe options ──
  const amdgpuConf = join(installDir, 'config', 'system-tuning', 'amdgpu.conf');
  if (existsSync(amdgpuConf)) {
    const cp = await exec(
      ['sudo', '-n', 'cp', amdgpuConf, '/etc/modprobe.d/'],
      { throwOnError: false },
    );
    if (cp.exitCode === 0) {
      ui.ok('amdgpu modprobe tuning installed (ppfeaturemask, gpu_recovery)');
    } else {
      ui.warn('Could not install amdgpu modprobe config (needs sudo). Copy manually:');
      ui.info('  sudo cp config/system-tuning/amdgpu.conf /etc/modprobe.d/');
    }
  }

  // ── GTT memory optimization ──
  const gttConf = join(installDir, 'config', 'system-tuning', 'amdgpu_llm_optimized.conf');
  if (existsSync(gttConf)) {
    const cp = await exec(
      ['sudo', '-n', 'cp', gttConf, '/etc/modprobe.d/'],
      { throwOnError: false },
    );
    if (cp.exitCode === 0) {
      ui.ok('GTT memory tuning installed (gttsize=120000, pages_limit, page_pool_size)');
    } else {
      ui.warn('Could not install GTT memory config (needs sudo). Copy manually:');
      ui.info('  sudo cp config/system-tuning/amdgpu_llm_optimized.conf /etc/modprobe.d/');
    }
  }

  // ── GRUB kernel boot parameters ──
  const grubDefault = '/etc/default/grub';
  if (existsSync(grubDefault)) {
    try {
      const grubContent = readFileSync(grubDefault, 'utf-8');
      const cmdline = grubContent.match(/^GRUB_CMDLINE_LINUX_DEFAULT=.*/m)?.[0] || '';
      if (cmdline && !cmdline.includes('amd_iommu=off')) {
        ui.info("Recommended: add 'amd_iommu=off' to kernel boot parameters for ~2-6% GPU improvement");
        ui.info("  Run: sudo sed -i 's/iommu=pt/amd_iommu=off/' /etc/default/grub && sudo update-grub");
      }
    } catch { /* ignore */ }
  }

  // ── tuned accelerator-performance profile ──
  const hasTuned = await commandExists('tuned-adm');
  if (hasTuned) {
    const active = await exec(
      ['systemctl', 'is-active', '--quiet', 'tuned'],
      { throwOnError: false },
    );

    if (active.exitCode !== 0) {
      // tuned not running — try to enable
      const enable = await exec(
        ['sudo', '-n', 'systemctl', 'enable', '--now', 'tuned'],
        { throwOnError: false },
      );
      if (enable.exitCode === 0) {
        const profile = await exec(
          ['sudo', '-n', 'tuned-adm', 'profile', 'accelerator-performance'],
          { throwOnError: false },
        );
        if (profile.exitCode === 0) {
          ui.ok('tuned profile set to accelerator-performance (5-8% pp improvement)');
        } else {
          ui.warn('tuned started but could not set profile. Run: sudo tuned-adm profile accelerator-performance');
        }
      } else {
        ui.warn('Could not start tuned. Run manually:');
        ui.info('  sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance');
      }
    } else {
      // tuned is running — check current profile
      const profileResult = await exec(['tuned-adm', 'active'], { throwOnError: false });
      const currentProfile = profileResult.stdout.match(/Current active profile: (.*)/)?.[1] || '';
      if (currentProfile !== 'accelerator-performance') {
        const set = await exec(
          ['sudo', '-n', 'tuned-adm', 'profile', 'accelerator-performance'],
          { throwOnError: false },
        );
        if (set.exitCode === 0) {
          ui.ok('tuned profile changed to accelerator-performance');
        } else {
          ui.warn('tuned running but wrong profile. Run: sudo tuned-adm profile accelerator-performance');
        }
      } else {
        ui.ok('tuned already set to accelerator-performance');
      }
    }
  } else {
    ui.warn('tuned not installed. For 5-8% prompt processing improvement:');
    ui.info('  sudo apt install tuned && sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance');
  }

  // ── LiteLLM Strix Halo config check ──
  if (existsSync(join(installDir, 'config', 'litellm', 'strix-halo-config.yaml'))) {
    ui.ok('LiteLLM Strix Halo routing config installed');
  }
}
