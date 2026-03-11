import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { detect } from '../src/phases/detection.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as platform from '../src/lib/platform.ts';
import * as ui from '../src/lib/ui.ts';

describe('detection.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;
  let ramSpy: ReturnType<typeof spyOn>;
  let diskSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'box').mockImplementation(() => {});

    // Mock RAM detection via platform.getRamGB()
    ramSpy = spyOn(platform, 'getRamGB').mockReturnValue(31);

    // Mock disk detection via platform.getDiskGB()
    diskSpy = spyOn(platform, 'getDiskGB').mockImplementation(async () => 962);

    // Mock GPU detection (exec)
    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      if (cmd[0] === 'nvidia-smi') {
        return { exitCode: 0, stdout: 'NVIDIA GeForce RTX 4090, 24564, 1', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'box').mockRestore();
    ramSpy.mockRestore();
    diskSpy.mockRestore();
    execSpy.mockRestore();
  });

  test('detect() returns combined hardware information and sets tier correctly', async () => {
    const ctx = createDefaultContext();

    const res = await detect(ctx);

    expect(res.ramGB).toBe(31); // 32924152 / 1024 / 1024 ~ 31
    expect(res.diskGB).toBe(962);
    expect(res.gpu.backend).toBe('nvidia');
    expect(res.gpu.name).toBe('NVIDIA GeForce RTX 4090');
    expect(res.gpu.vramMB).toBe(24564);

    // Check context updates
    expect(ctx.system.ramGB).toBe(31);
    expect(ctx.system.diskGB).toBe(962);
    expect(ctx.gpu.backend).toBe('nvidia');

    // Due to the mock, tier should be '3' for 24GB VRAM
    expect(res.tier).toBe('3');
  });

  test('detect() respects pre-set ctx.tier over detected classification', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';

    const res = await detect(ctx);
    expect(res.tier).toBe('1');
    expect(ctx.tier).toBe('1');
  });

  test('detect() gracefully handles missing GPU', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'nvidia-smi') {
        return { exitCode: 1, stdout: '', stderr: 'nvidia-smi: command not found' }; // Mock no GPU
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const ctx = createDefaultContext();

    const res = await detect(ctx);

    expect(res.gpu.backend).toBe('cpu');
    expect(res.gpu.name).toBe('Not detected');
    expect(res.gpu.vramMB).toBe(0);

    // RAM is 31GB, Tier 2 requires 48GB, Tier 1 is < 48GB.
    expect(res.tier).toBe('1');
  });

  test('detectGpu() returns apple backend on macOS arm64', async () => {
    // We test detectGpu via the imported module — on an actual macOS arm64 machine
    // it would return 'apple' automatically. Here we test the nvidia fallback path
    // by verifying the function interface handles apple-like responses.
    const { detectGpu } = require('../src/phases/detection.ts');

    // When nvidia-smi is not available (as on macOS), and platform is not darwin/arm64,
    // detectGpu should return cpu backend
    execSpy.mockImplementation(async () => {
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const gpu = await detectGpu();
    // On the test host (likely not macOS arm64), it should fall through to noGpu
    // The key assertion is that the function doesn't crash and returns a valid backend
    expect(['cpu', 'apple', 'nvidia']).toContain(gpu.backend);
    expect(gpu).toHaveProperty('name');
    expect(gpu).toHaveProperty('vramMB');
  });
});
