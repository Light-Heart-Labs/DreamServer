import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { config } from '../src/commands/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as docker from '../src/lib/docker.ts';
import * as modelPhase from '../src/phases/model.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config.ts', () => {
  let tmpDir: string;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let selectSpy: ReturnType<typeof spyOn>;
  let multiSelectSpy: ReturnType<typeof spyOn>;
  let modelSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-config-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose up -d

    selectSpy = spyOn(prompts, 'select').mockImplementation(async () => 0); // default to Features
    multiSelectSpy = spyOn(prompts, 'multiSelect').mockImplementation(async () => [true, true, true, false]);

    modelSpy = spyOn(modelPhase, 'downloadModel').mockImplementation(async () => {});

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(console, 'log').mockRestore();
    getComposeCommandSpy.mockRestore();
    execStreamSpy.mockRestore();
    selectSpy.mockRestore();
    multiSelectSpy.mockRestore();
    modelSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('config() fails if no installation found', async () => {
    try {
      await config({ dir: tmpDir });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('config() updates features and restarts services', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=false\nENABLE_WORKFLOWS=false');

    // Choose features, and then choose true, true, true, false for the multi-select
    selectSpy.mockImplementation(async () => 0); // Features
    multiSelectSpy.mockImplementation(async () => [true, true, true, false]);

    await config({ dir: tmpDir, features: true });

    const newEnv = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(newEnv).toContain('ENABLE_VOICE=true');
    expect(newEnv).toContain('ENABLE_WORKFLOWS=true');
    expect(newEnv).toContain('ENABLE_RAG=true');

    expect(ui.ok).toHaveBeenCalledWith('Updated .env');
    expect(execStreamSpy).toHaveBeenCalled(); // docker compose up -d
  });

  test('config() updates tier/model and downloads new model if needed', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=qwen3-8b\nGGUF_FILE=Qwen3-8B-Q4_K_M.gguf\nCTX_SIZE=16384\nMAX_CONTEXT=16384');

    selectSpy.mockImplementation(async () => 2); // Choose Tier 3 from TIER_MAP

    await config({ dir: tmpDir, tier: true });

    const newEnv = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(newEnv).toContain('LLM_MODEL=qwen3-14b'); // Tier 3 model
    expect(modelSpy).toHaveBeenCalled(); // Should trigger model download
  });

  test('config() handles no changes correctly', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true\nENABLE_WORKFLOWS=true\nENABLE_RAG=true\nENABLE_OPENCLAW=false');

    multiSelectSpy.mockImplementation(async () => [true, true, true, false]); // Same as current

    await config({ dir: tmpDir, features: true });

    expect(ui.info).toHaveBeenCalledWith('No changes made');
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

});
