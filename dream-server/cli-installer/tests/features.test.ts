import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { features } from '../src/phases/features.ts';
import { createDefaultContext, FEATURE_PRESETS } from '../src/lib/config.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as ui from '../src/lib/ui.ts';

describe('features.ts', () => {
  let selectSpy: ReturnType<typeof spyOn>;
  let multiSelectSpy: ReturnType<typeof spyOn>;
  let confirmSpy: ReturnType<typeof spyOn>;
  let inputSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});

    selectSpy = spyOn(prompts, 'select').mockImplementation(async () => 0); // Full Stack
    multiSelectSpy = spyOn(prompts, 'multiSelect').mockImplementation(async () => [true, true, true, false]);
    confirmSpy = spyOn(prompts, 'confirm').mockImplementation(async () => false); // Decline detected backends
    inputSpy = spyOn(prompts, 'input').mockImplementation(async () => '');

    // Mock fetch to prevent real network calls (auto-detection probes localhost ports)
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error('mocked - no backend available');
    }) as any);
  });

  afterEach(() => {
    selectSpy.mockRestore();
    multiSelectSpy.mockRestore();
    confirmSpy.mockRestore();
    inputSpy.mockRestore();
    fetchSpy.mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
  });

  test('features() returns defaults in non-interactive mode', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = false;

    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.full);
  });

  test('features() returns full stack when user selects Full Stack', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    selectSpy.mockImplementation(async () => 0); // Full Stack
    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.full);
  });

  test('features() returns core only when user selects Core Only', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    selectSpy.mockImplementation(async () => 1); // Core Only
    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.core);
  });

  test('features() returns custom selection when user selects Custom', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    // First select → Custom (2), second select → llamacpp (0)
    let selectCall = 0;
    selectSpy.mockImplementation(async () => {
      selectCall++;
      return selectCall === 1 ? 2 : 0; // Custom, then llamacpp
    });
    multiSelectSpy.mockImplementation(async () => [true, false, true, false, true, false, false, false]); // webSearch, no imageGen, voice, no workflows, rag, no litellm, no openclaw, no devtools
    const feats = await features(ctx);
    expect(feats.webSearch).toBe(true);
    expect(feats.imageGen).toBe(false);
    expect(feats.voice).toBe(true);
    expect(feats.workflows).toBe(false);
    expect(feats.rag).toBe(true);
    expect(feats.openclaw).toBe(false);
  });

  test('features() offers vLLM backend selection on NVIDIA + Custom', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;
    ctx.gpu.backend = 'nvidia';

    // First select => Custom (2), second => vLLM (1)
    let callCount = 0;
    selectSpy.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 2 : 1; // Custom, then vLLM
    });
    multiSelectSpy.mockImplementation(async () => [true, true, true, true, true, false, false, false]);

    await features(ctx);
    expect(ctx.llmBackend).toBe('vllm');
    expect(selectSpy).toHaveBeenCalledTimes(2); // Feature profile + backend
  });

  test('features() defaults to llamacpp on non-NVIDIA GPU', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;
    ctx.gpu.backend = 'amd';

    // First select => Custom (2), second => llamacpp (0)
    let callCount = 0;
    selectSpy.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 2 : 0; // Custom, then llamacpp
    });
    multiSelectSpy.mockImplementation(async () => [true, true, true, true, true, false, false, false]);

    await features(ctx);
    expect(ctx.llmBackend).toBe('llamacpp');
    // 2 select calls: profile + backend (no vLLM, but Ollama/External still shown)
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });

  test('features() defaults to llamacpp on Full Stack preset', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;
    ctx.gpu.backend = 'nvidia';

    selectSpy.mockImplementation(async () => 0); // Full Stack
    await features(ctx);
    expect(ctx.llmBackend).toBe('llamacpp');
    // Only 1 select call — Full Stack doesn't show backend picker
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  test('features() detects and uses Ollama when user confirms', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    // Mock fetch to simulate Ollama running on localhost:11434
    fetchSpy.mockImplementation((async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes('localhost:11434/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:3b' }],
        }), { status: 200 });
      }
      throw new Error('connection refused');
    }) as any);

    // User confirms using detected Ollama, then selects Full Stack
    confirmSpy.mockImplementation(async () => true);
    selectSpy.mockImplementation(async () => 0); // Full Stack

    await features(ctx);
    expect(ctx.llmBackend).toBe('ollama');
    expect(ctx.externalLlmUrl).toBe('http://localhost:11434');
  });

  test('features() offers Ollama as backend choice in manual selection', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;
    ctx.gpu.backend = 'nvidia'; // nvidia: choices are llamacpp(0), vllm(1), ollama(2), external(3)

    // First select => Custom (2), second => Ollama (2)
    let callCount = 0;
    selectSpy.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 2 : 2; // Custom, then Ollama
    });
    multiSelectSpy.mockImplementation(async () => [true, true, true, false, false]);

    await features(ctx);
    expect(ctx.llmBackend).toBe('ollama');
    expect(ctx.externalLlmUrl).toBe('http://host.docker.internal:11434');
  });
});
