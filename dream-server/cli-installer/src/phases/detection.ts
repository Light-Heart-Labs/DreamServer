// ── Phase 02: Detection ─────────────────────────────────────────────────────

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec } from '../lib/shell.ts';
import { getRamGB as platformGetRamGB, getDiskGB as platformGetDiskGB, getDefaultInstallDir } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';

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

  if (gpu.count > 0) {
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

  try {
    const { stdout, exitCode } = await exec(
      ['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 10000 },
    );

    if (exitCode !== 0 || !stdout.trim()) return noGpu;

    const lines = stdout.trim().split('\n');
    const firstLine = lines[0].split(',').map((s) => s.trim());
    const name = firstLine[0] || 'NVIDIA GPU';
    const vramMB = parseInt(firstLine[1] || '0', 10);

    return {
      backend: 'nvidia',
      name,
      vramMB,
      count: lines.length,
    };
  } catch {
    return noGpu;
  }
}

export function classifyTier(gpu: InstallContext['gpu'], ramGB: number): string {
  if (gpu.vramMB >= 90000) return 'NV_ULTRA';
  if (gpu.count >= 2 || gpu.vramMB >= 40000) return '4';
  if (gpu.vramMB >= 20000 || ramGB >= 96) return '3';
  if (gpu.vramMB >= 12000 || ramGB >= 48) return '2';
  return '1';
}
