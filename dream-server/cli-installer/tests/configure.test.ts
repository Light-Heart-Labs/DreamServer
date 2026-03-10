import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { configure } from '../src/phases/configure.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('configure.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-configure-'));

    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui.Spinner.prototype, 'start').mockImplementation(() => ui.Spinner.prototype);
    spyOn(ui.Spinner.prototype, 'succeed').mockImplementation(() => {});
    spyOn(ui.Spinner.prototype, 'fail').mockImplementation(() => {});

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd, opts) => {
      // Mock git clone
      if (cmd[0] === 'git' && cmd[1] === 'clone') {
        const targetDir = join(cmd[5], 'dream-server');
        fs.mkdirSync(targetDir, { recursive: true });
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    execSpy.mockRestore();
  });

  test('configure() performs git pull if .env exists', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;

    // Simulate existing installation
    fs.writeFileSync(join(tmpDir, '.env'), 'MOCK_ENV=true');

    await configure(ctx);

    expect(execSpy).toHaveBeenCalled();
    const args = execSpy.mock.calls.map(c => c[0][1]); // check git subcommands
    expect(args).toContain('pull'); // git pull
  });

  test('configure() clones repo if .env does not exist', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;

    await configure(ctx);

    expect(execSpy).toHaveBeenCalled();
    const args = execSpy.mock.calls.map(c => c[0][1]);
    expect(args).toContain('clone'); // git clone

    // Check if .env was generated
    expect(fs.existsSync(join(tmpDir, '.env'))).toBe(true);
  });

  test('configure() skips clone and generate if dryRun', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.dryRun = true;

    await configure(ctx);

    expect(execSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(join(tmpDir, '.env'))).toBe(false);
  });

  test('configure() generates .env file correctly', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1'; // To test correct model injection
    ctx.gpu.backend = 'nvidia';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('GPU_BACKEND=nvidia');
    expect(envContent).toContain('LLM_MODEL=qwen3-8b');
    expect(envContent).toContain('WEBUI_PORT=3000');
  });
});
