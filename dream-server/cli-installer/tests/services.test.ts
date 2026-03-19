import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { services } from '../src/phases/services.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';

describe('services.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'table').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      // Mock docker compose commands from within `services.ts` that aren't using `docker.ts` directly
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "running", "Status": "Up 2 minutes"}]', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose up -d


  });

  afterEach(() => {
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'table').mockRestore();
    spyOn(console, 'log').mockRestore();

    getComposeCommandSpy.mockRestore();
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
  });

  test('services() performs docker compose up', async () => {
    const ctx = createDefaultContext();
    const exitCode = await services(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args).toEqual(['docker', 'compose', 'up', '-d', '--remove-orphans']);
    expect(exitCode).toBe(0);
  });

  test('services() handles non-zero exit code gracefully', async () => {
    const ctx = createDefaultContext();
    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    execSpy.mockImplementation(async (cmd) => {
      // Mock internal `getComposeCommand` calls inside `services.ts`
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'docker' && cmd[1] === 'info') return { exitCode: 0, stdout: '', stderr: '' };
      // Mock ps --format json
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "exited", "Status": "Exited (1)"}]', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const exitCode = await services(ctx);

    expect(exitCode).toBe(1);
    expect(ui.warn).toHaveBeenCalledWith('docker compose up exited with errors');
    expect(ui.fail).toHaveBeenCalledWith('webui (Exited (1))'); // dream- prefix gets stripped
  });

  test('services() gracefully handles JSON parse error in container status', async () => {
    const ctx = createDefaultContext();
    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'docker' && cmd[1] === 'info') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        // Return an unparseable malformed JSON to trigger the fallback block inside catch
        return { exitCode: 0, stdout: 'NOT JSON', stderr: '' };
      }
      // Fallback
      if (cmd[2] === 'ps' && !cmd[3]) {
        return { exitCode: 0, stdout: 'fallback ps output', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await services(ctx);

    // One of the calls to console.log should be 'fallback ps output'
    let found = false;
    // @ts-ignore
    for (const call of console.log.mock.calls) {
      if (call[0] === 'fallback ps output') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('services() dryRun skips execStream', async () => {
    const ctx = createDefaultContext();
    ctx.dryRun = true;

    const exitCode = await services(ctx);

    expect(exitCode).toBe(0);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });
});
