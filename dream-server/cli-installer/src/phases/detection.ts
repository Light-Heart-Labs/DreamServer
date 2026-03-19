// ── Phase 02: Detection ─────────────────────────────────────────────────────

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec } from '../lib/shell.ts';
import { getRamGB as platformGetRamGB, getDiskGB as platformGetDiskGB, getDefaultInstallDir, IS_MACOS, IS_LINUX } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectionResult {
  gpu: InstallContext['gpu'];
  ramGB: number;
  diskGB: number;
  tier: string;
}

export async function detect(ctx: InstallContext): Promise<DetectionResult> {
  ui.phase(2, 6, 'System Detection', '~5s');
  ui.step('Reading hardware...');

  // RAM
  const ramGB = await detectRam();
  ctx.system.ramGB = ramGB;

  // Disk
  const diskGB = await detectDisk();
  ctx.system.diskGB = diskGB;

  // GPU
  const gpu = await detectGpu();
  ctx.gpu = gpu;

  if (gpu.backend === 'apple') {
    ui.ok(`GPU: ${gpu.name} (unified memory — ${ramGB}GB)`);
  } else if (gpu.count > 0) {
    ui.ok(`GPU: ${gpu.name} (${Math.round(gpu.vramMB / 1024)}GB VRAM)`);
  } else {
    ui.warn('No GPU detected — CPU-only mode');
  }
  ui.ok(`RAM: ${ramGB}GB`);
  ui.ok(`Disk: ${diskGB}GB available`);

  // Tier classification
  const tier = ctx.tier || classifyTier(gpu, ramGB);
  ctx.tier = tier;

  const tierConfig = TIER_MAP[tier];
  if (tierConfig) {
    ui.box(`Tier ${tier}: ${tierConfig.name}`, [
      ['Model', tierConfig.model],
      ['Speed', `~${tierConfig.speed} tok/s`],
      ['Users', `${tierConfig.users} concurrent`],
    ]);
  }

  return { gpu, ramGB, diskGB, tier };
}

export async function detectRam(): Promise<number> {
  // os.totalmem() works on all platforms (Windows, Linux, macOS)
  return platformGetRamGB();
}

export async function detectDisk(): Promise<number> {
  // Delegates to platform.ts — PowerShell on Windows, df on Linux
  return platformGetDiskGB(getDefaultInstallDir());
}

export async function detectGpu(): Promise<InstallContext['gpu']> {
  const noGpu: InstallContext['gpu'] = { backend: 'cpu', name: 'Not detected', vramMB: 0, count: 0 };

  // Apple Silicon detection — Docker on macOS runs in a Linux VM (no Metal passthrough)
  // but llama-server can use ARM NEON optimizations via docker-compose.apple.yml
  if (IS_MACOS && process.arch === 'arm64') {
    let chipName = 'Apple Silicon';
    try {
      const { stdout, exitCode } = await exec(
        ['sysctl', '-n', 'machdep.cpu.brand_string'],
        { throwOnError: false, timeout: 3000 },
      );
      if (exitCode === 0 && stdout.trim()) chipName = stdout.trim();
    } catch { /* use default */ }

    return { backend: 'apple', name: chipName, vramMB: 0, count: 0 };
  }

  // NVIDIA GPU detection
  try {
    const { stdout, exitCode } = await exec(
      ['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 10000 },
    );

    if (exitCode === 0 && stdout.trim()) {
      const lines = stdout.trim().split('\n');
      // Sum VRAM across all GPUs (multi-GPU support)
      let totalVramMB = 0;
      let gpuName = 'NVIDIA GPU';
      for (const line of lines) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts[0]) gpuName = parts[0];
        totalVramMB += parseInt(parts[1] || '0', 10);
      }

      return {
        backend: 'nvidia',
        name: gpuName + (lines.length > 1 ? ` (x${lines.length})` : ''),
        vramMB: totalVramMB,
        count: lines.length,
      };
    }
  } catch {
    // nvidia-smi not found — not NVIDIA
  }

  // AMD GPU detection via sysfs (Linux only)
  if (IS_LINUX) {
    try {
      const { readdirSync, readFileSync: readFs } = await import('node:fs');
      const drmPath = '/sys/class/drm';
      if (existsSync(drmPath)) {
        const cards = readdirSync(drmPath).filter((d) => /^card\d+$/.test(d));
        let amdCount = 0;
        let totalVramMB = 0;
        let gpuName = 'AMD GPU';

        for (const card of cards) {
          const vendorPath = join(drmPath, card, 'device', 'vendor');
          if (!existsSync(vendorPath)) continue;
          const vendor = readFs(vendorPath, 'utf-8').trim();
          if (vendor !== '0x1002') continue; // AMD vendor ID

          amdCount++;

          // Try to read VRAM
          const vramPath = join(drmPath, card, 'device', 'mem_info_vram_total');
          if (existsSync(vramPath)) {
            const bytes = parseInt(readFs(vramPath, 'utf-8').trim(), 10);
            if (!isNaN(bytes)) totalVramMB += Math.round(bytes / 1024 / 1024);
          }

          // Try to read GPU name
          const namePaths = [
            join(drmPath, card, 'device', 'product_name'),
            join(drmPath, card, 'device', 'pci_id'),
          ];
          for (const np of namePaths) {
            if (existsSync(np)) {
              const n = readFs(np, 'utf-8').trim();
              if (n) { gpuName = n; break; }
            }
          }
        }

        if (amdCount > 0) {
          // For AMD APUs with unified memory, VRAM may show as 0
          // Use system RAM as effective VRAM estimate
          if (totalVramMB === 0) {
            totalVramMB = platformGetRamGB() * 1024; // unified memory
          }

          return {
            backend: 'amd' as const,
            name: gpuName + (amdCount > 1 ? ` (x${amdCount})` : ''),
            vramMB: totalVramMB,
            count: amdCount,
          };
        }
      }
    } catch { /* sysfs not available */ }

    // Fallback: try rocm-smi
    try {
      const { stdout, exitCode } = await exec(
        ['rocm-smi', '--showmeminfo', 'vram'],
        { throwOnError: false, timeout: 10000 },
      );
      if (exitCode === 0 && stdout.includes('GPU')) {
        return { backend: 'amd' as const, name: 'AMD GPU (ROCm)', vramMB: 0, count: 1 };
      }
    } catch { /* rocm-smi not found */ }
  }

  return noGpu;
}

export function classifyTier(gpu: InstallContext['gpu'], ramGB: number): string {
  if (gpu.vramMB >= 90000) return 'NV_ULTRA';
  if (gpu.count >= 2 || gpu.vramMB >= 40000) return '4';
  if (gpu.vramMB >= 20000 || ramGB >= 96) return '3';
  if (gpu.vramMB >= 12000 || ramGB >= 48) return '2';
  return '1';
}
