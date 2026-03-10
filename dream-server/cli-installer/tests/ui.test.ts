import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as ui from '../src/lib/ui.ts';

describe('ui.ts', () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('ok() outputs green checkmark', () => {
    ui.ok('success');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  test('warn() outputs yellow warning', () => {
    ui.warn('warning');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('⚠'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('warning'));
  });

  test('fail() outputs red cross', () => {
    ui.fail('error');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  test('info() outputs blue arrow', () => {
    ui.info('info');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('→'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('info'));
  });

  test('step() outputs cyan triangle', () => {
    ui.step('step');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('▸'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('step'));
  });

  test('header() outputs title with borders', () => {
    ui.header('Test Title');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Title'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('─'.repeat(60)));
  });

  test('phase() outputs phase information', () => {
    ui.phase(1, 6, 'Preflight', '~5s');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[1/6]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Preflight'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('~5s'));
  });

  test('banner() outputs application banner', () => {
    ui.banner('1.0.0');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dream Server'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('v1.0.0'));
  });

  test('table() outputs aligned table data', () => {
    ui.table([['Dashboard', 'http://localhost:3001'], ['Chat', 'http://localhost:3000']]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dashboard'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('http://localhost:3001'));
  });

  test('box() outputs bordered box', () => {
    ui.box('Test Box', [['Key', 'Value']]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('┌'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Box'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Key'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Value'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('└'));
  });

  test('Spinner succeed() does not throw', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.succeed('Done!')).not.toThrow();
  });

  test('Spinner fail() does not throw', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.fail('Failed!')).not.toThrow();
  });

  test('Spinner start() and stop() work correctly', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.start()).not.toThrow();
    expect(() => spinner.succeed('Done!')).not.toThrow();
  });
});
