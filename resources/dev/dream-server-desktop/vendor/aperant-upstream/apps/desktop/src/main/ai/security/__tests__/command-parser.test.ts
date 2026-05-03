/**
 * Tests for Command Parser
 *
 * Ported from: tests/test_security.py (TestCommandExtraction, TestSplitCommandSegments, TestGetCommandForValidation)
 */

import { describe, expect, it } from 'vitest';

import {
  containsWindowsPath,
  crossPlatformBasename,
  extractCommands,
  getCommandForValidation,
  splitCommandSegments,
} from '../command-parser';

// ---------------------------------------------------------------------------
// extractCommands
// ---------------------------------------------------------------------------

describe('extractCommands', () => {
  it('extracts single command correctly', () => {
    expect(extractCommands('ls -la')).toEqual(['ls']);
  });

  it('extracts command from path', () => {
    expect(extractCommands('/usr/bin/python script.py')).toEqual(['python']);
  });

  it('extracts all commands from pipeline', () => {
    expect(extractCommands('cat file.txt | grep pattern | wc -l')).toEqual([
      'cat',
      'grep',
      'wc',
    ]);
  });

  it('extracts commands from && chain', () => {
    expect(extractCommands('cd /tmp && ls && pwd')).toEqual([
      'cd',
      'ls',
      'pwd',
    ]);
  });

  it('extracts commands from || chain', () => {
    expect(extractCommands("test -f file || echo 'not found'")).toEqual([
      'test',
      'echo',
    ]);
  });

  it('extracts commands separated by semicolons', () => {
    expect(extractCommands('echo hello; echo world; ls')).toEqual([
      'echo',
      'echo',
      'ls',
    ]);
  });

  it('handles mixed operators correctly', () => {
    expect(
      extractCommands('cmd1 && cmd2 || cmd3; cmd4 | cmd5'),
    ).toEqual(['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5']);
  });

  it('does not include flags as commands', () => {
    expect(extractCommands('ls -la --color=auto')).toEqual(['ls']);
  });

  it('skips variable assignments', () => {
    expect(extractCommands('VAR=value echo $VAR')).toEqual(['echo']);
  });

  it('handles quoted arguments', () => {
    expect(
      extractCommands('echo "hello world" && grep "pattern with spaces"'),
    ).toEqual(['echo', 'grep']);
  });

  it('returns empty list for empty string', () => {
    expect(extractCommands('')).toEqual([]);
  });

  it('uses fallback parser for malformed commands (unclosed quotes)', () => {
    const commands = extractCommands("echo 'unclosed quote");
    expect(commands).toEqual(['echo']);
  });

  it('handles Windows paths with backslashes', () => {
    const commands = extractCommands('C:\\Python312\\python.exe -c "print(1)"');
    expect(commands).toContain('python');
  });

  it('handles incomplete commands with Windows paths', () => {
    const cmd = "python3 -c \"import json; json.load(open('D:\\path\\file.json'";
    const commands = extractCommands(cmd);
    expect(commands).toEqual(['python3']);
  });
});

// ---------------------------------------------------------------------------
// splitCommandSegments
// ---------------------------------------------------------------------------

describe('splitCommandSegments', () => {
  it('single command returns one segment', () => {
    expect(splitCommandSegments('ls -la')).toEqual(['ls -la']);
  });

  it('splits on &&', () => {
    expect(splitCommandSegments('cd /tmp && ls')).toEqual(['cd /tmp', 'ls']);
  });

  it('splits on ||', () => {
    expect(splitCommandSegments('test -f file || echo error')).toEqual([
      'test -f file',
      'echo error',
    ]);
  });

  it('splits on semicolons', () => {
    expect(splitCommandSegments('echo a; echo b; echo c')).toEqual([
      'echo a',
      'echo b',
      'echo c',
    ]);
  });
});

// ---------------------------------------------------------------------------
// getCommandForValidation
// ---------------------------------------------------------------------------

describe('getCommandForValidation', () => {
  it('finds the segment containing the command', () => {
    const segments = ['cd /tmp', 'rm -rf build', 'ls'];
    expect(getCommandForValidation('rm', segments)).toBe('rm -rf build');
  });

  it('returns empty string when command not found', () => {
    const segments = ['ls', 'pwd'];
    expect(getCommandForValidation('rm', segments)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// crossPlatformBasename
// ---------------------------------------------------------------------------

describe('crossPlatformBasename', () => {
  it('extracts basename from POSIX path', () => {
    expect(crossPlatformBasename('/usr/bin/python')).toBe('python');
  });

  it('extracts basename from Windows path', () => {
    expect(crossPlatformBasename('C:\\Python312\\python.exe')).toBe(
      'python.exe',
    );
  });

  it('handles simple command name', () => {
    expect(crossPlatformBasename('ls')).toBe('ls');
  });

  it('strips surrounding quotes', () => {
    expect(crossPlatformBasename("'/usr/bin/python'")).toBe('python');
  });
});

// ---------------------------------------------------------------------------
// containsWindowsPath
// ---------------------------------------------------------------------------

describe('containsWindowsPath', () => {
  it('detects drive letter paths', () => {
    expect(containsWindowsPath('C:\\Python312\\python.exe')).toBe(true);
  });

  it('returns false for POSIX paths', () => {
    expect(containsWindowsPath('/usr/bin/python')).toBe(false);
  });

  it('returns false for simple commands', () => {
    expect(containsWindowsPath('ls -la')).toBe(false);
  });
});
