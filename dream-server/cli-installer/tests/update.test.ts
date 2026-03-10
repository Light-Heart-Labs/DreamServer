import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { update } from '../src/commands/update.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('update.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-update-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      if (cmd[0] === 'git' && cmd[1] === 'pull') return { exitCode: 0, stdout: 'Already up to date.', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose commands

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
    spyOn(ui, 'phase').mockRestore();
    spyOn(console, 'log').mockRestore();
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('update() fails if no installation found', async () => {
    try {
      await update({ dir: tmpDir, skipSelfUpdate: true });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('update() performs git pull and docker compose pull then up', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    // Mock git repo existence
    fs.mkdirSync(join(tmpDir, '.git'));

    await update({ dir: tmpDir, skipSelfUpdate: true });

    // In update.ts git pull uses execStream
    expect(execStreamSpy).toHaveBeenCalled();
    const gitPullCall = execStreamSpy.mock.calls.find(c => c[0][0] === 'git' && c[0][1] === 'pull');
    expect(gitPullCall).toBeDefined();

    // Should perform docker compose pull, build, and up
    expect(execStreamSpy).toHaveBeenCalledTimes(4); // git pull, docker pull, build, up
    const dockerPullCall = execStreamSpy.mock.calls.find(c => c[0].includes('pull') && c[0][0] === 'docker');
    expect(dockerPullCall).toBeDefined();

    expect(ui.ok).toHaveBeenCalledWith('Update complete');
  });

  test('update() handles git pull error gracefully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    fs.mkdirSync(join(tmpDir, '.git'));

    execStreamSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'git' && cmd[1] === 'pull') return 1; // Error
      return 0;
    });

    await update({ dir: tmpDir, skipSelfUpdate: true });

    expect(ui.warn).toHaveBeenCalledWith('git pull failed — may have local changes');
  });
});
