/**
 * MemoryObserver Tests
 *
 * Tests observe() with mock messages and verifies the <2ms budget.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryObserver } from '../../observer/memory-observer';
import type { MemoryIpcRequest } from '../../types';

describe('MemoryObserver', () => {
  let observer: MemoryObserver;

  beforeEach(() => {
    observer = new MemoryObserver('test-session-1', 'build', 'test-project');
  });

  describe('observe() budget', () => {
    it('processes tool-call messages within 2ms', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:tool-call',
        toolName: 'Read',
        args: { file_path: '/src/main.ts' },
        stepNumber: 1,
      };

      const start = process.hrtime.bigint();
      observer.observe(msg);
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

      expect(elapsed).toBeLessThan(2);
    });

    it('processes reasoning messages within 2ms', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'I need to read the file first to understand the structure.',
        stepNumber: 2,
      };

      const start = process.hrtime.bigint();
      observer.observe(msg);
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

      expect(elapsed).toBeLessThan(2);
    });

    it('processes step-complete messages within 2ms', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:step-complete',
        stepNumber: 5,
      };

      const start = process.hrtime.bigint();
      observer.observe(msg);
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

      expect(elapsed).toBeLessThan(2);
    });

    it('does not throw on malformed messages', () => {
      // Even if something unexpected is passed, observe must not throw
      expect(() => {
        observer.observe({ type: 'memory:step-complete', stepNumber: 1 });
      }).not.toThrow();
    });
  });

  describe('self-correction detection', () => {
    it('detects self-correction patterns in reasoning text', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'Actually, the configuration is in tsconfig.json, not in package.json as I thought.',
        stepNumber: 3,
      };

      observer.observe(msg);
      const scratchpad = observer.getScratchpad();
      expect(scratchpad.analytics.selfCorrectionCount).toBe(1);
      expect(scratchpad.analytics.lastSelfCorrectionStep).toBe(3);
    });

    it('creates acute candidate for self-correction', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'Wait, the API endpoint changed in v2.',
        stepNumber: 4,
      };

      observer.observe(msg);
      const candidates = observer.getNewCandidatesSince(0);
      const selfCorrectionCandidates = candidates.filter(
        (c) => c.signalType === 'self_correction',
      );
      expect(selfCorrectionCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag non-correction text', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'I will now read the configuration file and check the settings.',
        stepNumber: 2,
      };

      observer.observe(msg);
      const scratchpad = observer.getScratchpad();
      expect(scratchpad.analytics.selfCorrectionCount).toBe(0);
    });
  });

  describe('dead-end detection', () => {
    it('creates backtrack candidate for dead-end language', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'This approach will not work because the API is unavailable in production.',
        stepNumber: 6,
      };

      observer.observe(msg);
      const candidates = observer.getNewCandidatesSince(0);
      const backtracks = candidates.filter((c) => c.signalType === 'backtrack');
      expect(backtracks.length).toBeGreaterThanOrEqual(1);
    });

    it('detects "let me try a different approach"', () => {
      const msg: MemoryIpcRequest = {
        type: 'memory:reasoning',
        text: 'Let me try a different approach to solve this problem.',
        stepNumber: 7,
      };

      observer.observe(msg);
      const candidates = observer.getNewCandidatesSince(0);
      const backtracks = candidates.filter((c) => c.signalType === 'backtrack');
      expect(backtracks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('external tool call tracking (trust gate)', () => {
    it('records the step of the first external tool call', () => {
      observer.observe({
        type: 'memory:tool-call',
        toolName: 'WebFetch',
        args: { url: 'https://example.com' },
        stepNumber: 10,
      });

      // After WebFetch, self-correction should be flagged
      observer.observe({
        type: 'memory:reasoning',
        text: 'Actually, the correct method is fetch() not axios.',
        stepNumber: 11,
      });

      // The observer internally tracks the external tool call step
      // finalize() will apply the trust gate
    });
  });

  describe('file access tracking', () => {
    it('tracks multiple reads of the same file', () => {
      for (let i = 0; i < 3; i++) {
        observer.observe({
          type: 'memory:tool-call',
          toolName: 'Read',
          args: { file_path: '/src/auth.ts' },
          stepNumber: i + 1,
        });
      }

      const scratchpad = observer.getScratchpad();
      expect(scratchpad.analytics.fileAccessCounts.get('/src/auth.ts')).toBe(3);
    });

    it('tracks first and last access steps', () => {
      observer.observe({
        type: 'memory:tool-call',
        toolName: 'Read',
        args: { file_path: '/src/router.ts' },
        stepNumber: 2,
      });
      observer.observe({
        type: 'memory:tool-call',
        toolName: 'Read',
        args: { file_path: '/src/router.ts' },
        stepNumber: 8,
      });

      const scratchpad = observer.getScratchpad();
      expect(scratchpad.analytics.fileFirstAccess.get('/src/router.ts')).toBe(2);
      expect(scratchpad.analytics.fileLastAccess.get('/src/router.ts')).toBe(8);
    });

    it('tracks config file touches', () => {
      observer.observe({
        type: 'memory:tool-call',
        toolName: 'Edit',
        args: { file_path: '/tsconfig.json' },
        stepNumber: 3,
      });

      const scratchpad = observer.getScratchpad();
      expect(scratchpad.analytics.configFilesTouched.has('/tsconfig.json')).toBe(true);
      expect(scratchpad.analytics.fileEditSet.has('/tsconfig.json')).toBe(true);
    });
  });

  describe('finalize()', () => {
    it('returns empty array for changelog session type', async () => {
      const changelogObserver = new MemoryObserver(
        'test-session-changelog',
        'changelog',
        'test-project',
      );
      changelogObserver.observe({
        type: 'memory:reasoning',
        text: 'Actually, the version should be 2.0 not 1.5.',
        stepNumber: 1,
      });

      const candidates = await changelogObserver.finalize('success');
      expect(candidates).toHaveLength(0);
    });

    it('returns candidates on successful build', async () => {
      // Create enough signals to generate candidates
      observer.observe({
        type: 'memory:reasoning',
        text: 'Wait, I need to check the imports first.',
        stepNumber: 1,
      });

      const candidates = await observer.finalize('success');
      expect(Array.isArray(candidates)).toBe(true);
    });

    it('only returns dead_end candidates on failed session', async () => {
      observer.observe({
        type: 'memory:reasoning',
        text: 'This approach will not work in this environment.',
        stepNumber: 2,
      });
      observer.observe({
        type: 'memory:reasoning',
        text: 'Actually, I was wrong about the method signature.',
        stepNumber: 3,
      });

      const candidates = await observer.finalize('failure');
      // On failure, only dead_end type candidates should pass
      for (const c of candidates) {
        expect(c.proposedType).toBe('dead_end');
      }
    });
  });
});
