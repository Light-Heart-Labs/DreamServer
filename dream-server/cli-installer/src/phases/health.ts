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
