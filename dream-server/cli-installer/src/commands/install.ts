// ── Install Command ─────────────────────────────────────────────────────────

import { type InstallContext, createDefaultContext } from '../lib/config.ts';
import { preflight } from '../phases/preflight.ts';
import { detect } from '../phases/detection.ts';
import { features } from '../phases/features.ts';
import { configure } from '../phases/configure.ts';
import { downloadModel } from '../phases/model.ts';
import { services } from '../phases/services.ts';
import { devtools } from '../phases/devtools.ts';
import { offline } from '../phases/offline.ts';
import { amdTuning } from '../phases/amd-tuning.ts';
import { nativeMetal } from '../phases/native-metal.ts';
import { checkRequiredPorts } from '../lib/ports.ts';
import { runHealthChecks, configurePerplexica, preDownloadSttModel } from '../phases/health.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { setVerbose } from '../lib/ui.ts';
import { VERSION } from '../lib/config.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstallOptions {
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  tier?: string;
  nonInteractive?: boolean;
  all?: boolean;
  voice?: boolean;
  workflows?: boolean;
  rag?: boolean;
  openclaw?: boolean;
  devtools?: boolean;
  offline?: boolean;
  dir?: string;
}

export async function install(opts: InstallOptions): Promise<void> {
  ui.banner(VERSION);

  const ctx = createDefaultContext();

  // Apply CLI options
  ctx.dryRun = opts.dryRun ?? false;
  ctx.force = opts.force ?? false;
  ctx.verbose = opts.verbose ?? false;
  setVerbose(ctx.verbose);
  ctx.interactive = !(opts.nonInteractive ?? false);
  if (opts.tier) ctx.tier = opts.tier;
  if (opts.dir) ctx.installDir = opts.dir;
  ctx.offlineMode = opts.offline ?? false;
  if (opts.all) {
    ctx.features = { voice: true, workflows: true, rag: true, openclaw: true, devtools: true };
  } else {
    if (opts.voice !== undefined) ctx.features.voice = opts.voice;
    if (opts.workflows !== undefined) ctx.features.workflows = opts.workflows;
    if (opts.rag !== undefined) ctx.features.rag = opts.rag;
    if (opts.openclaw !== undefined) ctx.features.openclaw = opts.openclaw;
    if (opts.devtools !== undefined) ctx.features.devtools = opts.devtools;
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
    if (!portsOk && !ctx.force && !ctx.dryRun && !isResume) {
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
    } else if (!opts.all && !(opts.voice || opts.workflows || opts.rag || opts.openclaw || opts.devtools)) {
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

    // Phase 5b: Native Metal llama-server (macOS Apple Silicon only)
    await nativeMetal(ctx);

    // Phase 6: Start services
    const servicesExitCode = await services(ctx);

    // Post-install: health checks, auto-config, STT pre-download
    console.log('');
    const failures = await runHealthChecks(ctx);
    await configurePerplexica(ctx);
    await preDownloadSttModel(ctx);

    // Post-install: developer tools (opt-in)
    await devtools(ctx);

    // Post-install: offline mode (M1)
    await offline(ctx);

    // Post-install: AMD APU tuning (auto-detected)
    await amdTuning(ctx);

    // ── Final Summary (always last) ──────────────────────────────
    const { showSuccess, readPorts } = await import('../phases/services.ts');
    const ports = readPorts(ctx);
    const hadErrors = servicesExitCode !== 0 || failures > 0;
    showSuccess(ctx, ports, hadErrors);

    if (failures > 0) {
      ui.warn(`${failures} service(s) did not pass health checks.`);
      ui.info('Some services may still be starting. Check with: dream-installer status');
    }
  } catch (error) {
    console.log('');
    ui.fail(`Installation failed: ${error instanceof Error ? error.message : String(error)}`);
    console.log('');
    ui.info('To retry, just re-run the installer:');
    console.log(`     dream-installer install`);
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
    if (env.ENABLE_DEVTOOLS !== undefined) ctx.features.devtools = toBool(env.ENABLE_DEVTOOLS);
    if (env.OFFLINE_MODE !== undefined) ctx.offlineMode = toBool(env.OFFLINE_MODE);

    if (env.GPU_BACKEND) ctx.gpu.backend = env.GPU_BACKEND as 'nvidia' | 'amd' | 'apple' | 'cpu';

    // Restore LLM backend choice
    if (env.LLM_BACKEND) {
      ctx.llmBackend = env.LLM_BACKEND as 'llamacpp' | 'vllm' | 'ollama' | 'external';
    }
    // Restore external LLM URL for Ollama/external backends
    if (env.LLM_API_URL && (ctx.llmBackend === 'ollama' || ctx.llmBackend === 'external')) {
      ctx.externalLlmUrl = env.LLM_API_URL;
    }
  } catch {
    // If .env can't be read, defaults will be used
  }
}
