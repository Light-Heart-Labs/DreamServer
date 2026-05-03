/**
 * buildQaSessionContext Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildQaSessionContext } from '../../injection/qa-context';
import type { MemoryService, Memory } from '../../types';

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

describe('buildQaSessionContext', () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    memoryService = makeMemoryService();
  });

  it('returns empty string when no memories exist', async () => {
    const result = await buildQaSessionContext('Validate auth flow', ['auth'], memoryService, 'proj-1');
    expect(result).toBe('');
  });

  it('includes error patterns when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('error_pattern')) {
        return [makeMemory('ep-1', 'Token validation fails silently on expired JWT', 'error_pattern')];
      }
      return [];
    });

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('ERROR PATTERNS');
    expect(result).toContain('Token validation fails silently');
  });

  it('includes e2e observations when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('e2e_observation')) {
        return [makeMemory('eo-1', 'Login button requires 500ms delay before becoming clickable', 'e2e_observation')];
      }
      return [];
    });

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('E2E OBSERVATIONS');
    expect(result).toContain('500ms delay');
  });

  it('includes requirements when found', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('requirement')) {
        return [makeMemory('req-1', 'All API endpoints must return 401 not 403 for auth failures', 'requirement')];
      }
      return [];
    });

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('KNOWN REQUIREMENTS');
    expect(result).toContain('401 not 403');
  });

  it('includes validation workflow recipes', async () => {
    vi.mocked(memoryService.searchWorkflowRecipe).mockResolvedValueOnce([
      makeMemory('r1', 'Step 1: Check login. Step 2: Verify token expiry.', 'workflow_recipe'),
    ]);

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('VALIDATION WORKFLOW');
    expect(result).toContain('Check login');
  });

  it('wraps output in QA section header/footer', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('requirement')) {
        return [makeMemory('r1', 'Auth must use HTTPS', 'requirement')];
      }
      return [];
    });

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toContain('=== MEMORY CONTEXT FOR QA ===');
    expect(result).toContain('=== END MEMORY CONTEXT ===');
  });

  it('returns empty string gracefully on error', async () => {
    vi.mocked(memoryService.search).mockRejectedValue(new Error('DB error'));
    vi.mocked(memoryService.searchWorkflowRecipe).mockRejectedValue(new Error('DB error'));

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(result).toBe('');
  });

  it('runs all 4 queries in parallel', async () => {
    await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    expect(memoryService.search).toHaveBeenCalledTimes(3); // e2e_obs, error_pattern, requirement
    expect(memoryService.searchWorkflowRecipe).toHaveBeenCalledTimes(1);
  });

  it('prioritizes requirements before error patterns in output', async () => {
    vi.mocked(memoryService.search).mockImplementation(async (filters) => {
      if (filters.types?.includes('requirement')) {
        return [makeMemory('r1', 'Must use HTTPS', 'requirement')];
      }
      if (filters.types?.includes('error_pattern')) {
        return [makeMemory('ep1', 'Silent token failure', 'error_pattern')];
      }
      return [];
    });

    const result = await buildQaSessionContext('Validate auth', ['auth'], memoryService, 'proj-1');

    const reqPos = result.indexOf('KNOWN REQUIREMENTS');
    const errPos = result.indexOf('ERROR PATTERNS');
    expect(reqPos).toBeGreaterThanOrEqual(0);
    expect(errPos).toBeGreaterThanOrEqual(0);
    expect(reqPos).toBeLessThan(errPos);
  });
});
