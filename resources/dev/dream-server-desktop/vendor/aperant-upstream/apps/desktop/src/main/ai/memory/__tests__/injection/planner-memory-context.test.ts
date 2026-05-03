/**
 * buildPlannerMemoryContext Tests
 *
 * Tests context building with mocked MemoryService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlannerMemoryContext } from '../../injection/planner-memory-context';
import type { MemoryService, Memory } from '../../types';

// ============================================================
// HELPERS
// ============================================================

function makeMemory(id: string, content: string, type: Memory['type'] = 'gotcha'): Memory {
  return {
    id,
    type,
    content,
    confidence: 0.8,
    tags: [],
    relatedFiles: [],
    relatedModules: ['auth'],
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    scope: 'module',
    source: 'agent_explicit',
    sessionId: 'sess-1',
    provenanceSessionIds: [],
    projectId: 'proj-1',
  };
}

function makeMemoryService(): MemoryService {
  return {
    store: vi.fn().mockResolvedValue('id'),
    search: vi.fn().mockResolvedValue([]),
    searchByPattern: vi.fn().mockResolvedValue(null),
    insertUserTaught: vi.fn().mockResolvedValue('id'),
    searchWorkflowRecipe: vi.fn().mockResolvedValue([]),
    updateAccessCount: vi.fn().mockResolvedValue(undefined),
    deprecateMemory: vi.fn().mockResolvedValue(undefined),
    verifyMemory: vi.fn().mockResolvedValue(undefined),
    pinMemory: vi.fn().mockResolvedValue(undefined),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================
// TESTS
// ============================================================

describe('buildPlannerMemoryContext', () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    memoryService = makeMemoryService();
  });

  it('returns empty string when no memories exist', async () => {
    const result = await buildPlannerMemoryContext(
      'Add authentication',
      ['auth'],
      memoryService,
      'proj-1',
    );
    expect(result).toBe('');
  });

  it('includes workflow recipes when found', async () => {
    vi.mocked(memoryService.searchWorkflowRecipe).mockResolvedValueOnce([
      makeMemory('r1', 'Step 1: Validate token. Step 2: Check permissions.', 'workflow_recipe'),
    ]);

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('WORKFLOW RECIPES');
    expect(result).toContain('Step 1: Validate token');
  });

  it('includes task calibrations with ratio when JSON content is parseable', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('task_calibration')) {
        return [
          makeMemory(
            'cal-1',
            JSON.stringify({ module: 'auth', ratio: 1.4, averageActualSteps: 140, averagePlannedSteps: 100, sampleCount: 5 }),
            'task_calibration',
          ),
        ];
      }
      return [];
    });

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('TASK CALIBRATIONS');
    expect(result).toContain('1.40x');
  });

  it('includes dead ends when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('dead_end')) {
        return [makeMemory('de-1', 'Using bcrypt v5 broke the token format', 'dead_end')];
      }
      return [];
    });

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('DEAD ENDS');
    expect(result).toContain('bcrypt v5');
  });

  it('includes causal dependencies when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('causal_dependency')) {
        return [makeMemory('cd-1', 'Must migrate DB schema before updating token model', 'causal_dependency')];
      }
      return [];
    });

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('CAUSAL DEPENDENCIES');
    expect(result).toContain('migrate DB schema');
  });

  it('includes recent outcomes when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('work_unit_outcome')) {
        return [makeMemory('out-1', 'Auth module refactored successfully in spec 023', 'work_unit_outcome')];
      }
      return [];
    });

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('RECENT OUTCOMES');
    expect(result).toContain('spec 023');
  });

  it('only includes sections that have results', async () => {
    vi.mocked(memoryService.searchWorkflowRecipe).mockResolvedValueOnce([
      makeMemory('r1', 'Recipe content', 'workflow_recipe'),
    ]);
    // All search() calls return empty

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('WORKFLOW RECIPES');
    expect(result).not.toContain('TASK CALIBRATIONS');
    expect(result).not.toContain('DEAD ENDS');
  });

  it('wraps output in section header and footer', async () => {
    vi.mocked(memoryService.searchWorkflowRecipe).mockResolvedValueOnce([
      makeMemory('r1', 'Some recipe', 'workflow_recipe'),
    ]);

    const result = await buildPlannerMemoryContext('Add auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('=== MEMORY CONTEXT FOR PLANNER ===');
    expect(result).toContain('=== END MEMORY CONTEXT ===');
  });

  it('passes projectId to all search calls', async () => {
    await buildPlannerMemoryContext('task', ['mod-a'], memoryService, 'my-project');

    // All search calls should use the provided projectId
    const allSearchCalls = vi.mocked(memoryService.search).mock.calls;
    for (const call of allSearchCalls) {
      expect(call[0].projectId).toBe('my-project');
    }
    expect(vi.mocked(memoryService.searchWorkflowRecipe)).toHaveBeenCalled();
  });

  it('runs all 5 queries in parallel', async () => {
    const callOrder: string[] = [];
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      callOrder.push(JSON.stringify(filters.types));
      return [];
    });
    vi.mocked(memoryService.searchWorkflowRecipe).mockImplementation(async () => {
      callOrder.push('workflow_recipe');
      return [];
    });

    await buildPlannerMemoryContext('task', ['mod'], memoryService, 'proj-1');

    // All 5 queries should have been called
    expect(memoryService.search).toHaveBeenCalledTimes(4);
    expect(memoryService.searchWorkflowRecipe).toHaveBeenCalledTimes(1);
  });

  it('returns empty string gracefully when memoryService throws', async () => {
    vi.mocked(memoryService.search).mockRejectedValue(new Error('DB unavailable'));
    vi.mocked(memoryService.searchWorkflowRecipe).mockRejectedValue(new Error('DB unavailable'));

    const result = await buildPlannerMemoryContext('task', ['mod'], memoryService, 'proj-1');

    expect(result).toBe('');
  });
});
