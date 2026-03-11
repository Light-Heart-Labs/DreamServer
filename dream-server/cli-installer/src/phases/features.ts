// ── Phase 03: Feature Selection ─────────────────────────────────────────────

import { type InstallContext, FEATURE_PRESETS, type FeatureSet, type LlmBackend } from '../lib/config.ts';
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

    // LLM backend selection — only for NVIDIA GPUs
    if (ctx.gpu.backend === 'nvidia') {
      ctx.llmBackend = await selectLlmBackend();
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
    ui.info(`LLM backend: ${ctx.llmBackend}`);
  }

  return ctx.features;
}

async function selectLlmBackend(): Promise<LlmBackend> {
  console.log('');
  const choice = await select('Select LLM inference backend', [
    {
      label: 'llama.cpp',
      description: 'GGUF quantized models — lower RAM, wider compatibility',
      hint: 'default',
    },
    {
      label: 'vLLM',
      description: 'HuggingFace models — higher throughput, FlashAttention, Qwen3.5',
    },
  ]);

  return choice === 0 ? 'llamacpp' : 'vllm';
}
