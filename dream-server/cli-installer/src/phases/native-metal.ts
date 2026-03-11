// ── Phase: Native Metal llama-server (macOS Apple Silicon) ──────────────────
// Port of the critical Metal GPU acceleration logic from install-macos.sh.
//
// On macOS, Docker Desktop does not support Metal GPU passthrough. Running
// llama-server inside a Docker Linux VM forces it to CPU (ARM NEON), resulting
// in massive performance degradation (e.g., 40 tok/s → 3 tok/s).
//
// This phase downloads the native arm64 llama.cpp binary, launches it directly
// on the host with Metal GPU acceleration, and Docker containers connect to it
// via host.docker.internal:8080.

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec, execStream, commandExists } from '../lib/shell.ts';
import { IS_MACOS } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const LLAMA_CPP_RELEASE_TAG = 'b8277';
const LLAMA_CPP_MACOS_ASSET = `llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-arm64.tar.gz`;
const LLAMA_CPP_MACOS_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RELEASE_TAG}/${LLAMA_CPP_MACOS_ASSET}`;

/**
 * Download, extract, and launch native llama-server with Metal GPU acceleration.
 * Only runs on macOS with Apple Silicon (gpu.backend === 'apple').
 */
export async function nativeMetal(ctx: InstallContext): Promise<void> {
  if (!IS_MACOS || ctx.gpu.backend !== 'apple') return;

  ui.phase(0, 0, 'Native llama-server (Metal)');

  const binDir = join(ctx.installDir, 'bin');
  const llamaBin = join(binDir, 'llama-server');
  const pidFile = join(ctx.installDir, 'data', '.llama-server.pid');
  const logFile = join(ctx.installDir, 'data', 'llama-server.log');

  const tierCfg = TIER_MAP[ctx.tier] || TIER_MAP['1'];
  const ggufFile = tierCfg.ggufFile;
  const modelPath = join(ctx.installDir, 'data', 'models', ggufFile);
  const ctxSize = tierCfg.context;

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would download llama-server (Metal build)');
    ui.info('[DRY RUN] Would start native llama-server on port 8080');
    ui.info('[DRY RUN] Docker containers would connect via host.docker.internal:8080');
    return;
  }

  // ── Step 1: Download and extract llama-server binary ──
  if (!existsSync(llamaBin)) {
    mkdirSync(binDir, { recursive: true });

    const secTmpDir = mkdtempSync(join(tmpdir(), 'llama-dl-'));
    const tmpZip = join(secTmpDir, LLAMA_CPP_MACOS_ASSET);
    let downloadOk = false;

    if (!existsSync(tmpZip)) {
      ui.info('Downloading llama-server (Metal build)...');
      const hasCurl = await commandExists('curl');
      const hasWget = await commandExists('wget');

      if (hasCurl) {
        const code = await execStream(
          ['curl', '-L', '--progress-bar', '-o', tmpZip, LLAMA_CPP_MACOS_URL],
          { timeout: 600_000 },
        );
        downloadOk = code === 0;
      } else if (hasWget) {
        const code = await execStream(
          ['wget', '-q', '--show-progress', '-O', tmpZip, LLAMA_CPP_MACOS_URL],
          { timeout: 600_000 },
        );
        downloadOk = code === 0;
      }

      if (!downloadOk) {
        // Fallback: try Homebrew
        ui.warn('Pre-built binary download failed. Trying Homebrew...');
        const hasBrew = await commandExists('brew');
        if (hasBrew) {
          const brewResult = await exec(
            ['brew', 'install', 'llama.cpp'],
            { throwOnError: false, timeout: 300_000 },
          );
          if (brewResult.exitCode === 0) {
            const which = await exec(['which', 'llama-server'], { throwOnError: false });
            if (which.exitCode === 0 && which.stdout) {
              const { copyFileSync: cpFile } = await import('node:fs');
              mkdirSync(binDir, { recursive: true });
              cpFile(which.stdout.trim(), llamaBin);
              chmodSync(llamaBin, 0o755);
              ui.ok('Installed llama-server via Homebrew');
            }
          } else {
            ui.fail('Could not install llama-server. Install manually: brew install llama.cpp');
            return;
          }
        } else {
          ui.fail('llama-server download failed and Homebrew not available.');
          ui.info('Install Homebrew: https://brew.sh');
          ui.info('Then: brew install llama.cpp');
          return;
        }
      }
    }

    // Extract from tar.gz if we downloaded it
    if (existsSync(tmpZip) && !existsSync(llamaBin)) {
      ui.info('Extracting llama-server...');
      const tmpExtract = mkdtempSync(join(tmpdir(), 'llama-extract-'));
      mkdirSync(tmpExtract, { recursive: true });

      const ext = await exec(
        ['tar', 'xzf', tmpZip, '-C', tmpExtract],
        { throwOnError: false, timeout: 30_000 },
      );

      if (ext.exitCode === 0) {
        // Find llama-server binary (may be nested in a subdirectory)
        const find = await exec(
          ['find', tmpExtract, '-name', 'llama-server', '-type', 'f'],
          { throwOnError: false },
        );
        const foundBin = find.stdout.split('\n')[0]?.trim();

        if (foundBin && existsSync(foundBin)) {
          const { copyFileSync: cpFile, readdirSync } = await import('node:fs');
          mkdirSync(binDir, { recursive: true });
          cpFile(foundBin, llamaBin);
          chmodSync(llamaBin, 0o755);

          // Copy companion dylibs and Metal libraries
          const foundDir = join(foundBin, '..');
          try {
            const files = readdirSync(foundDir);
            for (const f of files) {
              if (f.endsWith('.dylib') || f.endsWith('.metal')) {
                cpFile(join(foundDir, f), join(binDir, f));
              }
            }
          } catch { /* ignore */ }

          ui.ok('Extracted llama-server');
        } else {
          ui.fail('llama-server binary not found in archive');
          ui.info('Try: brew install llama.cpp');
          return;
        }
      } else {
        ui.fail('Failed to extract llama-server archive');
        return;
      }

      // Cleanup temp directories
      try {
        const { rmSync } = await import('node:fs');
        rmSync(tmpExtract, { recursive: true, force: true });
        rmSync(secTmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }

    // Remove macOS Gatekeeper quarantine attribute
    if (existsSync(llamaBin)) {
      await exec(['xattr', '-rd', 'com.apple.quarantine', llamaBin], { throwOnError: false });
      await exec(['xattr', '-rd', 'com.apple.quarantine', binDir], { throwOnError: false });
    }
  } else {
    ui.ok('llama-server already present');
  }

  if (!existsSync(llamaBin)) {
    ui.fail('llama-server binary not available — cannot start native Metal inference');
    return;
  }

  // ── Step 2: Kill any existing llama-server ──
  if (existsSync(pidFile)) {
    try {
      const oldPid = readFileSync(pidFile, 'utf-8').trim();
      if (oldPid) {
        await exec(['kill', oldPid], { throwOnError: false });
        // Give it a moment to shut down
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch { /* ignore */ }
  }

  // ── Step 3: Start native llama-server with Metal ──
  if (!existsSync(modelPath)) {
    ui.warn(`Model not found at ${modelPath} — skipping native llama-server start`);
    ui.info('Run the model download first, then restart with: dream-installer install');
    return;
  }

  ui.info('Starting native llama-server (Metal)...');

  mkdirSync(join(ctx.installDir, 'data'), { recursive: true });

  // Launch in background
  const llamaArgs = [
    '--host', '0.0.0.0', '--port', '8080',
    '--model', modelPath,
    '--ctx-size', String(ctxSize),
    '--n-gpu-layers', '999',
    '--metrics',
  ];

  try {
    const logTarget = Bun.file(logFile);
    const proc = Bun.spawn([llamaBin, ...llamaArgs], {
      stdout: logTarget,
      stderr: logTarget,
    });

    // Write PID file
    writeFileSync(pidFile, String(proc.pid));

    // Detach daemon so the CLI process can exit cleanly
    proc.unref();

    // Wait for health endpoint
    ui.info('Waiting for llama-server to load model...');
    const maxWait = 180; // seconds
    let waited = 0;
    let healthy = false;

    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, 2000));
      waited += 2;

      const health = await exec(
        ['curl', '-sf', 'http://localhost:8080/health'],
        { throwOnError: false, timeout: 3000 },
      );
      if (health.exitCode === 0) {
        healthy = true;
        break;
      }

      // Check if process died
      const alive = await exec(['kill', '-0', String(proc.pid)], { throwOnError: false });
      if (alive.exitCode !== 0) {
        ui.fail('llama-server process died. Check logs:');
        ui.info(`  tail -50 ${logFile}`);
        return;
      }

      if (waited % 10 === 0) {
        ui.info(`  Still loading... (${waited}s)`);
      }
    }

    if (healthy) {
      ui.ok(`Native llama-server healthy (PID ${proc.pid}) — Metal GPU acceleration active`);
    } else {
      ui.warn(`llama-server did not become healthy within ${maxWait}s. It may still be loading.`);
    }
  } catch (err) {
    ui.fail(`Failed to start llama-server: ${err instanceof Error ? err.message : String(err)}`);
    ui.info(`Check logs: tail -50 ${logFile}`);
  }
}

/**
 * Kill the native llama-server daemon by reading the PID file.
 * Used by uninstall, update, and config commands for lifecycle management.
 */
export async function killNativeLlama(installDir: string): Promise<void> {
  const pidFile = join(installDir, 'data', '.llama-server.pid');
  if (!existsSync(pidFile)) return;

  try {
    const pid = readFileSync(pidFile, 'utf-8').trim();
    if (pid) {
      await exec(['kill', pid], { throwOnError: false });
      await new Promise(r => setTimeout(r, 2000));

      // SIGKILL fallback if SIGTERM was ignored (GPU deadlock)
      const check = await exec(['kill', '-0', pid], { throwOnError: false });
      if (check.exitCode === 0) {
        await exec(['kill', '-9', pid], { throwOnError: false });
        await new Promise(r => setTimeout(r, 500));
      }
    }
    unlinkSync(pidFile);
  } catch { /* ignore */ }
}

/**
 * Check if the native llama-server daemon is running.
 * Used by the status command.
 */
export async function isNativeLlamaRunning(installDir: string): Promise<{ running: boolean; pid: number | null }> {
  const pidFile = join(installDir, 'data', '.llama-server.pid');
  if (!existsSync(pidFile)) return { running: false, pid: null };

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) return { running: false, pid: null };

    const { exitCode } = await exec(['kill', '-0', String(pid)], { throwOnError: false });
    return { running: exitCode === 0, pid };
  } catch {
    return { running: false, pid: null };
  }
}
