/**
 * MemoryServiceImpl Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@libsql/client';
import type { Memory, MemoryRecordEntry, MemorySearchFilters } from '../types';
import type { EmbeddingService } from '../embedding-service';
import type { RetrievalPipeline } from '../retrieval/pipeline';
import { MemoryServiceImpl } from '../memory-service';

// ============================================================
// MOCKS
// ============================================================

const mockExecute = vi.fn();
const mockBatch = vi.fn();

const mockDb = {
  execute: mockExecute,
  batch: mockBatch,
} as unknown as Client;

const mockEmbed = vi.fn().mockResolvedValue(new Array(1024).fill(0.1));
const mockEmbedBatch = vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]);
const mockGetProvider = vi.fn().mockReturnValue('none');

const mockEmbeddingService = {
  embed: mockEmbed,
  embedBatch: mockEmbedBatch,
  getProvider: mockGetProvider,
  initialize: vi.fn().mockResolvedValue(undefined),
} as unknown as EmbeddingService;

const mockRetrievalSearch = vi.fn();
const mockRetrievalPipeline = {
  search: mockRetrievalSearch,
} as unknown as RetrievalPipeline;

// ============================================================
// FIXTURES
// ============================================================

function makeMemoryRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'mem-001',
    type: 'gotcha',
    content: 'Test memory content',
    confidence: 0.9,
    tags: '["typescript","testing"]',
    related_files: '["src/foo.ts"]',
    related_modules: '["module-a"]',
    created_at: '2024-01-01T00:00:00.000Z',
    last_accessed_at: '2024-01-01T00:00:00.000Z',
    access_count: 0,
    scope: 'global',
    source: 'agent_explicit',
    session_id: 'session-001',
    commit_sha: null,
    provenance_session_ids: '[]',
    target_node_id: null,
    impacted_node_ids: '[]',
    relations: '[]',
    decay_half_life_days: null,
    needs_review: 0,
    user_verified: 0,
    citation_text: null,
    pinned: 0,
    deprecated: 0,
    deprecated_at: null,
    stale_at: null,
    project_id: 'proj-001',
    trust_level_scope: 'personal',
    chunk_type: null,
    chunk_start_line: null,
    chunk_end_line: null,
    context_prefix: null,
    embedding_model_id: 'onnx-d1024',
    work_unit_ref: null,
    methodology: null,
    ...overrides,
  };
}

function makeMemoryResult(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-001',
    type: 'gotcha',
    content: 'Test memory content',
    confidence: 0.9,
    tags: ['typescript', 'testing'],
    relatedFiles: ['src/foo.ts'],
    relatedModules: ['module-a'],
    createdAt: '2024-01-01T00:00:00.000Z',
    lastAccessedAt: '2024-01-01T00:00:00.000Z',
    accessCount: 0,
    scope: 'global',
    source: 'agent_explicit',
    sessionId: 'session-001',
    provenanceSessionIds: [],
    projectId: 'proj-001',
    relations: [],
    needsReview: false,
    userVerified: false,
    pinned: false,
    deprecated: false,
    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('MemoryServiceImpl', () => {
  let service: MemoryServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryServiceImpl(mockDb, mockEmbeddingService, mockRetrievalPipeline);
    // Default batch mock: resolve successfully
    mockBatch.mockResolvedValue([]);
  });

  // ----------------------------------------------------------
  // store()
  // ----------------------------------------------------------

  describe('store()', () => {
    it('stores a memory entry and returns a UUID', async () => {
      const entry: MemoryRecordEntry = {
        type: 'gotcha',
        content: 'Remember to use bun instead of npm',
        projectId: 'proj-001',
        tags: ['tooling'],
        relatedFiles: ['package.json'],
      };

      const id = await service.store(entry);

      expect(typeof id).toBe('string');
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(mockBatch).toHaveBeenCalledOnce();
      expect(mockEmbed).toHaveBeenCalledOnce();
    });

    it('calls db.batch with three statements (memories, fts, embeddings)', async () => {
      const entry: MemoryRecordEntry = {
        type: 'decision',
        content: 'Use libSQL for memory storage',
        projectId: 'proj-002',
      };

      await service.store(entry);

      const batchArgs = mockBatch.mock.calls[0][0];
      expect(batchArgs).toHaveLength(3);

      // Check that the first SQL is the memories insert
      expect(batchArgs[0].sql).toContain('INSERT INTO memories');
      // Check that the second SQL is the FTS insert
      expect(batchArgs[1].sql).toContain('INSERT INTO memories_fts');
      // Check that the third SQL is the embeddings insert
      expect(batchArgs[2].sql).toContain('INSERT INTO memory_embeddings');
    });

    it('uses default values for optional fields', async () => {
      const entry: MemoryRecordEntry = {
        type: 'pattern',
        content: 'Always check for null',
        projectId: 'proj-001',
      };

      await service.store(entry);

      const batchArgs = mockBatch.mock.calls[0][0];
      const memoriesArgs = batchArgs[0].args;

      // confidence defaults to 0.8
      expect(memoriesArgs).toContain(0.8);
      // scope defaults to 'global'
      expect(memoriesArgs).toContain('global');
      // source defaults to 'agent_explicit'
      expect(memoriesArgs).toContain('agent_explicit');
    });

    it('serializes tags and relatedFiles as JSON', async () => {
      const entry: MemoryRecordEntry = {
        type: 'gotcha',
        content: 'Some content',
        projectId: 'proj-001',
        tags: ['tag1', 'tag2'],
        relatedFiles: ['a.ts', 'b.ts'],
      };

      await service.store(entry);

      const batchArgs = mockBatch.mock.calls[0][0];
      const memoriesArgs = batchArgs[0].args;
      expect(memoriesArgs).toContain(JSON.stringify(['tag1', 'tag2']));
      expect(memoriesArgs).toContain(JSON.stringify(['a.ts', 'b.ts']));
    });

    it('throws if db.batch fails', async () => {
      mockBatch.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.store({ type: 'gotcha', content: 'x', projectId: 'p' }),
      ).rejects.toThrow('DB error');
    });
  });

  // ----------------------------------------------------------
  // search() — query-based (pipeline delegation)
  // ----------------------------------------------------------

  describe('search() with query', () => {
    it('delegates to retrievalPipeline.search() when query is provided', async () => {
      const mockMemory = makeMemoryResult();
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: [mockMemory],
        formattedContext: '',
      });

      const filters: MemorySearchFilters = {
        query: 'typescript testing gotcha',
        projectId: 'proj-001',
      };

      const results = await service.search(filters);

      expect(mockRetrievalSearch).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mem-001');
    });

    it('passes phase and projectId to the pipeline', async () => {
      mockRetrievalSearch.mockResolvedValueOnce({ memories: [], formattedContext: '' });

      await service.search({
        query: 'search term',
        projectId: 'proj-test',
        phase: 'implement',
      });

      expect(mockRetrievalSearch).toHaveBeenCalledWith('search term', {
        phase: 'implement',
        projectId: 'proj-test',
        maxResults: 8,
      });
    });

    it('applies minConfidence post-filter', async () => {
      const highConf = makeMemoryResult({ id: 'high', confidence: 0.95 });
      const lowConf = makeMemoryResult({ id: 'low', confidence: 0.5 });
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: [highConf, lowConf],
        formattedContext: '',
      });

      const results = await service.search({
        query: 'test',
        projectId: 'proj-001',
        minConfidence: 0.8,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('high');
    });

    it('applies excludeDeprecated post-filter', async () => {
      const active = makeMemoryResult({ id: 'active', deprecated: false });
      const deprecated = makeMemoryResult({ id: 'deprecated', deprecated: true });
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: [active, deprecated],
        formattedContext: '',
      });

      const results = await service.search({
        query: 'test',
        projectId: 'proj-001',
        excludeDeprecated: true,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('active');
    });

    it('applies custom filter callback', async () => {
      const mem1 = makeMemoryResult({ id: 'mem1', type: 'gotcha' });
      const mem2 = makeMemoryResult({ id: 'mem2', type: 'decision' });
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: [mem1, mem2],
        formattedContext: '',
      });

      const results = await service.search({
        query: 'test',
        projectId: 'proj-001',
        filter: (m) => m.type === 'gotcha',
      });

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('gotcha');
    });
  });

  // ----------------------------------------------------------
  // search() — filter-only (direct SQL)
  // ----------------------------------------------------------

  describe('search() with filters only (no query)', () => {
    it('performs direct SQL query when no query string is given', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [makeMemoryRow()] });

      const filters: MemorySearchFilters = {
        projectId: 'proj-001',
        scope: 'global',
        types: ['gotcha'],
      };

      const results = await service.search(filters);

      expect(mockRetrievalSearch).not.toHaveBeenCalled();
      expect(mockExecute).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
    });

    it('filters by type in direct SQL', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.search({ types: ['decision', 'gotcha'] });

      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('type IN (?, ?)');
    });

    it('filters by scope in direct SQL', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.search({ scope: 'module' });

      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('scope = ?');
    });

    it('filters by projectId in direct SQL', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.search({ projectId: 'proj-abc' });

      const args = mockExecute.mock.calls[0][0].args as string[];
      expect(args).toContain('proj-abc');
    });

    it('sorts by recency when sort=recency', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.search({ sort: 'recency' });

      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('created_at DESC');
    });

    it('sorts by confidence when sort=confidence', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.search({ sort: 'confidence' });

      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('confidence DESC');
    });

    it('returns empty array if db fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB down'));

      const results = await service.search({ projectId: 'proj-001' });

      expect(results).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // searchByPattern()
  // ----------------------------------------------------------

  describe('searchByPattern()', () => {
    it('returns null when no BM25 results', async () => {
      // searchBM25 calls db.execute
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await service.searchByPattern('some pattern');

      expect(result).toBeNull();
    });

    it('returns a memory when BM25 finds a match', async () => {
      // First execute: BM25 result
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: 'mem-001', bm25_score: -1.5 }],
      });
      // Second execute: fetch full memory
      mockExecute.mockResolvedValueOnce({ rows: [makeMemoryRow()] });

      const result = await service.searchByPattern('typescript testing');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('mem-001');
    });

    it('returns null if the fetched memory is deprecated', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: 'mem-001', bm25_score: -1.5 }],
      });
      // Memory fetch returns empty (deprecated = 0 condition excludes it)
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await service.searchByPattern('test');

      expect(result).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // insertUserTaught()
  // ----------------------------------------------------------

  describe('insertUserTaught()', () => {
    it('stores a preference memory with correct defaults', async () => {
      const id = await service.insertUserTaught(
        'Always use bun over npm',
        'proj-001',
        ['tooling'],
      );

      expect(typeof id).toBe('string');
      expect(mockBatch).toHaveBeenCalledOnce();

      const batchArgs = mockBatch.mock.calls[0][0];
      const memoriesArgs = batchArgs[0].args as unknown[];
      // type = 'preference'
      expect(memoriesArgs).toContain('preference');
      // source = 'user_taught'
      expect(memoriesArgs).toContain('user_taught');
      // confidence = 1.0
      expect(memoriesArgs).toContain(1.0);
      // scope = 'global'
      expect(memoriesArgs).toContain('global');
    });
  });

  // ----------------------------------------------------------
  // searchWorkflowRecipe()
  // ----------------------------------------------------------

  describe('searchWorkflowRecipe()', () => {
    it('returns workflow_recipe memories', async () => {
      const recipe = makeMemoryResult({ id: 'recipe-001', type: 'workflow_recipe' });
      const other = makeMemoryResult({ id: 'other-001', type: 'gotcha' });
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: [recipe, other],
        formattedContext: '',
      });

      const results = await service.searchWorkflowRecipe('deploy to production');

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('workflow_recipe');
    });

    it('respects limit option', async () => {
      const recipes = Array.from({ length: 10 }, (_, i) =>
        makeMemoryResult({ id: `recipe-${i}`, type: 'workflow_recipe' }),
      );
      mockRetrievalSearch.mockResolvedValueOnce({
        memories: recipes,
        formattedContext: '',
      });

      const results = await service.searchWorkflowRecipe('task', { limit: 3 });

      expect(results).toHaveLength(3);
    });

    it('returns empty array on pipeline failure', async () => {
      mockRetrievalSearch.mockRejectedValueOnce(new Error('Pipeline error'));

      const results = await service.searchWorkflowRecipe('task');

      expect(results).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // updateAccessCount()
  // ----------------------------------------------------------

  describe('updateAccessCount()', () => {
    it('executes an UPDATE query to increment access_count', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.updateAccessCount('mem-001');

      expect(mockExecute).toHaveBeenCalledOnce();
      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('access_count = access_count + 1');
      expect(sql).toContain('last_accessed_at');
    });

    it('does not throw on DB failure', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.updateAccessCount('mem-001')).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // deprecateMemory()
  // ----------------------------------------------------------

  describe('deprecateMemory()', () => {
    it('sets deprecated=1 and deprecated_at', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await service.deprecateMemory('mem-001');

      expect(mockExecute).toHaveBeenCalledOnce();
      const sql = mockExecute.mock.calls[0][0].sql as string;
      expect(sql).toContain('deprecated = 1');
      expect(sql).toContain('deprecated_at');
    });

    it('does not throw on DB failure', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.deprecateMemory('mem-001')).resolves.toBeUndefined();
    });
  });
});
