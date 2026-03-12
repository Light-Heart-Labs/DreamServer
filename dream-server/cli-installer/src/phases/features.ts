// ── Phase 03: Feature Selection ─────────────────────────────────────────────

import { type InstallContext, FEATURE_PRESETS, type FeatureSet, type LlmBackend } from '../lib/config.ts';
import { select, multiSelect, confirm, input } from '../lib/prompts.ts';
import { commandExists } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';

/**
 * Result of probing for an existing LLM backend on the system.
 */
interface DetectedBackend {
  type: 'ollama' | 'llamacpp' | 'vllm' | 'openai-compatible';
  url: string;
  models: string[];
  label: string;
}

/**
 * Probe for existing LLM inference backends on the host.
 * Checks Ollama, llama-server (llama.cpp), and any OpenAI-compatible server.
 */
async function detectExistingBackends(): Promise<DetectedBackend[]> {
  const detected: DetectedBackend[] = [];

  // ── Check Ollama ──────────────────────────────────────────────
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = await resp.json() as { models?: { name: string }[] };
      const models = data.models?.map((m) => m.name) || [];
      detected.push({
        type: 'ollama',
        url: 'http://localhost:11434',
        models,
        label: `Ollama (${models.length} model${models.length !== 1 ? 's' : ''} loaded)`,
      });
    }
  } catch { /* not running */ }

  // ── Check llama-server (llama.cpp) on port 8080 ───────────────
  try {
    const resp = await fetch('http://localhost:8080/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      // Try to get model info
      let models: string[] = [];
      try {
        const modelResp = await fetch('http://localhost:8080/v1/models', {
          signal: AbortSignal.timeout(2000),
        });
        if (modelResp.ok) {
          const modelData = await modelResp.json() as { data?: { id: string }[] };
          models = modelData.data?.map((m) => m.id) || [];
        }
      } catch { /* no model info */ }
      detected.push({
        type: 'llamacpp',
        url: 'http://localhost:8080',
        models,
        label: `llama-server on :8080${models.length > 0 ? ` (${models.join(', ')})` : ''}`,
      });
    }
  } catch { /* not running */ }

  // ── Check for vLLM on common ports (8000, 8080) ──────────────
  for (const port of [8000]) {
    try {
      const resp = await fetch(`http://localhost:${port}/v1/models`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json() as { data?: { id: string }[] };
        const models = data.data?.map((m) => m.id) || [];
        // Check if it's vLLM specifically (vLLM has /version endpoint)
        let isVllm = false;
        try {
          const verResp = await fetch(`http://localhost:${port}/version`, {
            signal: AbortSignal.timeout(1000),
          });
          isVllm = verResp.ok;
        } catch { /* not vLLM */ }

        if (isVllm) {
          detected.push({
            type: 'vllm',
            url: `http://localhost:${port}`,
            models,
            label: `vLLM on :${port}${models.length > 0 ? ` (${models.join(', ')})` : ''}`,
          });
        } else {
          detected.push({
            type: 'openai-compatible',
            url: `http://localhost:${port}`,
            models,
            label: `OpenAI-compatible API on :${port}${models.length > 0 ? ` (${models.join(', ')})` : ''}`,
          });
        }
      }
    } catch { /* not running */ }
  }

  return detected;
}

export async function features(ctx: InstallContext): Promise<FeatureSet> {
  ui.phase(3, 6, 'Feature Selection');

  if (!ctx.interactive) {
    ui.info('Non-interactive mode — using Full Stack defaults');
    ctx.features = { ...FEATURE_PRESETS.full };
    return ctx.features;
  }

  // ── Auto-detect existing LLM backends ──────────────────────────
  ui.step('Scanning for existing inference backends...');
  const detectedBackends = await detectExistingBackends();

  if (detectedBackends.length > 0) {
    console.log('');
    for (const backend of detectedBackends) {
      ui.ok(`Found: ${backend.label}`);
    }
    console.log('');

    // If exactly one backend detected, offer to use it directly
    if (detectedBackends.length === 1) {
      const backend = detectedBackends[0];
      const useExisting = await confirm(`Use existing ${backend.label}?`, true);
      if (useExisting) {
        applyDetectedBackend(ctx, backend);
        ui.ok(`Will use ${backend.label} — no model download needed`);
        console.log('');
      }
    } else {
      // Multiple backends detected — let user choose
      const choices = [
        ...detectedBackends.map((b) => ({
          label: `Use ${b.label}`,
          description: b.url,
        })),
        { label: 'Install fresh', description: 'Download and manage a new llama-server instance' },
      ];

      const choice = await select('Multiple inference backends detected', choices);
      if (choice < detectedBackends.length) {
        applyDetectedBackend(ctx, detectedBackends[choice]);
        ui.ok(`Will use ${detectedBackends[choice].label}`);
        console.log('');
      }
      // else: 'Install fresh' — continue with normal flow
    }
  } else {
    ui.info('No existing inference backends detected');
  }

  console.log('');

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
      { label: 'Dev Tools', description: 'Claude Code, Codex CLI, OpenCode', checked: false },
    ]);

    ctx.features = {
      voice: results[0],
      workflows: results[1],
      rag: results[2],
      openclaw: results[3],
      devtools: results[4],
    };
    ui.ok('Selected: Custom');

    // ── LLM Backend selection (Custom profile only, if not already set by auto-detection) ──
    if (ctx.llmBackend === 'llamacpp' && !ctx.externalLlmUrl) {
      ctx.llmBackend = await selectLlmBackend(ctx);
    }
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
  if (ctx.llmBackend !== 'llamacpp') {
    const backendLabels: Record<string, string> = {
      vllm: 'vLLM',
      ollama: `Ollama (${ctx.externalLlmUrl || 'localhost:11434'})`,
      external: `External API (${ctx.externalLlmUrl || 'custom'})`,
    };
    ui.info(`LLM backend: ${backendLabels[ctx.llmBackend] || ctx.llmBackend}`);
  }

  return ctx.features;
}

/**
 * Apply a detected backend to the install context.
 */
function applyDetectedBackend(ctx: InstallContext, backend: DetectedBackend): void {
  switch (backend.type) {
    case 'ollama':
      ctx.llmBackend = 'ollama';
      ctx.externalLlmUrl = backend.url;
      break;
    case 'llamacpp':
      ctx.llmBackend = 'external';
      ctx.externalLlmUrl = backend.url;
      break;
    case 'vllm':
      ctx.llmBackend = 'external';
      ctx.externalLlmUrl = backend.url;
      break;
    case 'openai-compatible':
      ctx.llmBackend = 'external';
      ctx.externalLlmUrl = backend.url;
      break;
  }
}

async function selectLlmBackend(ctx: InstallContext): Promise<LlmBackend> {
  console.log('');

  const choices: { label: string; description: string; hint?: string }[] = [
    {
      label: 'llama.cpp',
      description: 'GGUF quantized models — lower RAM, wider compatibility',
      hint: 'default',
    },
  ];

  // vLLM only available on NVIDIA GPUs
  if (ctx.gpu.backend === 'nvidia') {
    choices.push({
      label: 'vLLM',
      description: 'HuggingFace models — higher throughput, FlashAttention',
    });
  }

  // Ollama is always available (runs on host)
  choices.push({
    label: 'Ollama',
    description: 'External Ollama instance — manage models via ollama CLI',
  });

  // External API for advanced users
  choices.push({
    label: 'External API',
    description: 'Connect to an existing OpenAI-compatible inference server',
  });

  const choice = await select('Select LLM inference backend', choices);

  // Map choice index to backend type
  if (choice === 0) return 'llamacpp';

  let idx = 1;
  if (ctx.gpu.backend === 'nvidia') {
    if (choice === idx) return 'vllm';
    idx++;
  }

  if (choice === idx) {
    // Ollama selected
    ctx.externalLlmUrl = 'http://host.docker.internal:11434';
    return 'ollama';
  }
  idx++;

  if (choice === idx) {
    // External API selected — prompt for URL
    const url = await input('Enter the base URL of your inference server (e.g. http://localhost:8080)');
    if (url) {
      // Normalize: convert localhost → host.docker.internal for Docker containers
      ctx.externalLlmUrl = url.replace(
        /http:\/\/(localhost|127\.0\.0\.1)/,
        'http://host.docker.internal',
      );
    }
    return 'external';
  }

  return 'llamacpp';
}
