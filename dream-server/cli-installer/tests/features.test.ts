import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { features } from '../src/phases/features.ts';
import { createDefaultContext, FEATURE_PRESETS } from '../src/lib/config.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as ui from '../src/lib/ui.ts';

describe('features.ts', () => {
  let selectSpy: ReturnType<typeof spyOn>;
  let multiSelectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});

    selectSpy = spyOn(prompts, 'select').mockImplementation(async () => 0); // Full Stack
    multiSelectSpy = spyOn(prompts, 'multiSelect').mockImplementation(async () => [true, true, true, false]);
  });

  afterEach(() => {
    selectSpy.mockRestore();
    multiSelectSpy.mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
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

    selectSpy.mockImplementation(async () => 2); // Custom
    multiSelectSpy.mockImplementation(async () => [true, false, true, false]); // Voice, RAG
    const feats = await features(ctx);
    expect(feats).toEqual({
      voice: true,
      workflows: false,
      rag: true,
      openclaw: false,
    });
  });
});
