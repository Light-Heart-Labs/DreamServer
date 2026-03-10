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

    const currentTier = getEnv('TIER');
    const tierChanged = tierId !== currentTier;
    const modelChanged = tierConfig.model !== currentModel;

    if (tierChanged || modelChanged) {
      setEnv('LLM_MODEL', tierConfig.model);
      setEnv('GGUF_FILE', tierConfig.ggufFile);
      setEnv('CTX_SIZE', String(tierConfig.context));
      setEnv('MAX_CONTEXT', String(tierConfig.context));
      setEnv('TIER', tierId);
      changed = true;

      if (modelChanged) {
        ui.ok(`Model: ${currentModel} → ${tierConfig.model}`);
      } else {
        ui.ok(`Tier ${currentTier} → ${tierId} (context: ${tierConfig.context})`);
      }

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
