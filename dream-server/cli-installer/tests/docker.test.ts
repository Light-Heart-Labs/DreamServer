import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as docker from '../src/lib/docker.ts';
import * as shell from '../src/lib/shell.ts';
import { IS_WINDOWS } from '../src/lib/platform.ts';

describe('docker.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    execSpy = spyOn(shell, 'exec');
    docker.resetCache();
  });

  afterEach(() => {
    execSpy.mockRestore();
    docker.resetCache();
  });

  test('getComposeCommand() returns ["docker", "compose"] when docker compose is available', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['docker', 'compose']);
  });

  test('getComposeCommand() falls back to sudo docker compose when user lacks permissions', async () => {
    if (IS_WINDOWS) {
      // On Windows, sudo is never attempted — Docker Desktop doesn't need it
      execSpy.mockImplementation(async (cmd) => {
        if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
          return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
        }
        if (cmd[0] === 'docker' && cmd[1] === 'info') {
          return { exitCode: 1, stdout: '', stderr: 'permission denied' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });
      try {
        await docker.getComposeCommand();
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.message).toContain('Cannot connect to Docker daemon');
      }
      return;
    }
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info' && cmd[2] !== '-n') {
        return { exitCode: 1, stdout: '', stderr: 'permission denied' };
      }
      if (cmd[0] === 'sudo' && cmd[1] === '-n' && cmd[2] === 'docker') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['sudo', 'docker', 'compose']);
  });

  test('getComposeCommand() falls back to docker-compose standalone', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker-compose' && cmd[1] === 'version') {
        return { exitCode: 0, stdout: 'docker-compose version 1.29.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['docker-compose']);
  });

  test('getComposeCommand() throws when docker is not available', async () => {
    execSpy.mockImplementation(async () => {
      return { exitCode: 1, stdout: '', stderr: 'command not found' };
    });

    try {
      await docker.getComposeCommand();
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('Cannot connect to Docker daemon');
    }
  });

  test('getComposeCommand() caches result', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result1 = await docker.getComposeCommand();
    const result2 = await docker.getComposeCommand();
    
    expect(result1).toEqual(['docker', 'compose']);
    expect(result2).toEqual(['docker', 'compose']);
    expect(execSpy).toHaveBeenCalledTimes(2);
  });
});
