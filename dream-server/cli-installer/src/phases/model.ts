// ── Phase: Model Download ───────────────────────────────────────────────────

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec, execStream } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export async function downloadModel(ctx: InstallContext): Promise<void> {
  const tierConfig = TIER_MAP[ctx.tier];
  if (!tierConfig?.ggufUrl) {
    ui.info('No model download needed for this tier');
    return;
  }

  const modelsDir = join(ctx.installDir, 'data', 'models');
  const modelPath = join(modelsDir, tierConfig.ggufFile);

  // Check if model already exists
  if (existsSync(modelPath)) {
    const size = statSync(modelPath).size;
    const sizeGB = (size / 1024 / 1024 / 1024).toFixed(1);
    ui.ok(`Model already downloaded: ${tierConfig.ggufFile} (${sizeGB}GB)`);
    return;
  }

  if (ctx.dryRun) {
    ui.info(`[DRY RUN] Would download: ${tierConfig.ggufFile}`);
    ui.info(`  From: ${tierConfig.ggufUrl}`);
    return;
  }

  // Create models directory
  mkdirSync(modelsDir, { recursive: true });

  ui.step(`Downloading ${tierConfig.ggufFile}...`);
  ui.info('This may take a while depending on your connection');
  console.log('');

  const partPath = `${modelPath}.part`;

  // Use wget with resume support, or curl as fallback
  const hasWget = await commandExists('wget');

  // Max download time: 30 minutes (kills process if stuck at OS level)
  const MAX_DOWNLOAD_MS = 30 * 60 * 1000;

  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      ui.info(`Retry ${attempt}/3 (resuming from where it stopped)...`);
    }

    try {
      let exitCode: number;
      if (hasWget) {
        // --read-timeout=60: abort if no data received for 60s (stall detection)
        // --timeout=30: abort if connection takes >30s to establish
        // -c: resume partial downloads
        exitCode = await execStream(
          [
            'wget', '-c', '-q', '--show-progress',
            '--read-timeout=60', '--timeout=30',
            '-O', partPath, tierConfig.ggufUrl,
          ],
          { cwd: modelsDir, timeout: MAX_DOWNLOAD_MS },
        );
      } else {
        // --speed-limit 1000 --speed-time 60: abort if <1KB/s for 60s (stall detection)
        // --connect-timeout 30: abort if connection takes >30s
        // --max-time 1800: absolute 30m cap
        // -C -: resume partial downloads
        exitCode = await execStream(
          [
            'curl', '-fSL', '-C', '-',
            '--speed-limit', '1000', '--speed-time', '60',
            '--connect-timeout', '30',
            '-o', partPath, tierConfig.ggufUrl,
          ],
          { cwd: modelsDir, timeout: MAX_DOWNLOAD_MS },
        );
      }

      if (exitCode === 0) {
        // Rename .part to final name
        await exec(['mv', partPath, modelPath]);
        success = true;
        break;
      } else {
        ui.warn(`Download exited with code ${exitCode} (connection stalled or timed out)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('timed out') || msg.includes('timeout')) {
        ui.warn(`Download stalled — no data received for 60 seconds`);
      } else {
        ui.warn(`Download attempt ${attempt} failed: ${msg}`);
      }
    }
  }

  if (success) {
    const size = statSync(modelPath).size;
    const sizeGB = (size / 1024 / 1024 / 1024).toFixed(1);
    ui.ok(`Model downloaded: ${tierConfig.ggufFile} (${sizeGB}GB)`);
  } else {
    ui.fail(`Failed to download model after 3 attempts`);
    ui.info('Manual download:');
    console.log(`     wget -c -O "${modelPath}" "${tierConfig.ggufUrl}"`);
    console.log('');
    ui.info('Then re-run the installer to continue');
    throw new Error('Model download failed — cannot proceed without LLM model');
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await exec(['which', cmd], { throwOnError: false, timeout: 2000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
