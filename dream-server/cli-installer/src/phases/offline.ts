// ── Phase 09: Offline Mode Setup ────────────────────────────────────────────
// Port of installers/phases/09-offline.sh
// Configures M1 offline/air-gapped operation.

import { type InstallContext } from '../lib/config.ts';
import { exec, commandExists } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export async function offline(ctx: InstallContext): Promise<void> {
  if (!ctx.offlineMode) return;

  ui.phase(0, 0, 'Configuring Offline Mode (M1)');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would configure offline/air-gapped mode (M1)');
    ui.info('[DRY RUN] Would create offline mode marker, disable cloud features');
    if (ctx.features.openclaw) {
      ui.info('[DRY RUN] Would create OpenClaw M1 config');
    }
    ui.info('[DRY RUN] Would pre-download GGUF embeddings for memory_search');
    return;
  }

  const envPath = join(ctx.installDir, '.env');

  // Create offline mode marker
  writeFileSync(join(ctx.installDir, '.offline-mode'), '');

  // Strip cloud API keys from .env
  if (existsSync(envPath)) {
    let envContent = readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/^BRAVE_API_KEY=.*/m, 'BRAVE_API_KEY=');
    envContent = envContent.replace(/^ANTHROPIC_API_KEY=.*/m, 'ANTHROPIC_API_KEY=');
    envContent = envContent.replace(/^OPENAI_API_KEY=.*/m, 'OPENAI_API_KEY=');
    writeFileSync(envPath, envContent);
  }

  // Append M1 offline config block
  const offlineConfig = `
#=============================================================================
# M1 Offline Mode Configuration
#=============================================================================
OFFLINE_MODE=true

# Disable telemetry and update checks
DISABLE_TELEMETRY=true
DISABLE_UPDATE_CHECK=true

# Use local RAG instead of web search
WEB_SEARCH_ENABLED=false
LOCAL_RAG_ENABLED=true
`;

  appendFileSync(envPath, offlineConfig);

  // Create OpenClaw M1 config if enabled
  if (ctx.features.openclaw) {
    const openclawDir = join(ctx.installDir, 'config', 'openclaw');
    mkdirSync(openclawDir, { recursive: true });

    const m1Config = `# OpenClaw M1 Mode Configuration
# Fully offline operation - no cloud dependencies

memorySearch:
  enabled: true
  # Uses bundled GGUF embeddings (auto-downloaded during install)
  # No external API calls

# Disable web search (not available offline)
# Use local RAG with Qdrant instead
webSearch:
  enabled: false

# Local inference only
inference:
  provider: local
  baseUrl: http://llama-server:8080/v1
`;

    writeFileSync(join(openclawDir, 'openclaw-m1.yaml'), m1Config);
    ui.ok('OpenClaw M1 config created');
  }

  // Pre-download GGUF embeddings for memory_search
  ui.info('Pre-downloading GGUF embeddings for offline memory_search...');
  const embedDir = join(ctx.installDir, 'models', 'embeddings');
  mkdirSync(embedDir, { recursive: true });

  const embedFile = join(embedDir, 'nomic-embed-text-v1.5.Q4_K_M.gguf');
  const embedUrl = 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf';

  if (!existsSync(embedFile)) {
    const hasCurl = await commandExists('curl');
    if (hasCurl) {
      const dl = await exec(
        ['curl', '-L', '-o', embedFile, embedUrl],
        { throwOnError: false, timeout: 300_000 },
      );
      if (dl.exitCode !== 0) {
        ui.warn('Could not pre-download embeddings. Memory search will download on first use.');
      }
    } else {
      ui.warn('curl not available — skipping embeddings pre-download');
    }
  } else {
    ui.info('Embeddings already downloaded');
  }

  ui.ok('Offline mode configured');
  ui.info('After installation, disconnect from internet for fully air-gapped operation');
  ui.info('See docs/M1-OFFLINE-MODE.md for offline operation guide');
}
