import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { install } from '../src/commands/install.ts';
import * as preflightPhase from '../src/phases/preflight.ts';
import * as detectionPhase from '../src/phases/detection.ts';
import * as featuresPhase from '../src/phases/features.ts';
import * as configurePhase from '../src/phases/configure.ts';
import * as modelPhase from '../src/phases/model.ts';
import * as servicesPhase from '../src/phases/services.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';

describe('install.ts', () => {
  let preflightSpy: ReturnType<typeof spyOn>;
  let detectSpy: ReturnType<typeof spyOn>;
  let featuresSpy: ReturnType<typeof spyOn>;
  let configureSpy: ReturnType<typeof spyOn>;
  let modelSpy: ReturnType<typeof spyOn>;
  let servicesSpy: ReturnType<typeof spyOn>;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'banner').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    preflightSpy = spyOn(preflightPhase, 'preflight').mockImplementation(async () => ({ tailscaleIp: null } as any));
    detectSpy = spyOn(detectionPhase, 'detect').mockImplementation(async () => ({}));
    featuresSpy = spyOn(featuresPhase, 'features').mockImplementation(async () => ({}));
    configureSpy = spyOn(configurePhase, 'configure').mockImplementation(async () => {});
    modelSpy = spyOn(modelPhase, 'downloadModel').mockImplementation(async () => {});
    servicesSpy = spyOn(servicesPhase, 'services').mockImplementation(async () => {});

    existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(() => false);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(() => '');

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    spyOn(ui, 'banner').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(console, 'log').mockRestore();
    preflightSpy.mockRestore();
    detectSpy.mockRestore();
    featuresSpy.mockRestore();
    configureSpy.mockRestore();
    modelSpy.mockRestore();
    servicesSpy.mockRestore();
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('install() runs all phases successfully for new installation', async () => {
    await install({ nonInteractive: true, all: true });

    expect(preflightSpy).toHaveBeenCalled();
    expect(detectSpy).toHaveBeenCalled();
    expect(featuresSpy).not.toHaveBeenCalled(); // Skipped because --all is provided
    expect(configureSpy).toHaveBeenCalled();
    expect(modelSpy).toHaveBeenCalled();
    expect(servicesSpy).toHaveBeenCalled();
  });

  test('install() respects resume functionality', async () => {
    existsSyncSpy.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('.env')) return true;
      return false;
    });
    readFileSyncSpy.mockImplementation(() => 'ENABLE_VOICE=true\nENABLE_WORKFLOWS=false');

    await install({ nonInteractive: true });

    expect(preflightSpy).toHaveBeenCalled();
    expect(detectSpy).toHaveBeenCalled();
    expect(featuresSpy).not.toHaveBeenCalled(); // Uses existing .env values
    expect(configureSpy).toHaveBeenCalled();
    expect(modelSpy).toHaveBeenCalled();
    expect(servicesSpy).toHaveBeenCalled();
  });

  test('install() catches and handles errors during phases', async () => {
    preflightSpy.mockImplementation(async () => {
      throw new Error('Preflight mock failure');
    });

    try {
      await install({});
      expect(true).toBe(false); // Should not reach
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith(expect.stringContaining('Preflight mock failure'));
    }
  });

  test('install() calls features selection if not all and not resuming', async () => {
    await install({});

    expect(featuresSpy).toHaveBeenCalled();
    expect(configureSpy).toHaveBeenCalled();
  });
});
