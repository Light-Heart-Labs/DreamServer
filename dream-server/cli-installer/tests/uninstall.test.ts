import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { uninstall } from '../src/commands/uninstall.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('uninstall.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;
  let confirmSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-uninstall-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    confirmSpy = spyOn(prompts, 'confirm').mockImplementation(async () => true);

    execSpy = spyOn(shell, 'exec').mockImplementation(async () => {
      return { exitCode: 0, stdout: 'image1\nimage2', stderr: '' };
    });
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0);

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
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
    processExitSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  test('uninstall() fails if no installation found', async () => {
    try {
      await uninstall({ dir: tmpDir, force: true });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('uninstall() exits if user aborts', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    confirmSpy.mockImplementation(async () => false);

    await uninstall({ dir: tmpDir });
    expect(ui.info).toHaveBeenCalledWith('Uninstall cancelled.');
  });

  test('uninstall() removes containers and directories when forced and not keepData', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');

    await uninstall({ dir: tmpDir, force: true });

    // Verify down command (it uses exec, not execStream)
    expect(execSpy).toHaveBeenCalled();
    const dockerDownCall = execSpy.mock.calls.find(c => c[0].includes('down'));
    expect(dockerDownCall).toBeDefined();

    // Verify directory removal
    const rmCall = execSpy.mock.calls.find(c => c[0][0] === 'rm' && c[0][1] === '-rf' && c[0][2] === tmpDir);
    expect(rmCall).toBeDefined();

    expect(ui.ok).toHaveBeenCalledWith('Dream Server has been uninstalled');
  });

  test('uninstall() respects keepData and does not remove installation dir', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');

    await uninstall({ dir: tmpDir, force: true, keepData: true });

    const rmCall = execSpy.mock.calls.find(c => c[0][0] === 'rm' && c[0][1] === '-rf' && c[0][2] === tmpDir);
    expect(rmCall).toBeUndefined(); // Should not have removed directory

    expect(ui.info).toHaveBeenCalledWith('Keeping data directory (--keep-data specified)');
  });
});
