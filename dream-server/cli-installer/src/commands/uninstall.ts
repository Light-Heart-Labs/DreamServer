// ── Uninstall Command ───────────────────────────────────────────────────────

import { exec } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import { removeDir, isDangerousPath } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';
import * as prompts from '../lib/prompts.ts';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface UninstallOptions {
  dir?: string;
  keepData?: boolean;
  force?: boolean;
}

export async function uninstall(opts: UninstallOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;

  if (!existsSync(join(installDir, '.env'))) {
    ui.fail('No Dream Server installation found');
    ui.info(`Expected at: ${installDir}`);
    process.exit(1);
  }

  ui.header('Uninstall Dream Server');
  console.log('');
  ui.info(`Install directory: ${installDir}`);
  console.log('');

  // ── Confirmation ──
  if (!opts.force) {
    ui.warn('This will stop all Dream Server services and remove containers.');
    if (!opts.keepData) {
      ui.warn('All data (models, configs, databases) will be PERMANENTLY DELETED.');
    }
    console.log('');

    const confirmed = await prompts.confirm('Are you sure you want to uninstall?');
    if (!confirmed) {
      ui.info('Uninstall cancelled.');
      return;
    }
    console.log('');
  }

  // ── Step 1: Stop and remove containers ──
  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch {
    ui.warn('Docker not available — skipping container cleanup');
    composeCmd = [];
  }

  if (composeCmd.length > 0) {
    const spinner = new ui.Spinner('Stopping services...');
    spinner.start();
    try {
      await exec(
        [...composeCmd, 'down', '--remove-orphans', '--timeout', '30'],
        { cwd: installDir, throwOnError: false, timeout: 120_000 },
      );
      spinner.succeed('Services stopped and containers removed');
    } catch {
      spinner.fail('Could not stop some services');
      ui.info('You may need to stop them manually: docker compose down');
    }

    // ── Step 2: Remove images ──
    const removeImages = opts.force || await prompts.confirm('Remove downloaded Docker images? (saves disk space)');
    if (removeImages) {
      const imgSpinner = new ui.Spinner('Removing Docker images...');
      imgSpinner.start();
      try {
        // Get list of images used by the project
        const { stdout } = await exec(
          [...composeCmd, 'config', '--images'],
          { cwd: installDir, throwOnError: false, timeout: 10_000 },
        );
        const images = stdout.trim().split('\n').filter(Boolean);

        if (images.length > 0) {
          await exec(
            ['docker', 'rmi', ...images],
            { throwOnError: false, timeout: 60_000 },
          );
          imgSpinner.succeed(`Removed ${images.length} Docker images`);
        } else {
          imgSpinner.succeed('No images to remove');
        }
      } catch {
        imgSpinner.fail('Could not remove some images (may be in use by other projects)');
      }
    }

    // ── Step 3: Remove Docker volumes (only if NOT keeping data) ──
    if (!opts.keepData) {
      try {
        await exec(
          [...composeCmd, 'down', '-v'],
          { cwd: installDir, throwOnError: false, timeout: 30_000 },
        );
        ui.ok('Docker volumes removed');
      } catch { /* volumes may not exist */ }
    }

    // ── Step 4: Remove network ──
    try {
      await exec(
        ['docker', 'network', 'rm', 'dream-network'],
        { throwOnError: false, timeout: 5_000 },
      );
    } catch { /* network may not exist or be in use */ }
  }

  // ── Step 5: Remove installation directory ──
  if (opts.keepData) {
    ui.info('Keeping data directory (--keep-data specified)');
  } else {
    const deleteData = opts.force || await prompts.confirm(`Delete installation directory ${installDir}?`);
    if (deleteData) {
      const target = resolve(installDir);
      if (isDangerousPath(target)) {
        ui.fail(`Safety check: refusing to delete system directory: ${target}`);
        return;
      }

      const delSpinner = new ui.Spinner(`Removing ${installDir}...`);
      delSpinner.start();
      try {
        removeDir(installDir);
        delSpinner.succeed('Installation directory removed');
      } catch {
        delSpinner.fail('Could not remove installation directory');
        ui.info(`Remove manually: ${installDir}`);
      }
    } else {
      ui.info('Installation directory preserved');
    }
  }

  console.log('');
  ui.header('Uninstall Complete');
  console.log('');
  ui.ok('Dream Server has been uninstalled');
  if (!opts.keepData) {
    ui.info('To reinstall: dream-installer install');
  } else {
    ui.info('Data preserved — reinstall will reuse existing data');
    ui.info('To reinstall: dream-installer install');
  }
  console.log('');
}
