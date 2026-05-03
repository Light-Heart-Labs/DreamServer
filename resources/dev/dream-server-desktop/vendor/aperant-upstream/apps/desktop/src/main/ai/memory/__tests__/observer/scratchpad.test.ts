/**
 * Scratchpad Tests
 *
 * Tests analytics updates, config file detection, and error fingerprinting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Scratchpad, isConfigFile, computeErrorFingerprint } from '../../observer/scratchpad';

describe('isConfigFile', () => {
  it('detects package.json', () => {
    expect(isConfigFile('/project/package.json')).toBe(true);
  });

  it('detects tsconfig files', () => {
    expect(isConfigFile('/project/tsconfig.json')).toBe(true);
    expect(isConfigFile('/project/tsconfig.base.json')).toBe(true);
  });

  it('detects vite config', () => {
    expect(isConfigFile('/project/vite.config.ts')).toBe(true);
  });

  it('detects .env files', () => {
    expect(isConfigFile('/project/.env')).toBe(true);
    expect(isConfigFile('/project/.env.local')).toBe(true);
  });

  it('detects biome.json', () => {
    expect(isConfigFile('/project/biome.json')).toBe(true);
  });

  it('detects tailwind.config', () => {
    expect(isConfigFile('/project/tailwind.config.ts')).toBe(true);
  });

  it('does not flag regular source files', () => {
    expect(isConfigFile('/project/src/auth.ts')).toBe(false);
    expect(isConfigFile('/project/src/components/Button.tsx')).toBe(false);
    expect(isConfigFile('/project/README.md')).toBe(false);
  });
});

describe('computeErrorFingerprint', () => {
  it('returns consistent fingerprint for same error', () => {
    const error = 'Error: Cannot find module "./auth" in /home/user/project/src/main.ts:42';
    const fp1 = computeErrorFingerprint(error);
    const fp2 = computeErrorFingerprint(error);
    expect(fp1).toBe(fp2);
  });

  it('returns same fingerprint for same error with different paths', () => {
    const error1 = 'Error: Cannot find module "./auth" in /home/alice/project/src/main.ts:42';
    const error2 = 'Error: Cannot find module "./auth" in /home/bob/other-project/src/main.ts:99';
    // After normalization, paths and line numbers are stripped
    const fp1 = computeErrorFingerprint(error1);
    const fp2 = computeErrorFingerprint(error2);
    expect(fp1).toBe(fp2);
  });

  it('returns different fingerprints for different errors', () => {
    const error1 = 'TypeError: undefined is not a function';
    const error2 = 'SyntaxError: Unexpected token }';
    expect(computeErrorFingerprint(error1)).not.toBe(computeErrorFingerprint(error2));
  });

  it('returns a 16-char hex string', () => {
    const fp = computeErrorFingerprint('Some error occurred');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces the same fingerprint for semantically identical errors', () => {
    // Two identical errors should produce identical fingerprints
    const error = 'TypeError: Cannot read property length of undefined';
    expect(computeErrorFingerprint(error)).toBe(computeErrorFingerprint(error));
  });
});

describe('Scratchpad', () => {
  let scratchpad: Scratchpad;

  beforeEach(() => {
    scratchpad = new Scratchpad('session-001', 'build');
  });

  describe('recordToolCall', () => {
    it('tracks file access counts', () => {
      scratchpad.recordToolCall('Read', { file_path: '/src/auth.ts' }, 1);
      scratchpad.recordToolCall('Read', { file_path: '/src/auth.ts' }, 2);
      expect(scratchpad.analytics.fileAccessCounts.get('/src/auth.ts')).toBe(2);
    });

    it('records first and last access step', () => {
      scratchpad.recordToolCall('Read', { file_path: '/src/main.ts' }, 3);
      scratchpad.recordToolCall('Read', { file_path: '/src/main.ts' }, 7);
      expect(scratchpad.analytics.fileFirstAccess.get('/src/main.ts')).toBe(3);
      expect(scratchpad.analytics.fileLastAccess.get('/src/main.ts')).toBe(7);
    });

    it('tracks grep patterns', () => {
      scratchpad.recordToolCall('Grep', { pattern: 'useEffect', path: '/src' }, 1);
      scratchpad.recordToolCall('Grep', { pattern: 'useEffect', path: '/src' }, 3);
      expect(scratchpad.analytics.grepPatternCounts.get('useEffect')).toBe(2);
    });

    it('flags config files when accessed', () => {
      scratchpad.recordToolCall('Read', { file_path: '/package.json' }, 2);
      expect(scratchpad.analytics.configFilesTouched.has('/package.json')).toBe(true);
    });

    it('maintains circular buffer of last 8 tool calls', () => {
      const tools = ['Read', 'Grep', 'Edit', 'Bash', 'Read', 'Glob', 'Read', 'Write', 'Read'];
      tools.forEach((tool, i) => {
        scratchpad.recordToolCall(tool, {}, i + 1);
      });
      // Should only keep last 8
      expect(scratchpad.analytics.recentToolSequence).toHaveLength(8);
      // Last 8 of the sequence
      expect(scratchpad.analytics.recentToolSequence[7]).toBe('Read');
    });

    it('detects co-access within 5-step window', () => {
      scratchpad.recordToolCall('Read', { file_path: '/src/a.ts' }, 1);
      scratchpad.recordToolCall('Read', { file_path: '/src/b.ts' }, 3); // within 5 steps of a.ts
      // b.ts should be co-accessed with a.ts
      const coAccessed = scratchpad.analytics.intraSessionCoAccess.get('/src/b.ts');
      expect(coAccessed?.has('/src/a.ts')).toBe(true);
    });

    it('does not flag co-access outside 5-step window', () => {
      scratchpad.recordToolCall('Read', { file_path: '/src/a.ts' }, 1);
      scratchpad.recordToolCall('Read', { file_path: '/src/c.ts' }, 10); // outside 5-step window
      const coAccessed = scratchpad.analytics.intraSessionCoAccess.get('/src/c.ts');
      expect(coAccessed?.has('/src/a.ts') ?? false).toBe(false);
    });
  });

  describe('recordFileEdit', () => {
    it('adds to fileEditSet', () => {
      scratchpad.recordFileEdit('/src/routes.ts');
      expect(scratchpad.analytics.fileEditSet.has('/src/routes.ts')).toBe(true);
    });

    it('adds config files to configFilesTouched', () => {
      scratchpad.recordFileEdit('/tsconfig.json');
      expect(scratchpad.analytics.configFilesTouched.has('/tsconfig.json')).toBe(true);
    });
  });

  describe('recordSelfCorrection', () => {
    it('increments self-correction count', () => {
      scratchpad.recordSelfCorrection(5);
      scratchpad.recordSelfCorrection(10);
      expect(scratchpad.analytics.selfCorrectionCount).toBe(2);
      expect(scratchpad.analytics.lastSelfCorrectionStep).toBe(10);
    });
  });

  describe('recordTokenUsage', () => {
    it('accumulates total tokens', () => {
      scratchpad.recordTokenUsage(1000);
      scratchpad.recordTokenUsage(2000);
      expect(scratchpad.analytics.totalInputTokens).toBe(3000);
    });

    it('tracks peak context tokens', () => {
      scratchpad.recordTokenUsage(1000);
      scratchpad.recordTokenUsage(5000);
      scratchpad.recordTokenUsage(2000);
      expect(scratchpad.analytics.peakContextTokens).toBe(5000);
    });
  });

  describe('addSignal', () => {
    it('stores signals by type', () => {
      const signal = {
        type: 'file_access' as const,
        stepNumber: 1,
        capturedAt: Date.now(),
        filePath: '/src/auth.ts',
        toolName: 'Read' as const,
        accessType: 'read' as const,
      };
      scratchpad.addSignal(signal);
      expect(scratchpad.signals.get('file_access')).toHaveLength(1);
    });

    it('accumulates multiple signals of the same type', () => {
      for (let i = 0; i < 5; i++) {
        scratchpad.addSignal({
          type: 'file_access' as const,
          stepNumber: i,
          capturedAt: Date.now(),
          filePath: `/src/file${i}.ts`,
          toolName: 'Read' as const,
          accessType: 'read' as const,
        });
      }
      expect(scratchpad.signals.get('file_access')).toHaveLength(5);
    });
  });

  describe('getNewSince', () => {
    it('returns acute candidates after the given step', () => {
      scratchpad.acuteCandidates.push(
        { signalType: 'self_correction', rawData: {}, priority: 0.9, capturedAt: Date.now(), stepNumber: 3 },
        { signalType: 'backtrack', rawData: {}, priority: 0.7, capturedAt: Date.now(), stepNumber: 7 },
        { signalType: 'self_correction', rawData: {}, priority: 0.9, capturedAt: Date.now(), stepNumber: 10 },
      );

      const newSince5 = scratchpad.getNewSince(5);
      expect(newSince5).toHaveLength(2);
      expect(newSince5[0].stepNumber).toBe(7);
      expect(newSince5[1].stepNumber).toBe(10);
    });
  });
});
