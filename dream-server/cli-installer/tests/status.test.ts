import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { status } from '../src/commands/status.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('status.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-status-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'table').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      // GPU check
      if (cmd[0] === 'nvidia-smi' && cmd[1].includes('memory.free')) {
        return { exitCode: 0, stdout: 'RTX 4090, 24564, 10000, 14564', stderr: '' };
      }
      if (cmd[0] === 'nvidia-smi' && cmd[1].includes('used_gpu_memory')) {
        return { exitCode: 0, stdout: '1234, python, 4000', stderr: '' };
      }
      // Docker PS
      if (cmd[0] === 'docker' && cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "running", "Status": "Up"}]', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'ps' && cmd[2] === '--format') {
        return { exitCode: 0, stdout: 'container123 dream-webui', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'top') {
        return { exitCode: 0, stdout: 'PID\n1234\n', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return { ok: true, status: 200 } as any;
    });

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'table').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(console, 'log').mockRestore();
    execSpy.mockRestore();
    fetchSpy.mockRestore();
    processExitSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
  });

  test('status() fails if no installation found', async () => {
    try {
      await status({ dir: tmpDir });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('status() displays system state successfully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model\nGPU_BACKEND=nvidia\nENABLE_VOICE=true');

    await status({ dir: tmpDir });

    expect(ui.table).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('✓ Voice'));
    expect(ui.ok).toHaveBeenCalledWith(expect.stringContaining('Running (1): webui'));

    // Check health checks passed
    expect(ui.ok).toHaveBeenCalledWith('Chat (WebUI)');
  });

  test('status() displays failing services with logs diagnosis', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model\nGPU_BACKEND=nvidia\nENABLE_VOICE=true');

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-llama-server", "State": "exited", "Status": "Exited (1)"}]', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'logs') {
        return { exitCode: 0, stdout: '', stderr: 'CUDA out of memory' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await status({ dir: tmpDir });

    expect(ui.warn).toHaveBeenCalledWith('llama-server (Exited (1))');
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('CUDA out of memory'));
  });

  test('status() gracefully handles offline health checks', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model');

    fetchSpy.mockImplementation(async () => {
      throw new Error('fetch error');
    });

    await status({ dir: tmpDir });

    expect(ui.fail).toHaveBeenCalledWith(expect.stringContaining('Chat (WebUI) — not responding'));
  });

  test('status() handles no containers running gracefully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model');

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[2] === 'ps') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await status({ dir: tmpDir });

    expect(ui.warn).toHaveBeenCalledWith('No containers running');
  });

});
