// ── Doctor Command ──────────────────────────────────────────────────────────
// Diagnostics, log checking, .env validation, and system health assessment.

import { exec, commandExists } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import { parseEnv } from '../lib/env.ts';
import { isPortFree, getRequiredPorts } from '../lib/ports.ts';
import { createDefaultContext } from '../lib/config.ts';
import { getAvailableRamMB, getDiskGB, getDockerDaemonFixHint } from '../lib/platform.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DoctorOptions {
  dir?: string;
}

/** Required .env keys for a minimal functional installation. */
const REQUIRED_ENV_KEYS = [
  'WEBUI_SECRET',
  'LLM_API_URL',
  'GPU_BACKEND',
  'LLM_MODEL',
  'COMPOSE_FILE',
];

export async function doctor(opts: DoctorOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;

  ui.header('Dream Server Doctor');
  console.log('');
  ui.step('Running diagnostic checks...');
  console.log('');

  let issues = 0;
  let warnings = 0;

  // ── Check 1: Installation exists ──────────────────────────────────────
  if (!existsSync(installDir)) {
    ui.fail(`Installation directory not found: ${installDir}`);
    ui.info('Run: dream-installer install');
    process.exit(1);
  }
  ui.ok(`Installation directory: ${installDir}`);

  // ── Check 2: .env validation ──────────────────────────────────────────
  const envPath = join(installDir, '.env');
  if (!existsSync(envPath)) {
    ui.fail('.env file not found');
    issues++;
  } else {
    const envContent = readFileSync(envPath, 'utf-8');
    const env = parseEnv(envContent);
    const missingKeys: string[] = [];

    for (const key of REQUIRED_ENV_KEYS) {
      if (!env[key]) {
        missingKeys.push(key);
      }
    }

    if (missingKeys.length > 0) {
      ui.fail(`.env missing required keys: ${missingKeys.join(', ')}`);
      issues++;
    } else {
      ui.ok(`.env valid (${Object.keys(env).length} keys)`);
    }

    // Check for empty secrets
    const emptySecrets: string[] = [];
    for (const key of ['WEBUI_SECRET', 'DASHBOARD_API_KEY']) {
      if (env[key] && env[key].length < 8) {
        emptySecrets.push(key);
      }
    }
    if (emptySecrets.length > 0) {
      ui.warn(`Weak secrets: ${emptySecrets.join(', ')} (should be 16+ chars)`);
      warnings++;
    }
  }

  // ── Check 3: Docker connectivity ──────────────────────────────────────
  let composeCmd: string[] | null = null;
  try {
    composeCmd = await getComposeCommand();
    ui.ok(`Docker: ${composeCmd.join(' ')}`);
  } catch {
    const hasDocker = await commandExists('docker');
    if (!hasDocker) {
      ui.fail('Docker not installed');
      issues++;
    } else {
      ui.fail('Docker daemon not reachable');
      for (const hint of getDockerDaemonFixHint()) {
        ui.info(hint);
      }
      issues++;
    }
  }

  // ── Check 4: Container health ─────────────────────────────────────────
  if (composeCmd) {
    try {
      const { stdout } = await exec(
        [...composeCmd, 'ps', '--format', 'json'],
        { cwd: installDir, throwOnError: false, timeout: 10000 },
      );

      if (stdout.trim()) {
        let containers: Record<string, unknown>[] = [];
        const trimmed = stdout.trim();
        if (trimmed.startsWith('[')) {
          try { containers = JSON.parse(trimmed); } catch {
            ui.warn('Could not parse container JSON');
          }
        } else {
          for (const line of trimmed.split('\n')) {
            try { containers.push(JSON.parse(line)); } catch { /* non-JSON line */ }
          }
        }

        const running: string[] = [];
        const failed: string[] = [];
        const restarting: string[] = [];

        for (const c of containers) {
          const name = ((c.Name ?? c.name ?? '') as string).replace(/^dream-/, '');
          const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
          const status = (c.Status ?? c.status ?? '') as string;

          if (state === 'running') {
            // Check for restart loops
            if (/restarting/i.test(status)) {
              restarting.push(name);
            } else {
              running.push(name);
            }
          } else {
            failed.push(`${name} (${status || state})`);
          }
        }

        if (running.length > 0) ui.ok(`Running: ${running.length} container(s)`);
        if (restarting.length > 0) {
          ui.warn(`Restart loop detected: ${restarting.join(', ')}`);
          warnings++;
        }
        if (failed.length > 0) {
          for (const f of failed) ui.fail(f);
          issues += failed.length;
        }
        if (containers.length === 0) {
          ui.warn('No containers found — services may not be started');
          warnings++;
        }
      } else {
        ui.warn('No containers running');
        warnings++;
      }
    } catch {
      ui.warn('Could not query container status');
      warnings++;
    }
  }

  // ── Check 5: Port conflicts ───────────────────────────────────────────
  const ctx = createDefaultContext();
  ctx.installDir = installDir;

  // Load features from env for accurate port checking
  if (existsSync(envPath)) {
    const env = parseEnv(readFileSync(envPath, 'utf-8'));
    ctx.features.voice = env.ENABLE_VOICE === 'true';
    ctx.features.workflows = env.ENABLE_WORKFLOWS === 'true';
    ctx.features.rag = env.ENABLE_RAG === 'true';
    ctx.features.openclaw = env.ENABLE_OPENCLAW === 'true';
  }

  const requiredPorts = getRequiredPorts(ctx);
  const conflicts: string[] = [];
  for (const { service, port } of requiredPorts) {
    const free = await isPortFree(port);
    if (!free) {
      conflicts.push(`${port} (${service})`);
    }
  }

  // Note: ports being "in use" is expected when services are running
  if (conflicts.length > 0 && !composeCmd) {
    ui.warn(`Port conflicts (with no Docker running): ${conflicts.join(', ')}`);
    warnings++;
  } else if (conflicts.length === 0) {
    ui.ok(`All ${requiredPorts.length} service ports available`);
  }

  // ── Check 6: System resources ─────────────────────────────────────────
  try {
    const availMB = getAvailableRamMB();
    if (availMB < 2048) {
      ui.warn(`Low available RAM: ${availMB}MB`);
      warnings++;
    } else {
      ui.ok(`Available RAM: ${Math.round(availMB / 1024)}GB`);
    }
  } catch {
    // RAM detection failed
  }

  // Disk space
  try {
    const availGB = await getDiskGB(installDir);
    if (availGB < 10) {
      ui.warn(`Low disk space: ${availGB}GB available`);
      warnings++;
    } else {
      ui.ok(`Disk space: ${availGB}GB available`);
    }
  } catch {
    // Disk detection failed
  }

  // ── Check 7: NVIDIA driver ────────────────────────────────────────────
  const hasNvidiaSmi = await commandExists('nvidia-smi');
  if (hasNvidiaSmi) {
    try {
      const { stdout } = await exec(
        ['nvidia-smi', '--query-gpu=driver_version', '--format=csv,noheader'],
        { throwOnError: false, timeout: 5000 },
      );
      const version = parseInt(stdout.trim().split('.')[0], 10);
      if (version < 535) {
        ui.warn(`NVIDIA driver ${stdout.trim()} is old (535+ recommended)`);
        warnings++;
      } else {
        ui.ok(`NVIDIA driver: ${stdout.trim()}`);
      }
    } catch {
      ui.warn('nvidia-smi failed — driver may be misconfigured');
      warnings++;
    }
  }

  // ── Check 8: Log analysis ────────────────────────────────────────────
  if (composeCmd) {
    try {
      const { stdout, stderr } = await exec(
        [...composeCmd, 'logs', '--tail', '50', '--no-color'],
        { cwd: installDir, throwOnError: false, timeout: 15000 },
      );
      const logs = (stderr || stdout).toLowerCase();

      const patterns: [RegExp, string][] = [
        [/out of memory|oom|cuda out of memory/i, 'GPU OOM detected — consider a lower tier or fewer services'],
        [/permission denied|eacces/i, 'Permission errors detected — check data directory ownership'],
        [/model.*not found|no such file/i, 'Missing model file — try: dream-installer install'],
        [/connection refused.*5432|postgres.*connection/i, 'Database connection issues detected'],
      ];

      for (const [regex, msg] of patterns) {
        if (regex.test(logs)) {
          ui.warn(msg);
          warnings++;
        }
      }
    } catch {
      // Cannot read compose logs — Docker may be unreachable
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('');
  if (issues === 0 && warnings === 0) {
    ui.ok('All checks passed — Dream Server is healthy');
  } else if (issues === 0) {
    ui.warn(`${warnings} warning(s), no critical issues`);
  } else {
    ui.fail(`${issues} issue(s) and ${warnings} warning(s) found`);
  }
  console.log('');
}
