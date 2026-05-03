/**
 * StepMemoryState Tests
 *
 * Tests recording, windowing, injection tracking, and reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StepMemoryState } from '../../injection/step-memory-state';

describe('StepMemoryState', () => {
  let state: StepMemoryState;

  beforeEach(() => {
    state = new StepMemoryState();
  });

  describe('recordToolCall()', () => {
    it('records a tool call and makes it retrievable', () => {
      state.recordToolCall('Read', { file_path: '/src/auth.ts' });
      const ctx = state.getRecentContext(5);
      expect(ctx.toolCalls).toHaveLength(1);
      expect(ctx.toolCalls[0].toolName).toBe('Read');
    });

    it('maintains rolling window of last 20 calls', () => {
      for (let i = 0; i < 25; i++) {
        state.recordToolCall('Bash', { command: `cmd-${i}` });
      }
      // getRecentContext(5) returns last 5, but internal buffer should be capped at 20
      const ctx = state.getRecentContext(20);
      expect(ctx.toolCalls).toHaveLength(20);
      // Last recorded should be cmd-24
      expect(ctx.toolCalls[ctx.toolCalls.length - 1].args.command).toBe('cmd-24');
    });

    it('drops oldest entry when buffer exceeds 20', () => {
      for (let i = 0; i < 21; i++) {
        state.recordToolCall('Read', { file_path: `/file-${i}.ts` });
      }
      const ctx = state.getRecentContext(20);
      // file-0 should have been dropped
      const paths = ctx.toolCalls.map((c) => c.args.file_path);
      expect(paths).not.toContain('/file-0.ts');
      expect(paths).toContain('/file-20.ts');
    });
  });

  describe('getRecentContext()', () => {
    it('defaults to window size of 5', () => {
      for (let i = 0; i < 10; i++) {
        state.recordToolCall('Read', { file_path: `/file-${i}.ts` });
      }
      const ctx = state.getRecentContext();
      expect(ctx.toolCalls).toHaveLength(5);
    });

    it('respects custom window size', () => {
      for (let i = 0; i < 10; i++) {
        state.recordToolCall('Read', { file_path: `/file-${i}.ts` });
      }
      const ctx = state.getRecentContext(3);
      expect(ctx.toolCalls).toHaveLength(3);
    });

    it('returns fewer entries if fewer have been recorded', () => {
      state.recordToolCall('Read', { file_path: '/a.ts' });
      state.recordToolCall('Read', { file_path: '/b.ts' });
      const ctx = state.getRecentContext(5);
      expect(ctx.toolCalls).toHaveLength(2);
    });

    it('returns the injectedMemoryIds set', () => {
      state.markInjected(['id-a', 'id-b']);
      const ctx = state.getRecentContext();
      expect(ctx.injectedMemoryIds.has('id-a')).toBe(true);
      expect(ctx.injectedMemoryIds.has('id-b')).toBe(true);
    });
  });

  describe('markInjected()', () => {
    it('tracks injected memory IDs', () => {
      state.markInjected(['mem-1', 'mem-2']);
      const ctx = state.getRecentContext();
      expect(ctx.injectedMemoryIds.size).toBe(2);
    });

    it('accumulates IDs across multiple calls', () => {
      state.markInjected(['mem-1']);
      state.markInjected(['mem-2', 'mem-3']);
      const ctx = state.getRecentContext();
      expect(ctx.injectedMemoryIds.size).toBe(3);
    });

    it('deduplicates IDs', () => {
      state.markInjected(['mem-1', 'mem-1', 'mem-2']);
      const ctx = state.getRecentContext();
      expect(ctx.injectedMemoryIds.size).toBe(2);
    });
  });

  describe('reset()', () => {
    it('clears all tool calls', () => {
      state.recordToolCall('Read', { file_path: '/a.ts' });
      state.reset();
      const ctx = state.getRecentContext();
      expect(ctx.toolCalls).toHaveLength(0);
    });

    it('clears all injected IDs', () => {
      state.markInjected(['mem-1', 'mem-2']);
      state.reset();
      const ctx = state.getRecentContext();
      expect(ctx.injectedMemoryIds.size).toBe(0);
    });

    it('allows fresh recording after reset', () => {
      state.recordToolCall('Read', { file_path: '/a.ts' });
      state.reset();
      state.recordToolCall('Write', { file_path: '/b.ts' });
      const ctx = state.getRecentContext();
      expect(ctx.toolCalls).toHaveLength(1);
      expect(ctx.toolCalls[0].toolName).toBe('Write');
    });
  });
});
