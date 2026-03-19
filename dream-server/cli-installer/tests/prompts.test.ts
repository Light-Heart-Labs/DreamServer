import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as prompts from '../src/lib/prompts.ts';
import * as readline from 'node:readline';

describe('prompts.ts', () => {
  let rlSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    rlSpy = spyOn(readline, 'createInterface').mockImplementation(() => {
      return {
        question: (query: string, callback: (ans: string) => void) => {
          // Provide default behaviors for our tests by looking at the query string
          if (query.includes('yes/no')) setImmediate(() => callback('y'));
          else if (query.includes('default no')) setImmediate(() => callback(''));
          else if (query.includes('Select')) setImmediate(() => callback('2'));
          else if (query.includes('Input')) setImmediate(() => callback('test input'));
          else setImmediate(() => callback('default_mock'));
        },
        close: () => {},
      } as any;
    });
    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rlSpy.mockRestore();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('confirm() returns true on "y"', async () => {
    const res = await prompts.confirm('yes/no');
    expect(res).toBe(true);
  });

  test('confirm() returns default value on empty string', async () => {
    const res = await prompts.confirm('default no', false);
    expect(res).toBe(false);
  });

  test('select() returns correct index based on 1-based user input', async () => {
    const res = await prompts.select('Select option', [
      { label: 'Option 1' },
      { label: 'Option 2' },
      { label: 'Option 3' },
    ]);
    expect(res).toBe(1); // '2' -> 1
  });

  test('input() returns user input string', async () => {
    const res = await prompts.input('Input something');
    expect(res).toBe('test input');
  });

  test('multiSelect() handles non-TTY environments gracefully', async () => {
    // Explicitly force non-TTY so multiSelect() hits the early-return path
    // (Bun's test runner may provide a TTY-like stdin that would hang)
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const res = await prompts.multiSelect('Select features', [
        { label: 'Feat1', checked: true },
        { label: 'Feat2', checked: false }
      ]);
      expect(res).toEqual([true, false]);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });
});
