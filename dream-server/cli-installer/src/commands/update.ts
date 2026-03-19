// ── Update Command ──────────────────────────────────────────────────────────
// Pull latest code, self-update binary with SHA256 verification, restart services.

import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { createDefaultContext, DEFAULT_INSTALL_DIR, TIER_MAP, VERSION } from '../lib/config.ts';
import { IS_WINDOWS, IS_MACOS, moveFile, removeDir } from '../lib/platform.ts';
import { killNativeLlama, nativeMetal } from '../phases/native-metal.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface UpdateOptions {
  dir?: string;
  skipSelfUpdate?: boolean;
}

const RELEASE_BASE = 'https://github.com/Light-Heart-Labs/DreamServer/releases/latest/download';

/**
 * Get the correct binary name for the current architecture.
 */
function getBinaryName(): string {
  if (IS_WINDOWS) return 'dream-installer-windows-x64.exe';
  if (IS_MACOS) {
    return process.arch === 'arm64' ? 'dream-installer-macos-arm64' : 'dream-installer-macos-x64';
  }
  if (process.arch === 'arm64') return 'dream-installer-linux-arm64';
  return 'dream-installer-linux-x64';
}

export async function update(opts: UpdateOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;

  if (!existsSync(join(installDir, '.env'))) {
    ui.fail('No Dream Server installation found');
    ui.info('Run: dream-installer install');
    process.exit(1);
  }

  ui.header('Dream Server Update');
  console.log('');

  // Step 1: Self-update the CLI binary
  if (!opts.skipSelfUpdate) {
    await selfUpdate();
  }

  // Step 2: Pull latest code
  ui.step('Pulling latest code...');
  if (existsSync(join(installDir, '.git'))) {
    const exitCode = await execStream(['git', 'pull', '--ff-only'], { cwd: installDir });
    if (exitCode === 0) {
      ui.ok('Code updated');
    } else {
      ui.warn('git pull failed — may have local changes');
      ui.info('Try: cd ' + installDir + ' && git stash && git pull');
    }
  } else {
    ui.warn('Not a git repo — skipping code update');
  }

  // Step 3: Restart services
  console.log('');
  ui.step('Restarting services...');

  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch {
    ui.fail('Docker not available');
    return;
  }

  // Pull new images
  ui.step('Checking for image updates...');
  await execStream([...composeCmd, 'pull'], { cwd: installDir });

  // Rebuild local images
  ui.step('Rebuilding local images...');
  await execStream([...composeCmd, 'build', '--pull'], { cwd: installDir });

  // Restart with new code/images
  ui.step('Restarting containers...');
  const exitCode = await execStream(
    [...composeCmd, 'up', '-d', '--remove-orphans'],
    { cwd: installDir },
  );

  if (exitCode === 0) {
    ui.ok('All services restarted');
  } else {
    ui.warn('Some services may have failed — check: docker compose ps');
  }

  // Step 4: Restart native llama-server if on macOS Apple Silicon
  const envContent = readFileSync(join(installDir, '.env'), 'utf-8');
  const envParsed = parseEnv(envContent);
  if (envParsed.GPU_BACKEND === 'apple') {
    ui.step('Restarting native Metal llama-server...');
    await killNativeLlama(installDir);
    const ctx = createDefaultContext();
    ctx.installDir = installDir;
    ctx.gpu = { backend: 'apple', name: 'Apple Silicon', vramMB: 0, count: 0 };
    // Derive tier from .env — if TIER is missing, reverse-lookup from GGUF_FILE
    let tier = envParsed.TIER;
    if (!tier && envParsed.GGUF_FILE) {
      const match = Object.entries(TIER_MAP).find(([, t]) => t.ggufFile === envParsed.GGUF_FILE);
      if (match) tier = match[0];
    }
    ctx.tier = tier || '1';
    await nativeMetal(ctx);
  }

  console.log('');
  ui.ok('Update complete');
  console.log('');
}

async function selfUpdate(): Promise<void> {
  ui.step('Checking for CLI updates...');

  const binaryName = getBinaryName();
  const binaryUrl = `${RELEASE_BASE}/${binaryName}`;
  const checksumUrl = `${RELEASE_BASE}/${binaryName}.sha256`;
  const currentBinary = process.execPath;

  // Create a secure temporary directory (prevents symlink attacks on /tmp)
  let tmpDir: string;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-update-'));
  } catch {
    ui.warn('Cannot create temp directory — skipping self-update');
    return;
  }

  // Download using artifact name so sha256sum --check can find the file
  const tmpPath = join(tmpDir, binaryName);
  const tmpChecksum = join(tmpDir, `${binaryName}.sha256`);

  try {
    // Check latest release via GitHub API (just HEAD request for speed)
    const resp = await fetch(binaryUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      ui.info(`No release binary found (${resp.status}) — skipping self-update`);
      return;
    }

    // Download binary
    ui.step('Downloading latest CLI...');
    const downloadExitCode = await execStream(
      ['curl', '-fSL', '--connect-timeout', '10', '-o', tmpPath, binaryUrl],
    );

    if (downloadExitCode !== 0) {
      ui.warn('Failed to download update — continuing with current version');
      return;
    }

    // Download and verify checksum
    const checksumExitCode = await execStream(
      ['curl', '-fSL', '--connect-timeout', '10', '-o', tmpChecksum, checksumUrl],
    );

    if (checksumExitCode === 0) {
      // Verify SHA256 — try sha256sum (Linux), shasum (macOS), or Bun crypto (Windows/fallback)
      let verifyCode = 1;
      if (IS_WINDOWS) {
        // On Windows, verify using Bun's crypto
        try {
          const expectedLine = readFileSync(tmpChecksum, 'utf-8').trim();
          const expectedHash = expectedLine.split(/\s+/)[0].toLowerCase();
          const binaryData = readFileSync(tmpPath);
          const hasher = new Bun.CryptoHasher('sha256');
          hasher.update(binaryData);
          const actualHash = hasher.digest('hex');
          verifyCode = actualHash === expectedHash ? 0 : 1;
        } catch { /* verification failed */ }
      } else if (IS_MACOS) {
        // macOS: sha256sum not available, use shasum -a 256
        const result = await exec(
          ['shasum', '-a', '256', '--check', `${binaryName}.sha256`],
          { cwd: tmpDir, throwOnError: false, timeout: 10000 },
        );
        verifyCode = result.exitCode;
      } else {
        // Linux
        const result = await exec(
          ['sha256sum', '--check', `${binaryName}.sha256`],
          { cwd: tmpDir, throwOnError: false, timeout: 10000 },
        );
        verifyCode = result.exitCode;
      }

      if (verifyCode !== 0) {
        ui.fail('SHA256 verification failed — update aborted (binary may be tampered)');
        return;
      }
      ui.ok('SHA256 checksum verified');
    } else {
      ui.fail('No checksum file available — update aborted (integrity cannot be verified)');
      return;
    }

    // Keep current binary as backup for rollback
    const bakPath = `${currentBinary}.bak`;
    try { rmSync(bakPath, { force: true }); } catch { /* no old backup */ }
    if (IS_WINDOWS) {
      // Windows locks running executables for overwriting but allows renaming.
      // Rename (not copy) to free the execution path before placing the new binary.
      try { const { renameSync } = await import('node:fs'); renameSync(currentBinary, bakPath); } catch { /* best effort */ }
    } else {
      // Unix: copy so the running process keeps its file descriptor
      try { copyFileSync(currentBinary, bakPath); } catch { /* best effort */ }
    }

    // Make executable (Linux/macOS only — Windows executables don't need chmod)
    if (!IS_WINDOWS) {
      await exec(['chmod', '+x', tmpPath], { throwOnError: false });
    }
    moveFile(tmpPath, currentBinary);

    ui.ok('CLI updated to latest version');
    ui.info('New version will take effect on next run');

    // Verify new binary works — explicitly check exitCode (not catch-based)
    const { exitCode: verifyExitCode } = await exec(
      [currentBinary, '--version'],
      { throwOnError: false, timeout: 5000 },
    );

    if (verifyExitCode !== 0) {
      // Rollback on failure
      ui.warn('New binary failed to execute — rolling back');
      moveFile(bakPath, currentBinary);
    } else {
      // Clean up backup on success
      try { rmSync(bakPath, { force: true }); } catch { /* best effort */ }
    }
  } catch (e) {
    ui.info('Self-update unavailable — continuing with current version');
  } finally {
    // Always clean up temp directory
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
