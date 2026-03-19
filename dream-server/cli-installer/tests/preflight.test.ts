import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { preflight } from '../src/phases/preflight.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import { getOsName, IS_WINDOWS } from '../src/lib/platform.ts';

describe('preflight.ts', () => {
  let commandExistsSpy: ReturnType<typeof spyOn>;
  let execSpy: ReturnType<typeof spyOn>;
  let getuidSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});

    commandExistsSpy = spyOn(shell, 'commandExists').mockImplementation(async (cmd) => {
      if (cmd === 'git') return true;
      if (cmd === 'curl') return true;
      if (cmd === 'nvidia-smi') return false;
      if (cmd === 'tailscale') return false;
      return false;
    });

    execSpy = spyOn(shell, 'exec').mockImplementation(async (args) => {
      // Mock docker compose version
      if (args[0] === 'docker' && args[1] === 'compose') return { exitCode: 0, stdout: 'v2.0.0', stderr: '' };
      // Mock docker info
      if (args[0] === 'docker' && args[1] === 'info') return { exitCode: 0, stdout: 'Running', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: 'error' };
    });

    // process.getuid() is undefined on Windows — only spy when available
    if (!IS_WINDOWS && process.getuid) {
      getuidSpy = spyOn(process, 'getuid').mockImplementation(() => 1000); // Non-root
    }
    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    commandExistsSpy.mockRestore();
    execSpy.mockRestore();
    if (getuidSpy) getuidSpy.mockRestore();
    processExitSpy.mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
  });

  test('preflight() detects system correctly', async () => {
    const ctx = createDefaultContext();
    const result = await preflight(ctx);

    expect(result.os).toBe(getOsName());
    expect(result.arch).toBe(process.arch);
    expect(result.hasDocker).toBe(true);
    expect(result.hasDockerCompose).toBe(true);
    expect(result.hasGit).toBe(true);
    expect(result.hasCurl).toBe(true);
    expect(result.hasNvidiaSmi).toBe(false);
  });

  // Root check only applies on Linux/macOS (Windows has no getuid)
  test('preflight() exits if run as root', async () => {
    if (IS_WINDOWS) {
      // On Windows, the root check is skipped entirely, so this test doesn't apply
      expect(true).toBe(true);
      return;
    }
    getuidSpy.mockImplementation(() => 0); // Root
    const ctx = createDefaultContext();

    try {
      await preflight(ctx);
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
    }
  });

});
