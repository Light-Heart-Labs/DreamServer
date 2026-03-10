// ── Update Command ──────────────────────────────────────────────────────────
// Pull latest code, self-update binary with SHA256 verification, restart services.

import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import * as ui from '../lib/ui.ts';
import { VERSION } from '../lib/config.ts';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  if (process.arch === 'arm64') return 'dream-installer-linux-arm64';
  return 'dream-installer-linux-x64';
}

export async function update(opts: UpdateOptions): Promise<void> {
  const installDir = opts.dir || `${process.env.HOME}/dream-server`;

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
      // Verify SHA256 (cwd = tmpDir so sha256sum finds the artifact by name)
      const { exitCode: verifyCode } = await exec(
        ['sha256sum', '--check', `${binaryName}.sha256`],
        { cwd: tmpDir, throwOnError: false, timeout: 10000 },
      );

      if (verifyCode !== 0) {
        ui.fail('SHA256 verification failed — update aborted (binary may be tampered)');
        return;
      }
      ui.ok('SHA256 checksum verified');
    } else {
      ui.warn('No checksum file available — skipping integrity verification');
    }

    // Keep current binary as backup for rollback
    const bakPath = `${currentBinary}.bak`;
    try {
      await exec(['cp', currentBinary, bakPath], { throwOnError: false });
    } catch { /* best effort */ }

    // Make executable and replace
    await exec(['chmod', '+x', tmpPath]);
    await exec(['mv', tmpPath, currentBinary]);

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
      await exec(['mv', bakPath, currentBinary], { throwOnError: false });
    } else {
      // Clean up backup on success
      await exec(['rm', '-f', bakPath], { throwOnError: false });
    }
  } catch (e) {
    ui.info('Self-update unavailable — continuing with current version');
  } finally {
    // Always clean up temp directory
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
