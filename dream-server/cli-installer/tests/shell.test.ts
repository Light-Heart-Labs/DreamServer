import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as shell from '../src/lib/shell.ts';

describe('shell.ts', () => {
  test('exec() executes successfully', async () => {
    const result = await shell.exec(['echo', 'hello world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
  });

  test('exec() throws ShellError on failure if throwOnError is true', async () => {
    try {
      await shell.exec(['ls', '/nonexistent_path_test_dream_server']);
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(shell.ShellError);
      expect(e.exitCode).not.toBe(0);
      expect(e.command).toBe('ls /nonexistent_path_test_dream_server');
    }
  });

  test('exec() returns exitCode on failure if throwOnError is false', async () => {
    const result = await shell.exec(['ls', '/nonexistent_path_test_dream_server'], { throwOnError: false });
    expect(result.exitCode).not.toBe(0);
  });

  test('execStream() executes successfully', async () => {
    // Save original Bun.spawn
    const originalSpawn = Bun.spawn;
    // Hide output from execStream in test, we just mock it to resolve immediately with exitCode 0
    const procSpy = spyOn(Bun, 'spawn').mockImplementation((...args) => {
      return {
        exited: Promise.resolve(0),
        kill: () => {},
      } as any;
    });

    const exitCode = await shell.execStream(['echo', 'streamed']);
    expect(exitCode).toBe(0);
    procSpy.mockRestore();
  });

  test('commandExists() returns true for existing command', async () => {
    const exists = await shell.commandExists('echo');
    expect(exists).toBe(true);
  });

  test('commandExists() returns false for nonexistent command', async () => {
    const exists = await shell.commandExists('nonexistent_command_test_dream_server');
    expect(exists).toBe(false);
  });
});
