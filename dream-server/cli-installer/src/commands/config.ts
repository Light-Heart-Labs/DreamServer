// ── Config Command ──────────────────────────────────────────────────────────
// Reconfigure features, tier, or model on an existing installation.

import { type InstallContext, createDefaultContext, TIER_MAP, type FeatureSet, DEFAULT_INSTALL_DIR, type LlmBackend } from '../lib/config.ts';
import { resolveComposeFiles } from '../phases/configure.ts';
import { downloadModel } from '../phases/model.ts';
import { killNativeLlama, nativeMetal } from '../phases/native-metal.ts';
import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { parseEnv, setEnvValue } from '../lib/env.ts';
import { getComposeFileSeparator } from '../lib/platform.ts';
import { select, multiSelect } from '../lib/prompts.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ConfigOptions {
  dir?: string;
  features?: boolean;
  tier?: boolean;
  backend?: boolean;
}

export async function config(opts: ConfigOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;
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
  if (!opts.features && !opts.tier && !opts.backend) {
    const choice = await select('What would you like to configure?', [
      { label: 'Features', description: 'Enable/disable Voice, Workflows, RAG, OpenClaw' },
      { label: 'Tier / Model', description: `Currently: ${getEnv('LLM_MODEL') || 'unknown'}` },
      { label: 'LLM Backend', description: `Currently: ${getEnv('LLM_BACKEND') || 'llamacpp'}` },
      { label: 'All', description: 'Change features, model, and backend' },
    ]);
    opts.features = choice === 0 || choice === 3;
    opts.tier = choice === 1 || choice === 3;
    opts.backend = choice === 2 || choice === 3;
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
      devtools: getEnv('ENABLE_DEVTOOLS') === 'true', // devtools managed separately
    };

    // Check what changed
    const oldFeatures: FeatureSet = {
      voice: getEnv('ENABLE_VOICE') === 'true',
      workflows: getEnv('ENABLE_WORKFLOWS') === 'true',
      rag: getEnv('ENABLE_RAG') === 'true',
      openclaw: getEnv('ENABLE_OPENCLAW') === 'true',
      devtools: getEnv('ENABLE_DEVTOOLS') === 'true',
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

      // Update vLLM-specific env vars if using vLLM backend
      if (getEnv('LLM_BACKEND') === 'vllm' && tierConfig.vllmModel) {
        setEnv('VLLM_MODEL', tierConfig.vllmModel);
        setEnv('VLLM_ARGS', tierConfig.vllmArgs.join(' '));
        ui.ok(`vLLM model: ${tierConfig.vllmModel}`);
      }

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

  // ── LLM Backend configuration ──
  if (opts.backend) {
    console.log('');
    ui.step('Configure LLM backend:');

    const currentBackend = getEnv('LLM_BACKEND') || 'llamacpp';
    const gpuBE = getEnv('GPU_BACKEND') || 'cpu';

    const backendChoices = [
      {
        label: 'llama.cpp',
        description: 'GGUF quantized models — lower VRAM, fast inference',
        hint: currentBackend === 'llamacpp' ? 'current' : undefined,
      },
      {
        label: 'vLLM',
        description: 'Full-precision HuggingFace models — tensor parallelism (NVIDIA)',
        hint: currentBackend === 'vllm' ? 'current' : (gpuBE !== 'nvidia' ? 'requires NVIDIA GPU' : undefined),
      },
      {
        label: 'Ollama',
        description: 'Easy model management with auto-downloads and large model library',
        hint: currentBackend === 'ollama' ? 'current' : undefined,
      },
    ];

    const backendChoice = await select('Select LLM backend', backendChoices);
    const backendIds: LlmBackend[] = ['llamacpp', 'vllm', 'ollama'];
    const newBackend = backendIds[backendChoice];

    if (newBackend !== currentBackend) {
      // vLLM requires NVIDIA GPU
      if (newBackend === 'vllm' && gpuBE !== 'nvidia') {
        ui.warn('vLLM requires an NVIDIA GPU. Your GPU backend is: ' + gpuBE);
        const { confirm } = await import('../lib/prompts.ts');
        const proceed = await confirm('Continue anyway?', false);
        if (!proceed) {
          ui.info('Backend unchanged');
          // Skip to end without setting changed
          opts.backend = false;
        }
      }

      if (opts.backend !== false) {
        // ── Ollama: install on host if not present ──
        if (newBackend === 'ollama') {
          console.log('');
          ui.info('Ollama runs on the host machine (not in Docker).');
          ui.info('The llama-server container will be disabled to free VRAM.');
          console.log('');

          // Check if Ollama is already installed
          const { exitCode: ollamaCheck } = await exec(
            ['which', 'ollama'],
            { throwOnError: false, timeout: 3000 },
          );

          if (ollamaCheck !== 0) {
            ui.step('Installing Ollama...');
            // Download and run official install script
            const installResult = await execStream(
              ['bash', '-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
              { cwd: installDir },
            );
            if (installResult !== 0) {
              ui.warn('Ollama install failed — you can install manually:');
              ui.info('  curl -fsSL https://ollama.com/install.sh | sh');
              // Continue anyway so env gets updated
            } else {
              ui.ok('Ollama installed');
            }
          } else {
            ui.ok('Ollama already installed');
          }

          // Start Ollama service if not running
          ui.step('Ensuring Ollama is running...');
          const { exitCode: serveCheck } = await exec(
            ['bash', '-c', 'curl -sf http://localhost:11434/api/version'],
            { throwOnError: false, timeout: 3000 },
          );
          if (serveCheck !== 0) {
            // Start as a background daemon
            await exec(
              ['bash', '-c', 'ollama serve &'],
              { throwOnError: false, timeout: 3000 },
            );
            // Wait a moment for it to come up
            for (let i = 0; i < 10; i++) {
              await Bun.sleep(1000);
              const { exitCode } = await exec(
                ['bash', '-c', 'curl -sf http://localhost:11434/api/version'],
                { throwOnError: false, timeout: 2000 },
              );
              if (exitCode === 0) break;
            }
            const { exitCode: finalCheck } = await exec(
              ['bash', '-c', 'curl -sf http://localhost:11434/api/version'],
              { throwOnError: false, timeout: 2000 },
            );
            if (finalCheck === 0) {
              ui.ok('Ollama is running on port 11434');
            } else {
              ui.warn('Ollama installed but not responding. Start it with: ollama serve');
            }
          } else {
            ui.ok('Ollama is already running');
          }
        }

        // Set backend env vars
        setEnv('LLM_BACKEND', newBackend);

        // Update LLM_API_URL based on backend
        switch (newBackend) {
          case 'ollama':
            setEnv('LLM_API_URL', 'http://host.docker.internal:11434');
            break;
          case 'vllm':
          case 'llamacpp':
          default:
            setEnv('LLM_API_URL', gpuBE === 'apple' ? 'http://host.docker.internal:8080' : 'http://llama-server:8080');
            break;
        }

        // ── vLLM: set env vars and pre-pull the Docker image ──
        if (newBackend === 'vllm') {
          const currentTier = getEnv('TIER') || '2';
          const tierConfig = TIER_MAP[currentTier];
          const vllmImage = 'vllm/vllm-openai:v0.17.0';

          if (tierConfig?.vllmModel) {
            setEnv('VLLM_MODEL', tierConfig.vllmModel);
            setEnv('VLLM_ARGS', tierConfig.vllmArgs.join(' '));
            setEnv('VLLM_IMAGE', vllmImage);
            ui.ok(`vLLM model: ${tierConfig.vllmModel}`);
          }

          // Ensure HF cache directory exists for vLLM model downloads
          const hfCache = join(installDir, 'data', 'hf-cache');
          try { mkdirSync(hfCache, { recursive: true }); } catch { /* exists */ }

          // Pre-pull the vLLM image so user sees progress
          console.log('');
          ui.step(`Pulling vLLM image (${vllmImage})...`);
          ui.info('This may take a few minutes (~8 GB)');
          const pullCmd = await getComposeCommand();
          // Use docker pull directly for better progress output
          const dockerBase = pullCmd[0] === 'sudo' ? ['sudo', 'docker'] : ['docker'];
          const pullResult = await execStream(
            [...dockerBase, 'pull', vllmImage],
          );
          if (pullResult === 0) {
            ui.ok('vLLM image ready');
          } else {
            ui.warn('Image pull failed — Docker will retry on restart');
          }
        }

        changed = true;
        ui.ok(`Backend: ${currentBackend} → ${newBackend}`);
      }
    } else {
      ui.info('Backend unchanged');
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
    devtools: rebuildParsed.ENABLE_DEVTOOLS === 'true',
  };
  const gpuBackend = getEnv('GPU_BACKEND');
  ctx.gpu.backend = (gpuBackend as 'nvidia' | 'amd' | 'apple' | 'cpu') || 'cpu';
  ctx.llmBackend = (rebuildParsed.LLM_BACKEND as LlmBackend) || 'llamacpp';

  const composeFiles = resolveComposeFiles(ctx);
  const composePaths = composeFiles.map(f => relative(installDir, f)).join(getComposeFileSeparator());
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

  // Restart native Metal llama-server if on macOS
  if (gpuBackend === 'apple') {
    ui.step('Restarting native Metal llama-server...');
    await killNativeLlama(installDir);
    ctx.tier = rebuildParsed.TIER || '1';
    await nativeMetal(ctx);
  }

  console.log('');
}
