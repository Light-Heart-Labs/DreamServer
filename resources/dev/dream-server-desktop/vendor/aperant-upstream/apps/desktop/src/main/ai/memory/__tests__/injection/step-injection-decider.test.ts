/**
 * StepInjectionDecider Tests
 *
 * Tests all three injection triggers:
 *   1. Gotcha injection (file read with known gotchas)
 *   2. Scratchpad reflection (new entries since last step)
 *   3. Search short-circuit (Grep/Glob pattern matches known memory)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StepInjectionDecider } from '../../injection/step-injection-decider';
import type { MemoryService, Memory } from '../../types';
import type { Scratchpad } from '../../observer/scratchpad';
import type { AcuteCandidate } from '../../types';

// ============================================================
// HELPERS
// ============================================================

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    type: 'gotcha',
    content: 'Always check null before accessing .id',
    confidence: 0.85,
    tags: [],
    relatedFiles: ['/src/auth.ts'],
    relatedModules: ['auth'],
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    scope: 'module',
    source: 'agent_explicit',
    sessionId: 'sess-1',
    provenanceSessionIds: [],
    projectId: 'proj-1',
    ...overrides,
  };
}

function makeScratchpad(newEntries: AcuteCandidate[] = []): Scratchpad {
  return {
    getNewSince: vi.fn().mockReturnValue(newEntries),
  } as unknown as Scratchpad;
}

function makeMemoryService(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    store: vi.fn().mockResolvedValue('new-id'),
    search: vi.fn().mockResolvedValue([]),
    searchByPattern: vi.fn().mockResolvedValue(null),
    insertUserTaught: vi.fn().mockResolvedValue('user-id'),
    searchWorkflowRecipe: vi.fn().mockResolvedValue([]),
    updateAccessCount: vi.fn().mockResolvedValue(undefined),
    deprecateMemory: vi.fn().mockResolvedValue(undefined),
    verifyMemory: vi.fn().mockResolvedValue(undefined),
    pinMemory: vi.fn().mockResolvedValue(undefined),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('StepInjectionDecider', () => {
  let decider: StepInjectionDecider;
  let memoryService: MemoryService;
  let scratchpad: Scratchpad;

  beforeEach(() => {
    memoryService = makeMemoryService();
    scratchpad = makeScratchpad();
    decider = new StepInjectionDecider(memoryService, scratchpad, 'proj-1');
  });

  describe('Trigger 1: Gotcha injection', () => {
    it('returns gotcha_injection when file reads match known gotchas', async () => {
      const gotcha = makeMemory({ id: 'gotcha-1', type: 'gotcha' });
      vi.mocked(memoryService.search).mockResolvedValueOnce([gotcha]);

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Read', args: { file_path: '/src/auth.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe('gotcha_injection');
      expect(result?.memoryIds).toContain('gotcha-1');
      expect(result?.content).toContain('MEMORY ALERT');
    });

    it('includes error_pattern and dead_end types in gotcha search', async () => {
      await decider.decide(3, {
        toolCalls: [{ toolName: 'Edit', args: { file_path: '/src/main.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(memoryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          types: expect.arrayContaining(['gotcha', 'error_pattern', 'dead_end']),
        }),
      );
    });

    it('skips already-injected memory IDs', async () => {
      const gotcha = makeMemory({ id: 'gotcha-already-seen' });
      vi.mocked(memoryService.search).mockImplementation(async (filters) => {
        // Simulate the filter function being applied: if filter rejects the memory, return empty
        const passesFilter = filters.filter ? filters.filter(gotcha) : true;
        return passesFilter ? [gotcha] : [];
      });

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Read', args: { file_path: '/src/auth.ts' } }],
        injectedMemoryIds: new Set(['gotcha-already-seen']),
      });

      // The filter passed to search would exclude the already-injected ID
      // The mock returns based on filter, so result depends on mock implementation
      // We primarily verify that the injectedMemoryIds Set is passed in the filter
      expect(memoryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.any(Function),
        }),
      );
    });

    it('only triggers for Read and Edit tool calls, not Bash', async () => {
      await decider.decide(3, {
        toolCalls: [{ toolName: 'Bash', args: { command: 'npm test' } }],
        injectedMemoryIds: new Set(),
      });

      // search should not be called for gotchas when no Read/Edit calls
      const gotchaSearchCalls = vi.mocked(memoryService.search).mock.calls.filter(
        (call) => call[0].types?.includes('gotcha'),
      );
      expect(gotchaSearchCalls).toHaveLength(0);
    });
  });

  describe('Trigger 2: Scratchpad reflection', () => {
    it('returns scratchpad_reflection when new entries exist', async () => {
      const newEntry: AcuteCandidate = {
        signalType: 'self_correction',
        rawData: { triggeringText: 'Actually the method is called differently' },
        priority: 0.9,
        capturedAt: Date.now(),
        stepNumber: 4,
      };
      scratchpad = makeScratchpad([newEntry]);
      decider = new StepInjectionDecider(memoryService, scratchpad, 'proj-1');

      // No file reads, so gotcha trigger won't fire
      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Bash', args: { command: 'ls' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe('scratchpad_reflection');
      expect(result?.memoryIds).toHaveLength(0);
      expect(result?.content).toContain('MEMORY REFLECTION');
    });

    it('passes stepNumber - 1 to getNewSince', async () => {
      const getSpy = vi.mocked(scratchpad.getNewSince);

      await decider.decide(10, {
        toolCalls: [],
        injectedMemoryIds: new Set(),
      });

      expect(getSpy).toHaveBeenCalledWith(9);
    });

    it('returns null when scratchpad has no new entries', async () => {
      scratchpad = makeScratchpad([]);
      decider = new StepInjectionDecider(memoryService, scratchpad, 'proj-1');

      const result = await decider.decide(5, {
        toolCalls: [],
        injectedMemoryIds: new Set(),
      });

      expect(result).toBeNull();
    });
  });

  describe('Trigger 3: Search short-circuit', () => {
    it('returns search_short_circuit when Grep pattern matches a known memory', async () => {
      const known = makeMemory({ id: 'grep-match', content: 'Use useCallback for memoized handlers' });
      vi.mocked(memoryService.searchByPattern).mockResolvedValueOnce(known);

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Grep', args: { pattern: 'useCallback' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe('search_short_circuit');
      expect(result?.memoryIds).toContain('grep-match');
      expect(result?.content).toContain('MEMORY CONTEXT');
    });

    it('returns search_short_circuit when Glob pattern matches', async () => {
      const known = makeMemory({ id: 'glob-match' });
      vi.mocked(memoryService.searchByPattern).mockResolvedValueOnce(known);

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Glob', args: { glob: '**/*.test.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result?.type).toBe('search_short_circuit');
    });

    it('skips search_short_circuit if memory is already injected', async () => {
      const known = makeMemory({ id: 'already-injected' });
      vi.mocked(memoryService.searchByPattern).mockResolvedValueOnce(known);

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Grep', args: { pattern: 'something' } }],
        injectedMemoryIds: new Set(['already-injected']),
      });

      expect(result).toBeNull();
    });

    it('skips Grep entries with empty patterns', async () => {
      await decider.decide(5, {
        toolCalls: [{ toolName: 'Grep', args: { pattern: '' } }],
        injectedMemoryIds: new Set(),
      });

      expect(memoryService.searchByPattern).not.toHaveBeenCalled();
    });

    it('only checks last 3 Grep/Glob calls', async () => {
      vi.mocked(memoryService.searchByPattern).mockResolvedValue(null);

      await decider.decide(5, {
        toolCalls: [
          { toolName: 'Grep', args: { pattern: 'pat1' } },
          { toolName: 'Grep', args: { pattern: 'pat2' } },
          { toolName: 'Grep', args: { pattern: 'pat3' } },
          { toolName: 'Grep', args: { pattern: 'pat4' } },
          { toolName: 'Grep', args: { pattern: 'pat5' } },
        ],
        injectedMemoryIds: new Set(),
      });

      // Should only check the last 3: pat3, pat4, pat5
      expect(memoryService.searchByPattern).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling', () => {
    it('returns null gracefully when memoryService.search throws', async () => {
      vi.mocked(memoryService.search).mockRejectedValueOnce(new Error('DB error'));

      const result = await decider.decide(3, {
        toolCalls: [{ toolName: 'Read', args: { file_path: '/src/foo.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result).toBeNull();
    });

    it('returns null gracefully when memoryService.searchByPattern throws', async () => {
      vi.mocked(memoryService.searchByPattern).mockRejectedValueOnce(new Error('timeout'));

      const result = await decider.decide(3, {
        toolCalls: [{ toolName: 'Grep', args: { pattern: 'foo' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result).toBeNull();
    });
  });

  describe('trigger priority', () => {
    it('returns gotcha_injection first when file reads match, before checking scratchpad', async () => {
      const gotcha = makeMemory({ id: 'g1' });
      vi.mocked(memoryService.search).mockResolvedValueOnce([gotcha]);

      const newEntry: AcuteCandidate = {
        signalType: 'self_correction',
        rawData: { triggeringText: 'correction' },
        priority: 0.9,
        capturedAt: Date.now(),
        stepNumber: 4,
      };
      scratchpad = makeScratchpad([newEntry]);
      decider = new StepInjectionDecider(memoryService, scratchpad, 'proj-1');

      const result = await decider.decide(5, {
        toolCalls: [{ toolName: 'Read', args: { file_path: '/src/auth.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(result?.type).toBe('gotcha_injection');
    });
  });
});
