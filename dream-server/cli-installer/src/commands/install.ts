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
