import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { downloadModel } from '../src/phases/model.ts';
import { createDefaultContext, TIER_MAP } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as platform from '../src/lib/platform.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('model.ts', () => {
  let tmpDir: string;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let execSpy: ReturnType<typeof spyOn>;
  let commandExistsSpy: ReturnType<typeof spyOn>;
  let moveFileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-model-'));

    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0);
    commandExistsSpy = spyOn(shell, 'commandExists').mockImplementation(async (cmd) => {
      if (cmd === 'wget') return true;
      if (cmd === 'curl') return true;
      return false;
    });
    moveFileSpy = spyOn(platform, 'moveFile').mockImplementation((src: string, dest: string) => {
      fs.writeFileSync(dest, 'mock_data_after_move');
    });
    execSpy = spyOn(shell, 'exec').mockImplementation(async () => {
      return { exitCode: 0, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(console, 'log').mockRestore();
    execStreamSpy.mockRestore();
    commandExistsSpy.mockRestore();
    moveFileSpy.mockRestore();
    execSpy.mockRestore();
  });

  test('downloadModel() skips if tier does not have model', async () => {
    const ctx = createDefaultContext();
    ctx.tier = 'non_existent_tier';

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() skips if model file already exists', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    const tierConfig = TIER_MAP['1'];
    const modelsDir = join(tmpDir, 'data', 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(join(modelsDir, tierConfig.ggufFile), 'mock_data');

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() dryRun does not download', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;
    ctx.dryRun = true;

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() downloads using wget if available', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    await downloadModel(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args[0]).toBe('wget');
  });

  test('downloadModel() downloads using curl if wget not available', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    commandExistsSpy.mockImplementation(async (cmd) => {
      if (cmd === 'wget') return false; // wget not found
      if (cmd === 'curl') return true;
      return false;
    });

    await downloadModel(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args[0]).toBe('curl');
  });

  test('downloadModel() handles download failures after 3 attempts', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    await expect(downloadModel(ctx)).rejects.toThrow('Model download failed');

    // Should retry 3 times
    expect(execStreamSpy).toHaveBeenCalledTimes(3);
    expect(ui.fail).toHaveBeenCalled();
  });

  test('downloadModel() skips GGUF download when vLLM backend is selected', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;
    ctx.llmBackend = 'vllm';

    await downloadModel(ctx);

    expect(execStreamSpy).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('vLLM backend'));
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('Qwen/Qwen3.5-4B'));
  });

  test('downloadModel() creates HF cache directory for vLLM', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '3';
    ctx.installDir = tmpDir;
    ctx.llmBackend = 'vllm';

    await downloadModel(ctx);

    const hfCacheDir = join(tmpDir, 'data', 'hf-cache');
    expect(fs.existsSync(hfCacheDir)).toBe(true);
    expect(ui.ok).toHaveBeenCalledWith('Created HuggingFace cache directory');
  });

  test('downloadModel() skips HF cache creation if directory already exists', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;
    ctx.llmBackend = 'vllm';

    // Pre-create the cache dir
    const hfCacheDir = join(tmpDir, 'data', 'hf-cache');
    fs.mkdirSync(hfCacheDir, { recursive: true });

    await downloadModel(ctx);

    expect(ui.ok).not.toHaveBeenCalledWith('Created HuggingFace cache directory');
  });
});
