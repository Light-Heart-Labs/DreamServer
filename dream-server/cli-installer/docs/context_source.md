# Directory Structure Report

This document contains files from the `/home/igorls/dev/upwork/DreamServer/dream-server/cli-installer` directory with extensions: ts
Custom ignored patterns: tests
Content hash: 3dc41a3c9bad5bfa

## File Tree Structure

- 📁 src
  - 📁 commands
    - 📄 config.ts
    - 📄 doctor.ts
    - 📄 install.ts
    - 📄 status.ts
    - 📄 uninstall.ts
    - 📄 update.ts
  - 📄 index.ts
  - 📁 lib
    - 📄 config.ts
    - 📄 docker.ts
    - 📄 env.ts
    - 📄 ports.ts
    - 📄 prompts.ts
    - 📄 shell.ts
    - 📄 ui.ts
  - 📁 phases
    - 📄 configure.ts
    - 📄 detection.ts
    - 📄 features.ts
    - 📄 health.ts
    - 📄 model.ts
    - 📄 preflight.ts
    - 📄 services.ts


### File: `src/index.ts`

- Size: 2789 bytes
- Modified: 2026-03-10 21:43:42 UTC

```typescript
#!/usr/bin/env bun
// ── Dream Server CLI ────────────────────────────────────────────────────────

import { Command } from 'commander';
import { install } from './commands/install.ts';
import { status } from './commands/status.ts';
import { config } from './commands/config.ts';
import { update } from './commands/update.ts';
import { uninstall } from './commands/uninstall.ts';
import { doctor } from './commands/doctor.ts';
import { VERSION, DEFAULT_INSTALL_DIR } from './lib/config.ts';

const program = new Command()
  .name('dream-installer')
  .description('Dream Server — Local AI Management CLI')
  .version(VERSION);

program
  .command('install')
  .description('Install or resume Dream Server setup')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--force', 'Overwrite existing installation')
  .option('--tier <tier>', 'Force specific tier (1-4, NV_ULTRA)')
  .option('--non-interactive', 'Run without prompts (use defaults)')
  .option('--all', 'Enable all optional services')
  .option('--voice', 'Enable voice services')
  .option('--workflows', 'Enable n8n workflows')
  .option('--rag', 'Enable RAG with Qdrant')
  .option('--openclaw', 'Enable OpenClaw agents')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(install);

program
  .command('status')
  .description('Show running services, health, and configuration')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(status);

program
  .command('config')
  .description('Reconfigure features, tier, or model')
  .option('--features', 'Configure features only')
  .option('--tier', 'Configure tier/model only')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(config);

program
  .command('update')
  .description('Pull latest code, update images, and restart')
  .option('--skip-self-update', 'Skip CLI binary self-update')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(update);

program
  .command('uninstall')
  .description('Stop services, remove containers/images, and optionally delete data')
  .option('--keep-data', 'Keep data directory (models, databases, configs)')
  .option('--force', 'Skip confirmation prompts')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(uninstall);

program
  .command('doctor')
  .description('Run diagnostics and health checks')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(doctor);

// Default to install if no command specified
if (process.argv.length <= 2) {
  process.argv.push('install');
}

program.parse();
```

### File: `src/commands/config.ts`

- Size: 6664 bytes
- Modified: 2026-03-10 21:36:50 UTC

```typescript
// ── Config Command ──────────────────────────────────────────────────────────
// Reconfigure features, tier, or model on an existing installation.

import { type InstallContext, createDefaultContext, TIER_MAP, type FeatureSet } from '../lib/config.ts';
import { resolveComposeFiles } from '../phases/configure.ts';
import { downloadModel } from '../phases/model.ts';
import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { parseEnv, setEnvValue } from '../lib/env.ts';
import { select, multiSelect } from '../lib/prompts.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ConfigOptions {
  dir?: string;
  features?: boolean;
  tier?: boolean;
}

export async function config(opts: ConfigOptions): Promise<void> {
  const installDir = opts.dir || `${process.env.HOME}/dream-server`;
  const envPath = join(installDir, '.env');

  if (!existsSync(envPath)) {
    ui.fail('No Dream Server installation found');
    ui.info('Run: dream-installer install');
    process.exit(1);
  }

  ui.header('Dream Server Configuration');
  console.log('');

  // Read current .env
  let envContent = readFileSync(envPath, 'utf-8');
  const envParsed = parseEnv(envContent);
  const getEnv = (key: string): string => envParsed[key] || '';
  const setEnv = (key: string, value: string): void => {
    envContent = setEnvValue(envContent, key, value);
  };

  let changed = false;

  // Show what to configure if no specific flag
  if (!opts.features && !opts.tier) {
    const choice = await select('What would you like to configure?', [
      { label: 'Features', description: 'Enable/disable Voice, Workflows, RAG, OpenClaw' },
      { label: 'Tier / Model', description: `Currently: ${getEnv('LLM_MODEL') || 'unknown'}` },
      { label: 'Both', description: 'Change features and model' },
    ]);
    opts.features = choice === 0 || choice === 2;
    opts.tier = choice === 1 || choice === 2;
  }

  // ── Feature configuration ──
  if (opts.features) {
    ui.step('Configure features:');
    const results = await multiSelect('Toggle features', [
      { label: 'Voice', description: 'Whisper STT + Kokoro TTS', checked: getEnv('ENABLE_VOICE') === 'true' },
      { label: 'Workflows', description: 'n8n automation', checked: getEnv('ENABLE_WORKFLOWS') === 'true' },
      { label: 'RAG', description: 'Qdrant vector database', checked: getEnv('ENABLE_RAG') === 'true' },
      { label: 'OpenClaw', description: 'AI agent framework', checked: getEnv('ENABLE_OPENCLAW') === 'true' },
    ]);

    const newFeatures: FeatureSet = {
      voice: results[0],
      workflows: results[1],
      rag: results[2],
      openclaw: results[3],
    };

    // Check what changed
    const oldFeatures = {
      voice: getEnv('ENABLE_VOICE') === 'true',
      workflows: getEnv('ENABLE_WORKFLOWS') === 'true',
      rag: getEnv('ENABLE_RAG') === 'true',
      openclaw: getEnv('ENABLE_OPENCLAW') === 'true',
    };

    const featureChanges: string[] = [];
    for (const [key, val] of Object.entries(newFeatures) as [keyof FeatureSet, boolean][]) {
      if (val !== oldFeatures[key]) {
        featureChanges.push(`${key}: ${oldFeatures[key]} → ${val}`);
      }
    }

    if (featureChanges.length > 0) {
      setEnv('ENABLE_VOICE', String(newFeatures.voice));
      setEnv('ENABLE_WORKFLOWS', String(newFeatures.workflows));
      setEnv('ENABLE_RAG', String(newFeatures.rag));
      setEnv('ENABLE_OPENCLAW', String(newFeatures.openclaw));
      changed = true;
      for (const c of featureChanges) ui.ok(c);
    } else {
      ui.info('No feature changes');
    }
  }

  // ── Tier / Model configuration ──
  if (opts.tier) {
    console.log('');
    ui.step('Configure model:');

    const currentModel = getEnv('LLM_MODEL');
    const tierEntries = Object.entries(TIER_MAP);

    const tierChoice = await select('Select model tier', tierEntries.map(([id, t]) => ({
      label: `Tier ${id}: ${t.name}`,
      description: `${t.model} (${t.ggufFile}, ctx: ${t.context})`,
      hint: t.model === currentModel ? 'current' : undefined,
    })));

    const [tierId, tierConfig] = tierEntries[tierChoice];

    if (tierConfig.model !== currentModel) {
      setEnv('LLM_MODEL', tierConfig.model);
      setEnv('GGUF_FILE', tierConfig.ggufFile);
      setEnv('CTX_SIZE', String(tierConfig.context));
      setEnv('MAX_CONTEXT', String(tierConfig.context));
      changed = true;
      ui.ok(`Model: ${currentModel} → ${tierConfig.model}`);

      // Check if new model needs downloading
      const modelsDir = join(installDir, 'data', 'models');
      const modelPath = join(modelsDir, tierConfig.ggufFile);
      if (!existsSync(modelPath) && tierConfig.ggufUrl) {
        console.log('');
        ui.info('New model needs to be downloaded');
        const ctx = createDefaultContext();
        ctx.installDir = installDir;
        ctx.tier = tierId;
        await downloadModel(ctx);
      }
    } else {
      ui.info('Model unchanged');
    }
  }

  if (!changed) {
    console.log('');
    ui.info('No changes made');
    return;
  }

  // Rebuild compose file list
  console.log('');
  ui.step('Updating configuration...');

  // Build a context to resolve compose files
  const ctx = createDefaultContext();
  ctx.installDir = installDir;
  // Rebuild from parsed env for consistency
  const rebuildParsed = parseEnv(envContent);
  ctx.features = {
    voice: rebuildParsed.ENABLE_VOICE === 'true',
    workflows: rebuildParsed.ENABLE_WORKFLOWS === 'true',
    rag: rebuildParsed.ENABLE_RAG === 'true',
    openclaw: rebuildParsed.ENABLE_OPENCLAW === 'true',
  };
  const gpuBackend = getEnv('GPU_BACKEND');
  ctx.gpu.backend = (gpuBackend as 'nvidia' | 'amd' | 'cpu') || 'cpu';

  const composeFiles = resolveComposeFiles(ctx);
  const composePaths = composeFiles.map(f => f.replace(installDir + '/', '')).join(':');
  setEnv('COMPOSE_FILE', composePaths);

  // Write updated .env
  writeFileSync(envPath, envContent);
  ui.ok('Updated .env');

  // Restart services
  console.log('');
  ui.step('Restarting services...');

  try {
    const composeCmd = await getComposeCommand();
    await execStream([...composeCmd, 'up', '-d', '--remove-orphans'], { cwd: installDir });
    ui.ok('Services restarted');
  } catch {
    ui.fail('Docker not available — restart manually');
    ui.info(`cd ${installDir} && docker compose up -d`);
  }

  console.log('');
}
```

### File: `src/commands/doctor.ts`

- Size: 10129 bytes
- Modified: 2026-03-10 21:43:19 UTC

```typescript
// ── Doctor Command ──────────────────────────────────────────────────────────
// Diagnostics, log checking, .env validation, and system health assessment.

import { exec, commandExists } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import { parseEnv } from '../lib/env.ts';
import { isPortFree, getRequiredPorts } from '../lib/ports.ts';
import { createDefaultContext } from '../lib/config.ts';
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
      ui.info('Try: sudo systemctl start docker');
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
          try { containers = JSON.parse(trimmed); } catch { /* fallback */ }
        } else {
          for (const line of trimmed.split('\n')) {
            try { containers.push(JSON.parse(line)); } catch { /* skip */ }
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
    const content = await Bun.file('/proc/meminfo').text();
    const match = content.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (match) {
      const availMB = parseInt(match[1], 10) / 1024;
      if (availMB < 2048) {
        ui.warn(`Low available RAM: ${Math.round(availMB)}MB`);
        warnings++;
      } else {
        ui.ok(`Available RAM: ${Math.round(availMB / 1024)}GB`);
      }
    }
  } catch { /* not Linux */ }

  // Disk space
  try {
    const { stdout } = await exec(['df', '-BG', installDir], { timeout: 5000 });
    const lines = stdout.split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availGB = parseInt(parts[3]?.replace('G', '') || '0', 10);
      if (availGB < 10) {
        ui.warn(`Low disk space: ${availGB}GB available`);
        warnings++;
      } else {
        ui.ok(`Disk space: ${availGB}GB available`);
      }
    }
  } catch { /* ignore */ }

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
    } catch { /* can't read logs */ }
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
```

### File: `src/commands/install.ts`

- Size: 5497 bytes
- Modified: 2026-03-10 21:42:27 UTC

```typescript
// ── Install Command ─────────────────────────────────────────────────────────

import { type InstallContext, createDefaultContext } from '../lib/config.ts';
import { preflight } from '../phases/preflight.ts';
import { detect } from '../phases/detection.ts';
import { features } from '../phases/features.ts';
import { configure } from '../phases/configure.ts';
import { downloadModel } from '../phases/model.ts';
import { services } from '../phases/services.ts';
import { checkRequiredPorts } from '../lib/ports.ts';
import { runHealthChecks, configurePerplexica, preDownloadSttModel } from '../phases/health.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { VERSION } from '../lib/config.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstallOptions {
  dryRun?: boolean;
  force?: boolean;
  tier?: string;
  nonInteractive?: boolean;
  all?: boolean;
  voice?: boolean;
  workflows?: boolean;
  rag?: boolean;
  openclaw?: boolean;
  dir?: string;
}

export async function install(opts: InstallOptions): Promise<void> {
  ui.banner(VERSION);

  const ctx = createDefaultContext();

  // Apply CLI options
  ctx.dryRun = opts.dryRun ?? false;
  ctx.force = opts.force ?? false;
  ctx.interactive = !(opts.nonInteractive ?? false);
  if (opts.tier) ctx.tier = opts.tier;
  if (opts.dir) ctx.installDir = opts.dir;
  if (opts.all) {
    ctx.features = { voice: true, workflows: true, rag: true, openclaw: true };
  } else {
    if (opts.voice !== undefined) ctx.features.voice = opts.voice;
    if (opts.workflows !== undefined) ctx.features.workflows = opts.workflows;
    if (opts.rag !== undefined) ctx.features.rag = opts.rag;
    if (opts.openclaw !== undefined) ctx.features.openclaw = opts.openclaw;
  }

  if (ctx.dryRun) {
    ui.info('DRY RUN — no changes will be made');
    console.log('');
  }

  // Detect existing installation for resume/retry
  const isResume = existsSync(join(ctx.installDir, '.env'));
  if (isResume) {
    ui.info('Existing installation detected — resuming setup');
    console.log('');
    loadFeaturesFromEnv(ctx);
  }

  try {
    // Phase 1: Preflight checks (always run — fast)
    const preflightResult = await preflight(ctx);
    ctx.tailscaleIp = preflightResult.tailscaleIp;

    // Phase 2: Hardware detection (always run — fast)
    await detect(ctx);

    // Port availability check (between detection and features)
    console.log('');
    const portsOk = await checkRequiredPorts(ctx);
    if (!portsOk && !ctx.force && !ctx.dryRun) {
      ui.warn('Some required ports are in use. Services may fail to start.');
      if (ctx.interactive) {
        const { confirm } = await import('../lib/prompts.ts');
        const proceed = await confirm('Continue anyway?', false);
        if (!proceed) process.exit(1);
      }
    }

    // Phase 3: Feature selection
    if (isResume) {
      ui.phase(3, 6, 'Feature Selection');
      const enabled = Object.entries(ctx.features)
        .filter(([, v]) => v)
        .map(([k]) => k);
      ui.ok(`Using existing config: ${enabled.join(', ') || 'core only'}`);
    } else if (!opts.all && !(opts.voice || opts.workflows || opts.rag || opts.openclaw)) {
      await features(ctx);
    } else {
      ui.phase(3, 6, 'Feature Selection');
      const enabled = Object.entries(ctx.features)
        .filter(([, v]) => v)
        .map(([k]) => k);
      ui.ok(`Features: ${enabled.join(', ') || 'core only'}`);
    }

    // Phase 4: Clone/update + configure
    await configure(ctx);

    // Phase 5: Download LLM model
    ui.phase(5, 6, 'Model Download', '~5-15min');
    await downloadModel(ctx);

    // Phase 6: Start services
    await services(ctx);

    // Post-install: health checks, auto-config, STT pre-download
    console.log('');
    const failures = await runHealthChecks(ctx);
    await configurePerplexica(ctx);
    await preDownloadSttModel(ctx);

    if (failures > 0) {
      console.log('');
      ui.warn(`${failures} service(s) did not pass health checks.`);
      ui.info('Some services may still be starting. Check with: dream-installer status');
    }
  } catch (error) {
    console.log('');
    ui.fail(`Installation failed: ${error instanceof Error ? error.message : String(error)}`);
    console.log('');
    ui.info('To retry, just re-run the installer:');
    console.log(`     ${process.execPath} install`);
    console.log('');
    process.exit(1);
  }
}

/**
 * Read feature flags from an existing .env file so re-runs don't re-prompt.
 */
function loadFeaturesFromEnv(ctx: InstallContext): void {
  try {
    const envPath = join(ctx.installDir, '.env');
    const content = readFileSync(envPath, 'utf-8');
    const env = parseEnv(content);

    const toBool = (val: string | undefined): boolean => val === 'true';

    if (env.ENABLE_VOICE !== undefined) ctx.features.voice = toBool(env.ENABLE_VOICE);
    if (env.ENABLE_WORKFLOWS !== undefined) ctx.features.workflows = toBool(env.ENABLE_WORKFLOWS);
    if (env.ENABLE_RAG !== undefined) ctx.features.rag = toBool(env.ENABLE_RAG);
    if (env.ENABLE_OPENCLAW !== undefined) ctx.features.openclaw = toBool(env.ENABLE_OPENCLAW);

    if (env.GPU_BACKEND) ctx.gpu.backend = env.GPU_BACKEND as 'nvidia' | 'amd' | 'cpu';
  } catch {
    // If .env can't be read, defaults will be used
  }
}
```

### File: `src/commands/status.ts`

- Size: 11618 bytes
- Modified: 2026-03-10 21:36:18 UTC

```typescript
// ── Status Command ──────────────────────────────────────────────────────────

import { exec } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { getDockerBaseCmd } from '../phases/services.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StatusOptions {
  dir?: string;
}

export async function status(opts: StatusOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;

  if (!existsSync(join(installDir, '.env'))) {
    ui.fail('No Dream Server installation found');
    ui.info(`Expected at: ${installDir}`);
    ui.info('Run: dream-installer install');
    process.exit(1);
  }

  ui.header('Dream Server Status');
  console.log('');

  // Read .env for config info
  const envContent = readFileSync(join(installDir, '.env'), 'utf-8');
  const envParsed = parseEnv(envContent);
  const getEnv = (key: string): string => envParsed[key] || '';

  // Show current config
  const model = getEnv('LLM_MODEL');
  const gpuBackend = getEnv('GPU_BACKEND');
  const mode = getEnv('DREAM_MODE');

  ui.table([
    ['Mode', mode || 'local'],
    ['Model', model || 'unknown'],
    ['GPU', gpuBackend || 'cpu'],
    ['Install Dir', installDir],
  ]);
  console.log('');

  // Features
  const features = [
    getEnv('ENABLE_VOICE') === 'true' ? '✓ Voice' : '○ Voice',
    getEnv('ENABLE_WORKFLOWS') === 'true' ? '✓ Workflows' : '○ Workflows',
    getEnv('ENABLE_RAG') === 'true' ? '✓ RAG' : '○ RAG',
    getEnv('ENABLE_OPENCLAW') === 'true' ? '✓ OpenClaw' : '○ OpenClaw',
  ];
  ui.info(`Features: ${features.join('  ')}`);
  console.log('');

  // ── GPU / VRAM Status ──
  const gpuInfo = await showGpuStatus(gpuBackend);
  console.log('');

  // ── Container status ──
  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch (e) {
    ui.fail('Docker not available');
    if (e instanceof Error) ui.info(e.message);
    return;
  }

  ui.step('Container status:');
  let failingServices: { name: string; fullName: string; status: string }[] = [];
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps', '--format', 'json'],
      { cwd: installDir, throwOnError: false, timeout: 10000 },
    );

    if (!stdout.trim()) {
      ui.warn('No containers running');
      return;
    }

    let containers: Record<string, unknown>[] = [];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('[')) {
      try { containers = JSON.parse(trimmed); } catch { /* skip */ }
    } else {
      for (const line of trimmed.split('\n')) {
        try { containers.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }

    const running: string[] = [];

    for (const c of containers) {
      const fullName = (c.Name ?? c.name ?? '') as string;
      const name = fullName.replace(/^dream-/, '');
      const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
      const statusText = (c.Status ?? c.status ?? '') as string;

      if (state === 'running') {
        running.push(name);
      } else {
        failingServices.push({ name, fullName, status: statusText || state });
      }
    }

    if (running.length > 0) {
      ui.ok(`Running (${running.length}): ${running.join(', ')}`);
    }

    // Show failing containers with diagnostics
    for (const svc of failingServices) {
      ui.warn(`${svc.name} (${svc.status})`);
      const logs = await getContainerLogs(svc.fullName);
      if (logs) {
        const diagnosis = diagnoseFailure(svc.name, logs, gpuInfo);
        for (const line of logs.split('\n').slice(-3)) {
          console.log(`       ${line.trim()}`);
        }
        if (diagnosis) {
          console.log('');
          ui.info(`💡 ${diagnosis}`);
        }
      }
    }
  } catch {
    const { stdout } = await exec(
      [...composeCmd, 'ps'],
      { cwd: installDir, throwOnError: false, timeout: 10000 },
    );
    if (stdout.trim()) console.log(stdout);
  }

  console.log('');

  // ── Health checks ──
  ui.step('Health checks:');
  const webuiPort = getEnv('WEBUI_PORT') || '3000';
  const dashPort = getEnv('DASHBOARD_PORT') || '3001';
  const llmPort = getEnv('OLLAMA_PORT') || '8080';
  const checks = [
    { name: 'Chat (WebUI)', url: `http://localhost:${webuiPort}` },
    { name: 'Dashboard', url: `http://localhost:${dashPort}` },
    { name: 'LLM (llama-server)', url: `http://localhost:${llmPort}/health` },
  ];

  for (const check of checks) {
    try {
      const resp = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok || resp.status === 401 || resp.status === 200) {
        ui.ok(check.name);
      } else {
        ui.warn(`${check.name} (HTTP ${resp.status})`);
      }
    } catch {
      ui.fail(`${check.name} — not responding`);
    }
  }

  console.log('');
}

// ── GPU / VRAM monitoring ─────────────────────────────────────────────────

interface GpuInfo {
  available: boolean;
  name: string;
  totalMB: number;
  usedMB: number;
  freeMB: number;
  processes: GpuProcess[];
}

interface GpuProcess {
  pid: number;
  name: string;
  memMB: number;
}

async function showGpuStatus(backend: string): Promise<GpuInfo | null> {
  if (backend !== 'nvidia') {
    // AMD ROCm support could be added later
    return null;
  }

  try {
    // Get GPU summary
    const { stdout: gpuOut } = await exec(
      ['nvidia-smi', '--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 5000 },
    );

    if (!gpuOut.trim()) return null;

    const [name, totalStr, usedStr, freeStr] = gpuOut.trim().split(', ').map(s => s.trim());
    const totalMB = parseInt(totalStr);
    const usedMB = parseInt(usedStr);
    const freeMB = parseInt(freeStr);
    const usedPct = Math.round((usedMB / totalMB) * 100);

    // Build VRAM bar
    const barWidth = 30;
    const filled = Math.round((usedMB / totalMB) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const barColor = usedPct > 90 ? '\x1b[31m' : usedPct > 70 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';

    ui.step(`GPU: ${name}`);
    console.log(`     VRAM: ${barColor}${bar}${reset} ${usedMB}/${totalMB} MB (${freeMB} MB free)`);

    // Get per-process GPU usage
    const { stdout: procOut } = await exec(
      ['nvidia-smi', '--query-compute-apps=pid,process_name,used_gpu_memory', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 5000 },
    );

    const processes: GpuProcess[] = [];
    if (procOut.trim()) {
      for (const line of procOut.trim().split('\n')) {
        const parts = line.split(', ').map(s => s.trim());
        if (parts.length >= 3) {
          const pid = parseInt(parts[0]);
          const procName = parts[1].split('/').pop() || parts[1];
          const memMB = parseInt(parts[2]);
          processes.push({ pid, name: procName, memMB });
        }
      }

      if (processes.length > 0) {
        // Resolve container names for docker processes
        const containerMap = await getDockerPidMap();
        const sortedProcs = processes.sort((a, b) => b.memMB - a.memMB);

        console.log('');
        console.log('     VRAM consumers:');
        for (const proc of sortedProcs) {
          const container = containerMap.get(proc.pid);
          const label = container
            ? `🐳 ${container.replace('dream-', '')}`
            : `   ${proc.name}`;
          const pct = Math.round((proc.memMB / totalMB) * 100);
          console.log(`       ${label.padEnd(28)} ${String(proc.memMB).padStart(6)} MB  (${pct}%)`);
        }
      }
    }

    // Warning if VRAM is critically low
    if (freeMB < 2000) {
      console.log('');
      ui.warn(`Only ${freeMB} MB VRAM free — LLM may fail to load`);
      if (processes.length > 0) {
        ui.info('Stop GPU-heavy processes or use: dream-installer config --tier');
      }
    }

    return { available: true, name, totalMB, usedMB, freeMB, processes };
  } catch {
    return null;
  }
}

async function getDockerPidMap(composeCmd?: string[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const dockerCmd = composeCmd ? getDockerBaseCmd(composeCmd) : ['docker'];
  try {
    const { stdout } = await exec(
      [...dockerCmd, 'ps', '--format', '{{.ID}} {{.Names}}', '--no-trunc'],
      { throwOnError: false, timeout: 5000 },
    );
    if (!stdout.trim()) return map;

    for (const line of stdout.trim().split('\n')) {
      const [id, name] = line.split(' ');
      if (!id || !name) continue;
      try {
        // Use `docker top` to get ALL process PIDs in the container
        // This catches sub-processes (e.g. python inside comfyui)
        const { stdout: topOut } = await exec(
          [...dockerCmd, 'top', id, '-o', 'pid'],
          { throwOnError: false, timeout: 3000 },
        );
        for (const pidLine of topOut.trim().split('\n').slice(1)) {
          const pid = parseInt(pidLine.trim());
          if (pid > 0) map.set(pid, name);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map;
}

// ── Failure diagnosis ───────────────────────────────────────────────────

async function getContainerLogs(containerName: string, composeCmd?: string[]): Promise<string | null> {
  const dockerCmd = composeCmd ? getDockerBaseCmd(composeCmd) : ['docker'];
  try {
    // Fetch enough lines for diagnosis (OOM errors appear before the final crash message)
    const { stdout, stderr } = await exec(
      [...dockerCmd, 'logs', '--tail', '20', containerName],
      { throwOnError: false, timeout: 5000 },
    );
    return (stderr || stdout).trim() || null;
  } catch {
    return null;
  }
}

function diagnoseFailure(serviceName: string, logs: string, gpuInfo: GpuInfo | null): string | null {
  const lower = logs.toLowerCase();

  // CUDA OOM — the most common and important failure
  if (lower.includes('out of memory') || lower.includes('cudamalloc failed') || lower.includes('cuda error')) {
    const freeStr = gpuInfo ? ` (${gpuInfo.freeMB} MB free)` : '';
    return `CUDA out of memory${freeStr}. Fix: stop other GPU processes, or switch to a smaller model:\n     dream-installer config --tier`;
  }

  // Permission errors
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return `Permission denied. Fix: sudo chown -R 1000:1000 ~/dream-server/data/${serviceName}`;
  }

  // Connection refused (depends on another service)
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return `Cannot reach upstream service. Check if its dependency is running.`;
  }

  // Model file not found
  if (lower.includes('failed to load model') || lower.includes('model file not found')) {
    return `Model file missing. Re-download: dream-installer install`;
  }

  // Config missing
  if (lower.includes('no configuration file') || lower.includes('config') && lower.includes('not found')) {
    return `Configuration missing. Re-run: dream-installer install`;
  }

  return null;
}
```

### File: `src/commands/uninstall.ts`

- Size: 4869 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
// ── Uninstall Command ───────────────────────────────────────────────────────

import { exec } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import * as ui from '../lib/ui.ts';
import * as prompts from '../lib/prompts.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

    // ── Step 3: Remove Docker volumes ──
    try {
      await exec(
        [...composeCmd, 'down', '-v'],
        { cwd: installDir, throwOnError: false, timeout: 30_000 },
      );
      ui.ok('Docker volumes removed');
    } catch { /* volumes may not exist */ }

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
      const delSpinner = new ui.Spinner(`Removing ${installDir}...`);
      delSpinner.start();
      try {
        await exec(['rm', '-rf', installDir], { timeout: 30_000 });
        delSpinner.succeed('Installation directory removed');
      } catch {
        delSpinner.fail('Could not remove installation directory');
        ui.info(`Remove manually: sudo rm -rf ${installDir}`);
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
```

### File: `src/commands/update.ts`

- Size: 5720 bytes
- Modified: 2026-03-10 21:35:47 UTC

```typescript
// ── Update Command ──────────────────────────────────────────────────────────
// Pull latest code, self-update binary with SHA256 verification, restart services.

import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import * as ui from '../lib/ui.ts';
import { VERSION } from '../lib/config.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

    // Download binary and checksum
    const tmpPath = '/tmp/dream-installer-update';
    const tmpChecksum = '/tmp/dream-installer-update.sha256';
    ui.step('Downloading latest CLI...');

    // Download binary
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
      // Verify SHA256
      const { exitCode: verifyCode } = await exec(
        ['sh', '-c', `cd /tmp && sha256sum --check ${tmpChecksum}`],
        { throwOnError: false, timeout: 10000 },
      );

      if (verifyCode !== 0) {
        ui.fail('SHA256 verification failed — update aborted (binary may be tampered)');
        await exec(['rm', '-f', tmpPath, tmpChecksum], { throwOnError: false });
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
    await exec(['rm', '-f', tmpChecksum], { throwOnError: false });

    ui.ok('CLI updated to latest version');
    ui.info('New version will take effect on next run');

    // Verify new binary works
    try {
      await exec([currentBinary, '--version'], { throwOnError: false, timeout: 5000 });
      // Clean up backup on success
      await exec(['rm', '-f', bakPath], { throwOnError: false });
    } catch {
      // Rollback on failure
      ui.warn('New binary failed to execute — rolling back');
      await exec(['mv', bakPath, currentBinary], { throwOnError: false });
    }
  } catch (e) {
    ui.info('Self-update unavailable — continuing with current version');
  }
}
```

### File: `src/lib/config.ts`

- Size: 4092 bytes
- Modified: 2026-03-10 21:33:33 UTC

```typescript
// ── Configuration & Constants ───────────────────────────────────────────────

export const VERSION = '1.0.0';
export const REPO_URL = 'https://github.com/Light-Heart-Labs/DreamServer.git';
export const MIN_DRIVER_VERSION = 570;

import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Resolve the real user's home directory, even under sudo.
 * When running `sudo dream-installer`, os.homedir() returns /root but we
 * want the original user's home. Falls back to getent lookup for non-standard
 * home directories (NFS, custom paths).
 */
export function getUserHome(): string {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && process.getuid?.() === 0) {
    // Try getent for correct path regardless of home dir layout
    try {
      const result = execSync(`getent passwd ${sudoUser}`, { encoding: 'utf-8', timeout: 2000 });
      const home = result.trim().split(':')[5];
      if (home) return home;
    } catch { /* fallback below */ }
    return `/home/${sudoUser}`;
  }
  return homedir() || process.env.HOME || '/root';
}

export const DEFAULT_INSTALL_DIR = `${getUserHome()}/dream-server`;

export interface TierConfig {
  name: string;
  model: string;
  ggufFile: string;
  ggufUrl: string;
  context: number;
  speed: number;
  users: string;
  minRam: number;
  minDisk: number;
}

export const TIER_MAP: Record<string, TierConfig> = {
  '1': {
    name: 'Entry Level',
    model: 'qwen3-8b',
    ggufFile: 'Qwen3-8B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    context: 16384,
    speed: 25,
    users: '1-2',
    minRam: 16,
    minDisk: 30,
  },
  '2': {
    name: 'Prosumer',
    model: 'qwen3-8b',
    ggufFile: 'Qwen3-8B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    context: 32768,
    speed: 45,
    users: '3-5',
    minRam: 32,
    minDisk: 50,
  },
  '3': {
    name: 'Pro',
    model: 'qwen3-14b',
    ggufFile: 'Qwen3-14B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
    context: 32768,
    speed: 55,
    users: '5-8',
    minRam: 48,
    minDisk: 80,
  },
  '4': {
    name: 'Enterprise',
    model: 'qwen3-30b-a3b',
    ggufFile: 'qwen3-30b-a3b-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf',
    context: 131072,
    speed: 40,
    users: '10-15',
    minRam: 64,
    minDisk: 150,
  },
  NV_ULTRA: {
    name: 'NV Ultra',
    model: 'qwen3-coder-next',
    ggufFile: 'qwen3-coder-next-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf',
    context: 131072,
    speed: 50,
    users: '10-20',
    minRam: 96,
    minDisk: 200,
  },
};

export type FeatureSet = {
  voice: boolean;
  workflows: boolean;
  rag: boolean;
  openclaw: boolean;
};

export const FEATURE_PRESETS: Record<string, FeatureSet> = {
  full: { voice: true, workflows: true, rag: true, openclaw: true },
  core: { voice: false, workflows: false, rag: false, openclaw: false },
};

export interface InstallContext {
  installDir: string;
  interactive: boolean;
  dryRun: boolean;
  force: boolean;
  tier: string;
  features: FeatureSet;
  gpu: {
    backend: 'nvidia' | 'amd' | 'cpu';
    name: string;
    vramMB: number;
    count: number;
  };
  system: {
    os: string;
    distro: string;
    ramGB: number;
    diskGB: number;
    arch: string;
  };
  tailscaleIp: string | null;
}

export function createDefaultContext(): InstallContext {
  return {
    installDir: DEFAULT_INSTALL_DIR,
    interactive: true,
    dryRun: false,
    force: false,
    tier: '',
    features: { ...FEATURE_PRESETS.full },
    gpu: { backend: 'cpu', name: 'Not detected', vramMB: 0, count: 0 },
    system: { os: 'linux', distro: '', ramGB: 0, diskGB: 0, arch: process.arch },
    tailscaleIp: null,
  };
}
```

### File: `src/lib/docker.ts`

- Size: 2086 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
// ── Docker helpers ──────────────────────────────────────────────────────────

import { exec } from './shell.ts';

let _cachedCmd: string[] | null = null;

export function resetCache(): void {
  _cachedCmd = null;
}

/**
 * Resolve the docker compose command that can actually talk to the daemon.
 *
 * Strategy: Check binary + daemon access separately because:
 * - `docker compose version` works without daemon access (just binary check)
 * - `docker compose ps` requires a compose.yml in cwd (unreliable for detection)
 * - `docker info` verifies daemon access without needing a project directory
 */
export async function getComposeCommand(): Promise<string[]> {
  if (_cachedCmd) return _cachedCmd;

  // Try user-level: binary exists + daemon accessible
  try {
    const bin = await exec(['docker', 'compose', 'version'], { throwOnError: false, timeout: 5000 });
    if (bin.exitCode === 0) {
      const info = await exec(['docker', 'info'], { throwOnError: false, timeout: 5000 });
      if (info.exitCode === 0) {
        _cachedCmd = ['docker', 'compose'];
        return _cachedCmd;
      }
    }
  } catch { /* try sudo */ }

  // Try sudo (non-interactive only — don't hang on password prompt)
  try {
    const info = await exec(['sudo', '-n', 'docker', 'info'], { throwOnError: false, timeout: 5000 });
    if (info.exitCode === 0) {
      _cachedCmd = ['sudo', 'docker', 'compose'];
      return _cachedCmd;
    }
  } catch { /* skip */ }

  // Try standalone docker-compose
  try {
    const bin = await exec(['docker-compose', 'version'], { throwOnError: false, timeout: 5000 });
    if (bin.exitCode === 0) {
      _cachedCmd = ['docker-compose'];
      return _cachedCmd;
    }
  } catch { /* skip */ }

  throw new Error(
    'Cannot connect to Docker daemon. Either:\n' +
    '  • Add your user to the docker group: sudo usermod -aG docker $USER && newgrp docker\n' +
    '  • Or run with sudo: sudo dream-installer <command>',
  );
}
```

### File: `src/lib/env.ts`

- Size: 3481 bytes
- Modified: 2026-03-10 21:32:39 UTC

```typescript
// ── .env Parser ─────────────────────────────────────────────────────────────
// Robust parser that handles quotes, inline comments, blank lines, and merging.

/**
 * Parse a .env file into a key-value map.
 *
 * Handles:
 *  - KEY=value
 *  - KEY="value with spaces"
 *  - KEY='value with spaces'
 *  - KEY=value # inline comment
 *  - Empty values (KEY=)
 *  - Blank lines and # full-line comments
 */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = line.slice(eqIdx + 1);

    // Handle quoted values
    const trimmed = value.trimStart();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      value = trimmed.slice(1, -1);
    } else {
      // Strip inline comments (only for unquoted values)
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx);
      }
      value = value.trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Get a single value from .env content.
 */
export function getEnvValue(content: string, key: string): string | undefined {
  const parsed = parseEnv(content);
  return parsed[key];
}

/**
 * Set or update a key in .env content, preserving structure and comments.
 * If the key exists, replaces its value in-place. If not, appends it.
 */
export function setEnvValue(content: string, key: string, value: string): string {
  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    const lineKey = trimmed.slice(0, eqIdx).trim();
    if (lineKey === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  return lines.join('\n');
}

/**
 * Merge a generated .env into an existing one, preserving user edits.
 *
 * Rules:
 *  - User-edited keys in `existing` are preserved
 *  - New keys from `generated` are appended
 *  - Comments and structure from `existing` are preserved
 */
export function mergeEnv(existing: string, generated: string): string {
  const existingParsed = parseEnv(existing);
  const generatedParsed = parseEnv(generated);
  let result = existing;

  // Append any keys from generated that don't exist in existing
  const newKeys: string[] = [];
  for (const key of Object.keys(generatedParsed)) {
    if (!(key in existingParsed)) {
      newKeys.push(key);
    }
  }

  if (newKeys.length > 0) {
    const additions = newKeys.map((k) => `${k}=${generatedParsed[k]}`);
    // Ensure trailing newline before appending
    if (!result.endsWith('\n')) result += '\n';
    result += `\n# ── Added by dream-installer ──────────────────────────────────\n`;
    result += additions.join('\n') + '\n';
  }

  return result;
}
```

### File: `src/lib/ports.ts`

- Size: 4010 bytes
- Modified: 2026-03-10 21:39:02 UTC

```typescript
// ── Port Availability Checks ────────────────────────────────────────────────
// Verifies required ports are free before starting services.

import { exec } from './shell.ts';
import { type InstallContext } from './config.ts';
import * as ui from './ui.ts';

/**
 * Check if a TCP port is in use using ss or netstat.
 * Returns true if the port is FREE, false if it's in use.
 */
export async function isPortFree(port: number): Promise<boolean> {
  // Try ss first (iproute2 — modern Linux)
  try {
    const { stdout, exitCode } = await exec(
      ['ss', '-tln'],
      { throwOnError: false, timeout: 5000 },
    );
    if (exitCode === 0) {
      // Match :PORT at word boundary (handles IPv4 and IPv6)
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* try netstat */ }

  // Fallback: netstat (net-tools)
  try {
    const { stdout, exitCode } = await exec(
      ['netstat', '-tln'],
      { throwOnError: false, timeout: 5000 },
    );
    if (exitCode === 0) {
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* neither tool available */ }

  // Can't check — assume free but warn
  return true;
}

/**
 * Map of service names to their default ports.
 */
const SERVICE_PORTS: Record<string, number> = {
  'llama-server': 8080,
  'open-webui': 3000,
  dashboard: 3001,
  searxng: 8888,
  whisper: 9000,
  tts: 8880,
  n8n: 5678,
  qdrant: 6333,
  openclaw: 7860,
  perplexica: 3004,
  comfyui: 8188,
};

/**
 * Get the list of ports that need to be free based on enabled features.
 */
export function getRequiredPorts(ctx: InstallContext): { service: string; port: number }[] {
  const ports: { service: string; port: number }[] = [
    { service: 'llama-server', port: SERVICE_PORTS['llama-server'] },
    { service: 'open-webui', port: SERVICE_PORTS['open-webui'] },
    { service: 'dashboard', port: SERVICE_PORTS.dashboard },
    { service: 'searxng', port: SERVICE_PORTS.searxng },
    { service: 'perplexica', port: SERVICE_PORTS.perplexica },
    { service: 'comfyui', port: SERVICE_PORTS.comfyui },
  ];

  if (ctx.features.voice) {
    ports.push({ service: 'whisper', port: SERVICE_PORTS.whisper });
    ports.push({ service: 'tts', port: SERVICE_PORTS.tts });
  }
  if (ctx.features.workflows) {
    ports.push({ service: 'n8n', port: SERVICE_PORTS.n8n });
  }
  if (ctx.features.rag) {
    ports.push({ service: 'qdrant', port: SERVICE_PORTS.qdrant });
  }
  if (ctx.features.openclaw) {
    ports.push({ service: 'openclaw', port: SERVICE_PORTS.openclaw });
  }

  return ports;
}

/**
 * Check all required ports and report any conflicts.
 * Returns true if all ports are free, false if any are in use.
 */
export async function checkRequiredPorts(ctx: InstallContext): Promise<boolean> {
  const required = getRequiredPorts(ctx);
  let allFree = true;
  let ssAvailable: boolean | null = null;

  for (const { service, port } of required) {
    const free = await isPortFree(port);

    // On first check, detect if ss/netstat are available
    if (ssAvailable === null) {
      try {
        await exec(['ss', '-tln'], { throwOnError: false, timeout: 2000 });
        ssAvailable = true;
      } catch {
        try {
          await exec(['netstat', '-tln'], { throwOnError: false, timeout: 2000 });
          ssAvailable = true;
        } catch {
          ssAvailable = false;
          ui.warn('Neither ss nor netstat found — cannot verify port availability');
          ui.info('Install iproute2 (for ss) or net-tools (for netstat) to enable port checks');
          return true; // Can't verify, assume OK
        }
      }
    }

    if (!free) {
      ui.warn(`Port ${port} (${service}) is already in use`);
      allFree = false;
    }
  }

  if (allFree) {
    ui.ok(`All ${required.length} required ports are available`);
  }

  return allFree;
}
```

### File: `src/lib/prompts.ts`

- Size: 4944 bytes
- Modified: 2026-03-09 13:00:34 UTC

```typescript
// ── Interactive prompts ─────────────────────────────────────────────────────
// readline-based prompts that work correctly in any terminal context.

import { createInterface } from 'node:readline';
import { c } from './ui.ts';

function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a yes/no question. Returns true for yes.
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.cyan}?${c.reset} ${question} [${hint}] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') resolve(defaultYes);
      else resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Ask user to select from a list of options. Returns the 0-based index.
 */
export async function select(
  question: string,
  options: { label: string; description?: string; hint?: string }[],
  defaultIndex = 0,
): Promise<number> {
  console.log('');
  console.log(`  ${c.cyan}?${c.reset} ${question}`);
  console.log('');

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const num = `${c.bold}[${i + 1}]${c.reset}`;
    const hint = opt.hint ? ` ${c.dim}${opt.hint}${c.reset}` : '';
    const isDefault = i === defaultIndex ? ` ${c.yellow}← default${c.reset}` : '';
    console.log(`  ${num} ${opt.label}${hint}${isDefault}`);
    if (opt.description) {
      console.log(`      ${c.dim}${opt.description}${c.reset}`);
    }
  }

  console.log('');
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.dim}Select [${defaultIndex + 1}]:${c.reset} `, (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num < 1 || num > options.length) {
        resolve(defaultIndex);
      } else {
        resolve(num - 1);
      }
    });
  });
}

/**
 * TUI multi-select picker. Arrow keys to navigate, space to toggle, enter to confirm.
 * Shows all options at once with checkboxes.
 */
export async function multiSelect(
  question: string,
  options: { label: string; description?: string; checked: boolean }[],
): Promise<boolean[]> {
  const selected = options.map((o) => o.checked);
  let cursor = 0;
  const totalLines = options.length + 2; // header + blank + options

  const renderLine = (i: number) => {
    const check = selected[i] ? `${c.green}✓${c.reset}` : `${c.dim}○${c.reset}`;
    const pointer = i === cursor ? `${c.cyan}❯${c.reset}` : ' ';
    const label = i === cursor ? `${c.bold}${options[i].label}${c.reset}` : options[i].label;
    const desc = options[i].description ? ` ${c.dim}${options[i].description}${c.reset}` : '';
    return `  ${pointer} [${check}] ${label}${desc}`;
  };

  const render = () => {
    // Move cursor up to redraw
    process.stdout.write(`\x1b[${totalLines}A\x1b[J`);
    console.log(`  ${c.cyan}?${c.reset} ${question} ${c.dim}(↑↓ move, space toggle, enter confirm)${c.reset}`);
    console.log('');
    for (let i = 0; i < options.length; i++) {
      console.log(renderLine(i));
    }
  };

  // Initial render
  console.log(`  ${c.cyan}?${c.reset} ${question} ${c.dim}(↑↓ move, space toggle, enter confirm)${c.reset}`);
  console.log('');
  for (let i = 0; i < options.length; i++) {
    console.log(renderLine(i));
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(selected);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();

    const onData = (buf: Buffer) => {
      const key = buf.toString();

      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === ' ') {
        selected[cursor] = !selected[cursor];
        render();
      } else if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdin.pause();
        resolve(selected);
      } else if (key === '\x03') {
        stdin.setRawMode(false);
        process.exit(130);
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Ask for free-form text input.
 */
export async function input(question: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.cyan}?${c.reset} ${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}
```

### File: `src/lib/shell.ts`

- Size: 2519 bytes
- Modified: 2026-03-09 14:56:57 UTC

```typescript
// ── Shell execution helpers ─────────────────────────────────────────────────
// All subprocess calls via Bun.spawn — async, streaming, no event loop blocking.

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and capture output. Throws on non-zero exit by default.
 */
export async function exec(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; throwOnError?: boolean; timeout?: number } = {},
): Promise<ExecResult> {
  const { cwd, env, throwOnError = true, timeout = 30_000 } = opts;

  const proc = Bun.spawn(cmd, {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutId = timeout > 0
    ? setTimeout(() => proc.kill(), timeout)
    : null;

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (timeoutId) clearTimeout(timeoutId);

  if (throwOnError && exitCode !== 0) {
    throw new ShellError(cmd.join(' '), exitCode, stdout, stderr);
  }

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Run a command and stream stdout/stderr to the console.
 */
export async function execStream(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (opts.timeout) {
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, opts.timeout);
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);
    return exitCode;
  }

  return proc.exited;
}

/**
 * Check if a command exists on the system.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await exec(['which', cmd], { throwOnError: false, timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export class ShellError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`Command failed (exit ${exitCode}): ${command}\n${stderr}`);
    this.name = 'ShellError';
  }
}
```

### File: `src/lib/ui.ts`

- Size: 4021 bytes
- Modified: 2026-03-09 12:41:21 UTC

```typescript
// ── Terminal UI ─────────────────────────────────────────────────────────────
// Clean, professional terminal output. No CRT gimmicks.

const ESC = '\x1b[';

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  cyan: `${ESC}36m`,
  red: `${ESC}31m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
  bgGreen: `${ESC}42m`,
  bgRed: `${ESC}41m`,
  bgYellow: `${ESC}43m`,
  bgBlue: `${ESC}44m`,
} as const;

export function ok(msg: string) {
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}

export function warn(msg: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
}

export function fail(msg: string) {
  console.log(`  ${c.red}✗${c.reset} ${msg}`);
}

export function info(msg: string) {
  console.log(`  ${c.blue}→${c.reset} ${msg}`);
}

export function step(msg: string) {
  console.log(`  ${c.cyan}▸${c.reset} ${msg}`);
}

export function header(title: string) {
  const line = '─'.repeat(60);
  console.log('');
  console.log(`  ${c.dim}${line}${c.reset}`);
  console.log(`  ${c.bold}${title}${c.reset}`);
  console.log(`  ${c.dim}${line}${c.reset}`);
}

export function phase(num: number, total: number, name: string, estimate?: string) {
  console.log('');
  const est = estimate ? ` ${c.dim}(${estimate})${c.reset}` : '';
  console.log(`  ${c.bold}${c.blue}[${num}/${total}]${c.reset} ${c.bold}${name}${c.reset}${est}`);
  console.log('');
}

export function banner(version: string) {
  console.log('');
  console.log(`  ${c.bold}${c.blue}Dream Server${c.reset} ${c.dim}v${version}${c.reset}`);
  console.log(`  ${c.dim}Local AI · Private · Self-Hosted${c.reset}`);
  console.log('');
}

export function table(rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${c.dim}${key.padEnd(maxKey)}${c.reset}  ${value}`);
  }
}

export function box(title: string, rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  const maxVal = Math.max(...rows.map(([, v]) => v.length));
  const innerWidth = maxKey + maxVal + 4;
  const width = Math.max(innerWidth, title.length + 2);
  const border = '─'.repeat(width + 2);

  console.log('');
  console.log(`  ${c.dim}┌${border}┐${c.reset}`);
  console.log(`  ${c.dim}│${c.reset} ${c.bold}${title.padEnd(width)}${c.reset} ${c.dim}│${c.reset}`);
  console.log(`  ${c.dim}├${border}┤${c.reset}`);
  for (const [key, value] of rows) {
    const line = `${c.dim}${key.padEnd(maxKey)}${c.reset}  ${value}`;
    // Pad accounting for ANSI codes
    const visibleLen = key.length + 2 + value.length;
    const pad = ' '.repeat(Math.max(0, width - visibleLen));
    console.log(`  ${c.dim}│${c.reset} ${line}${pad} ${c.dim}│${c.reset}`);
  }
  console.log(`  ${c.dim}└${border}┘${c.reset}`);
}

export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private i = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private msg: string;

  constructor(msg: string) {
    this.msg = msg;
  }

  start() {
    process.stdout.write(`  ${c.cyan}${this.frames[0]}${c.reset} ${this.msg}`);
    this.interval = setInterval(() => {
      this.i = (this.i + 1) % this.frames.length;
      process.stdout.write(`\r  ${c.cyan}${this.frames[this.i]}${c.reset} ${this.msg}`);
    }, 80);
    return this;
  }

  succeed(msg?: string) {
    this.stop();
    console.log(`\r  ${c.green}✓${c.reset} ${msg ?? this.msg}`);
  }

  fail(msg?: string) {
    this.stop();
    console.log(`\r  ${c.red}✗${c.reset} ${msg ?? this.msg}`);
  }

  private stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r' + ' '.repeat(this.msg.length + 10) + '\r');
  }
}
```

### File: `src/phases/configure.ts`

- Size: 11582 bytes
- Modified: 2026-03-10 21:41:30 UTC

```typescript
// ── Phase 04: Configure ─────────────────────────────────────────────────────

import { type InstallContext, REPO_URL, TIER_MAP } from '../lib/config.ts';
import { exec } from '../lib/shell.ts';
import { mergeEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { Spinner } from '../lib/ui.ts';
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export async function configure(ctx: InstallContext): Promise<void> {
  ui.phase(4, 6, 'Configure', '~30s');

  // Clone or update repository
  if (existsSync(join(ctx.installDir, '.env'))) {
    ui.info('Existing installation found — updating in place');
    await gitPull(ctx);
  } else {
    await cloneRepo(ctx);
  }

  // Resolve compose overlays
  const composeFiles = resolveComposeFiles(ctx);
  const relPaths = composeFiles.map((f) => f.replace(ctx.installDir + '/', ''));
  ui.ok(`Compose files: ${relPaths.join(', ')}`);

  // Generate .env (or merge on re-install)
  await generateEnv(ctx, composeFiles);

  // Create data directories with correct ownership
  await setupDataDirs(ctx);

  // Generate service-specific configs
  await generateSearXNGConfig(ctx);
  await generateOpenClawConfig(ctx);
}

async function cloneRepo(ctx: InstallContext): Promise<void> {
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would clone repository');
    return;
  }

  const spinner = new ui.Spinner('Cloning repository...');
  spinner.start();

  try {
    const tmpDir = join('/tmp', `dream-clone-${Date.now()}`);
    await exec(['git', 'clone', '--depth', '1', REPO_URL, tmpDir], { timeout: 120_000 });

    const srcDir = join(tmpDir, 'dream-server');
    if (!existsSync(srcDir)) {
      spinner.fail('dream-server directory not found in repository');
      process.exit(1);
    }

    // Copy dream-server contents to install dir
    mkdirSync(ctx.installDir, { recursive: true });
    await exec(['cp', '-r', `${srcDir}/.`, ctx.installDir]);
    await exec(['rm', '-rf', tmpDir]);

    spinner.succeed(`Cloned to ${ctx.installDir}`);
  } catch (e) {
    spinner.fail('Clone failed');
    throw e;
  }
}

async function gitPull(ctx: InstallContext): Promise<void> {
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would pull latest changes');
    return;
  }

  try {
    await exec(['git', 'pull', '--ff-only'], { cwd: ctx.installDir, timeout: 30_000 });
    ui.ok('Updated to latest version');
  } catch {
    ui.warn('Could not auto-update — continuing with existing version');
  }
}

export function resolveComposeFiles(ctx: InstallContext): string[] {
  const dir = ctx.installDir;
  const files: string[] = [];

  // Base compose file
  const base = join(dir, 'docker-compose.base.yml');
  const standalone = join(dir, 'docker-compose.yml');

  if (existsSync(base)) {
    files.push(base);
  } else if (existsSync(standalone)) {
    files.push(standalone);
  }

  // GPU-specific overlay
  if (ctx.gpu.backend === 'nvidia') {
    const nvidia = join(dir, 'docker-compose.nvidia.yml');
    if (existsSync(nvidia)) files.push(nvidia);
  } else if (ctx.gpu.backend === 'amd') {
    const amd = join(dir, 'docker-compose.amd.yml');
    if (existsSync(amd)) files.push(amd);
  }

  // Extension service compose files (sorted for deterministic ordering)
  const extDir = join(dir, 'extensions', 'services');
  if (existsSync(extDir)) {
    for (const svc of readdirSync(extDir).sort()) {
      const composeFile = join(extDir, svc, 'compose.yaml');
      if (existsSync(composeFile)) {
        // Check if the service is enabled
        if (shouldEnableExtension(svc, ctx)) {
          files.push(composeFile);
        }
      }
    }
  }

  return files;
}

function shouldEnableExtension(name: string, ctx: InstallContext): boolean {
  // Map extension directory names to feature flags
  const featureMap: Record<string, keyof typeof ctx.features> = {
    'n8n': 'workflows',
    'openclaw': 'openclaw',
  };

  const feature = featureMap[name];
  if (feature) return ctx.features[feature];

  // Extensions without a feature flag are always enabled
  return true;
}

async function generateEnv(ctx: InstallContext, composeFiles: string[]): Promise<void> {
  const envPath = join(ctx.installDir, '.env');
  const isReinstall = existsSync(envPath) && !ctx.force;

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would generate .env');
    return;
  }

  const tierConfig = TIER_MAP[ctx.tier];

  // Generate cryptographic secrets
  const randHex = (bytes: number) => {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const generatedEnv = [
    `# Dream Server Configuration — ${tierConfig?.name || 'Custom'} Edition`,
    `# Generated by dream-installer on ${new Date().toISOString()}`,
    `# Tier: ${ctx.tier} (${tierConfig?.name || 'Custom'})`,
    ``,
    `# ── Required Secrets ──────────────────────────────────────────`,
    `WEBUI_SECRET=${randHex(32)}`,
    `DASHBOARD_API_KEY=${randHex(32)}`,
    `N8N_USER=admin`,
    `N8N_PASS=${randHex(16)}`,
    `LITELLM_KEY=sk-dream-${randHex(16)}`,
    `OPENCLAW_TOKEN=${randHex(24)}`,
    ``,
    `# ── Mode & Backend ───────────────────────────────────────────`,
    `DREAM_MODE=local`,
    `LLM_API_URL=http://llama-server:8080`,
    `GPU_BACKEND=${ctx.gpu.backend}`,
    ``,
    `# ── Model Configuration ──────────────────────────────────────`,
    `LLM_MODEL=${tierConfig?.model || 'qwen3-8b'}`,
    `GGUF_FILE=${tierConfig?.ggufFile || 'Qwen3-8B-Q4_K_M.gguf'}`,
    `CTX_SIZE=${tierConfig?.context || 16384}`,
    `MAX_CONTEXT=${tierConfig?.context || 16384}`,
    ``,
    `# ── Ports ────────────────────────────────────────────────────`,
    `WEBUI_PORT=3000`,
    `DASHBOARD_PORT=3001`,
    `SEARXNG_PORT=8888`,
    `N8N_PORT=5678`,
    `OLLAMA_PORT=8080`,
    ``,
    `# ── Compose Stack ────────────────────────────────────────────`,
    `COMPOSE_FILE=${composeFiles.map((f) => f.replace(ctx.installDir + '/', '')).join(':')}`,
    ``,
    `# ── Features ─────────────────────────────────────────────────`,
    `ENABLE_VOICE=${ctx.features.voice}`,
    `ENABLE_WORKFLOWS=${ctx.features.workflows}`,
    `ENABLE_RAG=${ctx.features.rag}`,
    `ENABLE_OPENCLAW=${ctx.features.openclaw}`,
    ``,
    `# ── Voice Settings ───────────────────────────────────────────`,
    `WHISPER_MODEL=base`,
    ``,
    `# ── Web UI Settings ──────────────────────────────────────────`,
    `WEBUI_AUTH=true`,
    `ENABLE_WEB_SEARCH=true`,
    `WEB_SEARCH_ENGINE=searxng`,
  ].join('\n');

  if (isReinstall) {
    // Merge: preserve user-edited values, add any new keys
    const existing = readFileSync(envPath, 'utf-8');
    const merged = mergeEnv(existing, generatedEnv);
    await Bun.write(envPath, merged);
    ui.ok('.env merged (user edits preserved, new keys added)');
  } else {
    await Bun.write(envPath, generatedEnv + '\n');
    ui.ok('Generated .env with secure random secrets');
  }
}

/**
 * Create data directories with correct ownership (UID 1000:1000).
 *
 * Many containers run as non-root (node user, UID 1000) but Docker creates
 * bind-mount directories as root when they don't exist, causing EACCES errors.
 * This creates them preemptively with the right ownership.
 */
async function setupDataDirs(ctx: InstallContext): Promise<void> {
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would create data directories');
    return;
  }

  // All data dirs that containers write to, mapped from compose volume mounts
  const dataDirs = [
    'data/models',
    'data/open-webui',
    'data/n8n',
    'data/openclaw',
    'data/openclaw/home',
    'data/qdrant',
    'data/searxng',
    'data/token-spy',
  ];

  let created = 0;
  for (const dir of dataDirs) {
    const fullPath = join(ctx.installDir, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      created++;
    }
  }

  // Fix ownership — containers run as UID 1000 (node user)
  // Only chown if we're running as root (i.e. via sudo)
  if (process.getuid?.() === 0) {
    try {
      await exec(
        ['chown', '-R', '1000:1000', join(ctx.installDir, 'data')],
        { throwOnError: false, timeout: 10000 },
      );
      if (created > 0) {
        ui.ok(`Created ${created} data directories (owned by UID 1000)`);
      }
    } catch {
      ui.warn('Could not set data directory ownership — some services may fail');
      ui.info('Fix manually: sudo chown -R 1000:1000 ' + join(ctx.installDir, 'data'));
    }
  } else {
    if (created > 0) {
      ui.ok(`Created ${created} data directories`);
      ui.warn('Run with sudo to set correct ownership, or fix with:');
      ui.info('sudo chown -R 1000:1000 ' + join(ctx.installDir, 'data'));
    }
  }
}

/**
 * Generate SearXNG settings.yml with randomized secret key.
 */
async function generateSearXNGConfig(ctx: InstallContext): Promise<void> {
  const configPath = join(ctx.installDir, 'data', 'searxng', 'settings.yml');
  if (existsSync(configPath)) return;
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would generate SearXNG config');
    return;
  }

  const randHex = (bytes: number) => {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const settings = `# SearXNG settings — generated by dream-installer
use_default_settings: true

general:
  instance_name: "Dream Search"

server:
  secret_key: "${randHex(32)}"
  bind_address: "0.0.0.0"
  port: 8888

search:
  safe_search: 0
  autocomplete: "google"
  default_lang: "en"

ui:
  static_use_hash: true
  default_theme: simple
`;

  mkdirSync(join(ctx.installDir, 'data', 'searxng'), { recursive: true });
  await Bun.write(configPath, settings);
  ui.ok('Generated SearXNG config (settings.yml)');
}

/**
 * Generate OpenClaw config with model and provider settings.
 */
async function generateOpenClawConfig(ctx: InstallContext): Promise<void> {
  if (!ctx.features.openclaw) return;

  const configPath = join(ctx.installDir, 'data', 'openclaw', 'openclaw.json');
  if (existsSync(configPath)) return;
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would generate OpenClaw config');
    return;
  }

  const tierConfig = TIER_MAP[ctx.tier];
  const model = tierConfig?.model || 'qwen3-8b';

  const config = {
    model,
    provider: 'openai_compatible',
    api_base: 'http://llama-server:8080/v1',
    max_tokens: tierConfig?.context || 16384,
    temperature: 0.7,
  };

  mkdirSync(join(ctx.installDir, 'data', 'openclaw'), { recursive: true });
  await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
  ui.ok('Generated OpenClaw config (openclaw.json)');
}
```

### File: `src/phases/detection.ts`

- Size: 3193 bytes
- Modified: 2026-03-10 21:33:35 UTC

```typescript
// ── Phase 02: Detection ─────────────────────────────────────────────────────

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec } from '../lib/shell.ts';
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
  try {
    const content = await Bun.file('/proc/meminfo').text();
    const match = content.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match) return Math.round(parseInt(match[1], 10) / 1024 / 1024);
  } catch { /* ignore */ }
  return 0;
}

export async function detectDisk(): Promise<number> {
  try {
    const { stdout } = await exec(['df', '-BG', process.env.HOME || '/'], { timeout: 5000 });
    const lines = stdout.split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      return parseInt(parts[3]?.replace('G', '') || '0', 10);
    }
  } catch { /* ignore */ }
  return 0;
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
```

### File: `src/phases/features.ts`

- Size: 2148 bytes
- Modified: 2026-03-09 14:35:08 UTC

```typescript
// ── Phase 03: Feature Selection ─────────────────────────────────────────────

import { type InstallContext, FEATURE_PRESETS, type FeatureSet } from '../lib/config.ts';
import { select, multiSelect } from '../lib/prompts.ts';
import * as ui from '../lib/ui.ts';

export async function features(ctx: InstallContext): Promise<FeatureSet> {
  ui.phase(3, 6, 'Feature Selection');

  if (!ctx.interactive) {
    ui.info('Non-interactive mode — using Full Stack defaults');
    ctx.features = { ...FEATURE_PRESETS.full };
    return ctx.features;
  }

  const choice = await select('Select installation profile', [
    {
      label: 'Full Stack',
      description: 'Chat + Voice + Workflows + RAG + AI Agents (~16GB)',
      hint: 'recommended',
    },
    {
      label: 'Core Only',
      description: 'Chat interface + API (~12GB)',
    },
    {
      label: 'Custom',
      description: 'Choose individual components',
    },
  ]);

  if (choice === 0) {
    ctx.features = { ...FEATURE_PRESETS.full };
    ui.ok('Selected: Full Stack');
  } else if (choice === 1) {
    ctx.features = { ...FEATURE_PRESETS.core };
    ui.ok('Selected: Core Only');
  } else {
    // TUI multi-select picker
    const results = await multiSelect('Toggle features to install', [
      { label: 'Voice', description: 'Whisper STT + Kokoro TTS', checked: true },
      { label: 'Workflows', description: 'n8n automation', checked: true },
      { label: 'RAG', description: 'Qdrant vector database', checked: true },
      { label: 'OpenClaw', description: 'AI agent framework', checked: false },
    ]);

    ctx.features = {
      voice: results[0],
      workflows: results[1],
      rag: results[2],
      openclaw: results[3],
    };
    ui.ok('Selected: Custom');
  }

  // Display selected features
  const f = ctx.features;
  const enabled = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (enabled.length > 0) {
    ui.info(`Features: ${enabled.join(', ')}`);
  } else {
    ui.info('Features: core only');
  }

  return ctx.features;
}
```

### File: `src/phases/health.ts`

- Size: 7791 bytes
- Modified: 2026-03-10 21:39:04 UTC

```typescript
// ── Phase: Health Checks ────────────────────────────────────────────────────
// Per-service health checks, Perplexica auto-config, STT model pre-download.

import { exec } from '../lib/shell.ts';
import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Service health check definition.
 */
interface ServiceCheck {
  name: string;
  port: number;
  healthPath: string;
  timeout: number;       // max seconds to wait
  condition?: () => boolean;  // only check if this returns true
}

/**
 * Build the list of health checks based on .env and enabled features.
 */
function buildChecks(ctx: InstallContext, env: Record<string, string>): ServiceCheck[] {
  const checks: ServiceCheck[] = [
    {
      name: 'llama-server',
      port: parseInt(env.OLLAMA_PORT || '8080', 10),
      healthPath: '/health',
      timeout: 120,
    },
    {
      name: 'Open WebUI',
      port: parseInt(env.WEBUI_PORT || '3000', 10),
      healthPath: '/',
      timeout: 60,
    },
    {
      name: 'Perplexica',
      port: parseInt(env.PERPLEXICA_PORT || '3004', 10),
      healthPath: '/',
      timeout: 30,
    },
    {
      name: 'ComfyUI',
      port: parseInt(env.COMFYUI_PORT || '8188', 10),
      healthPath: '/',
      timeout: 120,
    },
  ];

  if (ctx.features.voice) {
    checks.push(
      {
        name: 'Whisper (STT)',
        port: parseInt(env.WHISPER_PORT || '9000', 10),
        healthPath: '/health',
        timeout: 60,
      },
      {
        name: 'Kokoro (TTS)',
        port: parseInt(env.TTS_PORT || '8880', 10),
        healthPath: '/health',
        timeout: 30,
      },
    );
  }

  if (ctx.features.workflows) {
    checks.push({
      name: 'n8n',
      port: parseInt(env.N8N_PORT || '5678', 10),
      healthPath: '/healthz',
      timeout: 30,
    });
  }

  if (ctx.features.rag) {
    checks.push({
      name: 'Qdrant',
      port: parseInt(env.QDRANT_PORT || '6333', 10),
      healthPath: '/',
      timeout: 30,
    });
  }

  if (ctx.features.openclaw) {
    checks.push({
      name: 'OpenClaw',
      port: parseInt(env.OPENCLAW_PORT || '7860', 10),
      healthPath: '/',
      timeout: 30,
    });
  }

  return checks;
}

/**
 * Check a single service's health by polling its endpoint.
 */
export async function checkServiceHealth(
  name: string,
  url: string,
  timeoutSec: number,
): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutSec / 2);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok || resp.status === 401 || resp.status === 200) {
        return true;
      }
    } catch { /* retry */ }
    await Bun.sleep(2000);
  }
  return false;
}

/**
 * Run all health checks and report results.
 */
export async function runHealthChecks(ctx: InstallContext): Promise<number> {
  const envPath = join(ctx.installDir, '.env');
  let env: Record<string, string> = {};
  if (existsSync(envPath)) {
    env = parseEnv(readFileSync(envPath, 'utf-8'));
  }

  const checks = buildChecks(ctx, env);
  let failures = 0;

  ui.step('Verifying service health...');
  console.log('');

  // Give services a moment to initialize
  if (!ctx.dryRun) await Bun.sleep(5000);

  for (const check of checks) {
    if (ctx.dryRun) {
      ui.ok(`${check.name} (dry run)`);
      continue;
    }

    const url = `http://localhost:${check.port}${check.healthPath}`;
    const healthy = await checkServiceHealth(check.name, url, check.timeout);

    if (healthy) {
      ui.ok(check.name);
    } else {
      ui.warn(`${check.name} — not responding (port ${check.port})`);
      failures++;
    }
  }

  return failures;
}

/**
 * Auto-configure Perplexica with the installed LLM model.
 * Seeds the chat model and embedding model via HTTP API.
 */
export async function configurePerplexica(ctx: InstallContext): Promise<void> {
  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would configure Perplexica');
    return;
  }

  const envPath = join(ctx.installDir, '.env');
  if (!existsSync(envPath)) return;

  const env = parseEnv(readFileSync(envPath, 'utf-8'));
  const port = parseInt(env.PERPLEXICA_PORT || '3004', 10);
  const model = env.LLM_MODEL || 'qwen3-8b';
  const baseUrl = `http://localhost:${port}`;

  try {
    // Check if setup is needed
    const configResp = await fetch(`${baseUrl}/api/config`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!configResp.ok) return;

    const config = await configResp.json() as any;
    if (config?.values?.setupComplete) {
      ui.ok('Perplexica already configured');
      return;
    }

    ui.step(`Configuring Perplexica for ${model}...`);

    const providers = config?.values?.modelProviders || [];
    const openaiProvider = providers.find((p: any) => p.type === 'openai');
    const transformersProvider = providers.find((p: any) => p.type === 'transformers');

    if (!openaiProvider) {
      ui.warn('Perplexica: no OpenAI provider found — complete setup manually');
      return;
    }

    const postConfig = async (key: string, value: unknown) => {
      await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
        signal: AbortSignal.timeout(5000),
      });
    };

    // Seed the chat model
    openaiProvider.chatModels = [{ key: model, name: model }];
    await postConfig('modelProviders', providers);

    // Set default providers
    await postConfig('preferences', {
      defaultChatProvider: openaiProvider.id,
      defaultChatModel: model,
      defaultEmbeddingProvider: transformersProvider?.id || openaiProvider.id,
      defaultEmbeddingModel: 'Xenova/all-MiniLM-L6-v2',
    });

    // Mark setup complete
    await postConfig('setupComplete', true);
    ui.ok(`Perplexica configured (model: ${model})`);
  } catch {
    ui.warn('Perplexica config — complete setup manually at :' + port);
  }
}

/**
 * Pre-download the STT model so first transcription is instant.
 * Speaches lazy-downloads on first request, causing a long delay.
 */
export async function preDownloadSttModel(ctx: InstallContext): Promise<void> {
  if (!ctx.features.voice || ctx.dryRun) return;

  const envPath = join(ctx.installDir, '.env');
  if (!existsSync(envPath)) return;

  const env = parseEnv(readFileSync(envPath, 'utf-8'));
  const whisperPort = parseInt(env.WHISPER_PORT || '9000', 10);

  // GPU gets the fast model, CPU gets the small model
  const sttModel = ctx.gpu.backend === 'nvidia'
    ? 'deepdml/faster-whisper-large-v3-turbo-ct2'
    : 'Systran/faster-whisper-base';

  const whisperUrl = `http://localhost:${whisperPort}`;
  const modelEncoded = encodeURIComponent(sttModel);

  try {
    // Check if model is already loaded
    const checkResp = await fetch(`${whisperUrl}/v1/models/${modelEncoded}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (checkResp.ok) {
      ui.ok(`STT model already cached (${sttModel})`);
      return;
    }

    // Trigger download
    ui.step(`Downloading STT model (${sttModel})...`);
    const downloadResp = await fetch(`${whisperUrl}/v1/models/${modelEncoded}`, {
      method: 'POST',
      signal: AbortSignal.timeout(300_000), // 5 min for large models
    });

    if (downloadResp.ok) {
      ui.ok(`STT model cached (${sttModel})`);
    } else {
      ui.warn('STT model will download on first use');
    }
  } catch {
    ui.warn('STT model will download on first use');
  }
}
```

### File: `src/phases/model.ts`

- Size: 4193 bytes
- Modified: 2026-03-09 14:56:18 UTC

```typescript
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
```

### File: `src/phases/preflight.ts`

- Size: 3713 bytes
- Modified: 2026-03-10 21:34:18 UTC

```typescript
// ── Phase 01: Preflight ─────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, commandExists } from '../lib/shell.ts';
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

  // Root check — allow sudo (SUDO_USER set) but reject direct root login
  if (process.getuid?.() === 0 && !process.env.SUDO_USER) {
    ui.fail('Do not run as root. Use sudo instead: sudo dream-installer install');
    process.exit(1);
  }

  // OS Detection
  const os = process.platform === 'darwin' ? 'macos' : 'linux';
  let distro = '';
  if (existsSync('/etc/os-release')) {
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
      ui.info('Install: curl -fsSL https://get.docker.com | sh');
    } else {
      hasDocker = true;
      // Binary exists but daemon access failed
      ui.fail('Cannot connect to Docker daemon');
      console.log('');
      ui.info('Fix with one of:');
      console.log('     sudo usermod -aG docker $USER && newgrp docker');
      console.log('     # or start the daemon:');
      console.log('     sudo systemctl start docker');
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

```

### File: `src/phases/services.ts`

- Size: 7778 bytes
- Modified: 2026-03-10 21:35:07 UTC

```typescript
// ── Phase 05: Services ──────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export async function services(ctx: InstallContext): Promise<void> {
  ui.phase(6, 6, 'Launch Services', '~2min');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would run: docker compose up -d');
    return;
  }

  // Use shared compose command resolver
  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch {
    ui.fail('Neither "docker compose" nor "docker-compose" found');
    process.exit(1);
    return; // unreachable, but satisfies TS
  }

  ui.step('Starting containers...');
  const exitCode = await execStream(
    [...composeCmd, 'up', '-d', '--remove-orphans'],
    { cwd: ctx.installDir },
  );

  if (exitCode !== 0) {
    // Don't hard-exit — check what actually happened
    ui.warn('docker compose up exited with errors');
    console.log('');
    await showContainerStatus(ctx, composeCmd);
    showRecoveryHelp(ctx, composeCmd);
    // Continue to show success with caveats
  } else {
    ui.ok('All containers started');
  }

  console.log('');

  // Health check
  const ports = readPorts(ctx);
  await healthCheck(ctx, ports);

  // Success summary
  showSuccess(ctx, ports, exitCode !== 0);
}

/**
 * Read configured ports from .env, with sensible defaults.
 */
function readPorts(ctx: InstallContext): Record<string, number> {
  const defaults: Record<string, number> = {
    WEBUI_PORT: 3000,
    DASHBOARD_PORT: 3001,
    LLM_PORT: 8080,
    SEARXNG_PORT: 8888,
  };

  const envPath = join(ctx.installDir, '.env');
  if (!existsSync(envPath)) return defaults;

  try {
    const content = readFileSync(envPath, 'utf-8');
    const env = parseEnv(content);
    return {
      WEBUI_PORT: parseInt(env.WEBUI_PORT || '', 10) || defaults.WEBUI_PORT,
      DASHBOARD_PORT: parseInt(env.DASHBOARD_PORT || '', 10) || defaults.DASHBOARD_PORT,
      LLM_PORT: parseInt(env.OLLAMA_PORT || '', 10) || defaults.LLM_PORT,
      SEARXNG_PORT: parseInt(env.SEARXNG_PORT || '', 10) || defaults.SEARXNG_PORT,
    };
  } catch {
    return defaults;
  }
}

/**
 * Derive the base docker command from the compose command.
 * If composeCmd is ['sudo', 'docker', 'compose'], docker base is ['sudo', 'docker'].
 * If composeCmd is ['docker', 'compose'], docker base is ['docker'].
 * If composeCmd is ['docker-compose'], docker base is ['docker'].
 */
export function getDockerBaseCmd(composeCmd: string[]): string[] {
  if (composeCmd[0] === 'sudo') return ['sudo', 'docker'];
  if (composeCmd[0] === 'docker-compose') return ['docker'];
  return ['docker'];
}

async function showContainerStatus(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps', '--format', 'json'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );

    if (!stdout.trim()) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    const running: string[] = [];
    const failed: string[] = [];

    // Parse containers — handle both JSON array and one-per-line formats
    let containers: Record<string, unknown>[] = [];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('[')) {
      try { containers = JSON.parse(trimmed); } catch { /* fallback below */ }
    } else {
      for (const line of trimmed.split('\n')) {
        try { containers.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }

    if (containers.length === 0) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    for (const c of containers) {
      // Docker Compose v2 uses PascalCase, some versions use lowercase
      const name = ((c.Name ?? c.name ?? '') as string).replace(/^dream-/, '');
      const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
      const status = (c.Status ?? c.status ?? '') as string;

      if (state === 'running') {
        running.push(name);
      } else {
        failed.push(`${name} (${status || state})`);
      }
    }

    if (running.length > 0) {
      ui.ok(`Running (${running.length}): ${running.join(', ')}`);
    }
    if (failed.length > 0) {
      for (const f of failed) {
        ui.fail(f);
      }
    }
  } catch {
    await showContainerStatusFallback(ctx, composeCmd);
  }
}

async function showContainerStatusFallback(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );
    if (stdout.trim()) {
      console.log('');
      console.log(stdout);
    }
  } catch {
    ui.info('Could not get container status');
  }
}

function showRecoveryHelp(ctx: InstallContext, composeCmd: string[]) {
  const cmd = composeCmd.join(' ');
  console.log('');
  ui.info('To inspect failed containers:');
  console.log(`     cd ${ctx.installDir}`);
  console.log(`     ${cmd} logs <service-name>`);
  console.log('');
  ui.info('To retry:');
  console.log(`     ${process.execPath} install`);
}

async function healthCheck(ctx: InstallContext, ports: Record<string, number>): Promise<void> {
  ui.step('Checking service health...');

  const checks = [
    { name: 'Open WebUI', url: `http://localhost:${ports.WEBUI_PORT}` },
  ];

  for (const check of checks) {
    let healthy = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const resp = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok || resp.status === 401) {
          healthy = true;
          break;
        }
      } catch { /* retry */ }
      await Bun.sleep(2000);
    }

    if (healthy) ui.ok(`${check.name} online`);
    else ui.warn(`${check.name} still starting (may take a few minutes)`);
  }
}

function showSuccess(ctx: InstallContext, ports: Record<string, number>, hadErrors: boolean) {
  const localIP = getLocalIP();

  if (hadErrors) {
    ui.header('Installation Partially Complete');
    console.log('');
    ui.warn('Some services failed to start. Core services may still be functional.');
  } else {
    ui.header('Installation Complete');
  }

  console.log('');
  ui.table([
    ['Dashboard', `http://localhost:${ports.DASHBOARD_PORT}`],
    ['Chat', `http://localhost:${ports.WEBUI_PORT}`],
  ]);

  if (localIP) {
    console.log('');
    ui.info('LAN access:');
    ui.table([
      ['Dashboard', `http://${localIP}:${ports.DASHBOARD_PORT}`],
      ['Chat', `http://${localIP}:${ports.WEBUI_PORT}`],
    ]);
  }

  if (ctx.tailscaleIp) {
    console.log('');
    ui.ok('Tailscale access (secure, no port forwarding):');
    ui.table([
      ['Dashboard', `http://${ctx.tailscaleIp}:${ports.DASHBOARD_PORT}`],
      ['Chat', `http://${ctx.tailscaleIp}:${ports.WEBUI_PORT}`],
    ]);
  }

  console.log('');
  ui.info('Your data never leaves this machine.');

  if (hadErrors) {
    console.log('');
    ui.info(`Manage services: cd ${ctx.installDir}`);
  }

  console.log('');
}

function getLocalIP(): string | null {
  try {
    const nets = require('node:os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}
```
