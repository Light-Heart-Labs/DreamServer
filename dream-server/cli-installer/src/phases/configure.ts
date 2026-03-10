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

  // vLLM overlay — replaces llama-server with vLLM container
  if (ctx.llmBackend === 'vllm') {
    const vllm = join(dir, 'docker-compose.vllm.yml');
    if (existsSync(vllm)) files.push(vllm);
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

  const generatedLines = [
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
    ``,
    `# ── LLM Backend ──────────────────────────────────────────────`,
    `LLM_BACKEND=${ctx.llmBackend}`,
  ];

  // Add vLLM-specific env vars
  if (ctx.llmBackend === 'vllm' && tierConfig) {
    const vllmArgs = tierConfig.vllmArgs.join(' ');
    generatedLines.push(
      `VLLM_MODEL=${tierConfig.vllmModel}`,
      `VLLM_ARGS=${vllmArgs}`,
      `VLLM_HF_CACHE=./data/hf-cache`,
      `VLLM_IMAGE=vllm/vllm-openai:v0.17.0`,
    );
  }

  const generatedEnv = generatedLines.join('\n');

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
    ...(ctx.llmBackend === 'vllm' ? ['data/hf-cache'] : []),
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
