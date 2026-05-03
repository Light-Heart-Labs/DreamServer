/**
 * MemoryService Implementation
 *
 * Implements the MemoryService interface against a libSQL database.
 * Handles store, search, BM25 pattern search, and convenience methods.
 */

import type { Client } from '@libsql/client';
import type {
  Memory,
  MemoryService,
  MemoryRecordEntry,
  MemorySearchFilters,
  MemoryType,
  MemoryScope,
  MemorySource,
  WorkUnitRef,
  MemoryRelation,
} from './types';
import type { EmbeddingService } from './embedding-service';
import { buildMemoryContextualText } from './embedding-service';
import { searchBM25 } from './retrieval/bm25-search';
import type { RetrievalPipeline } from './retrieval/pipeline';

// ============================================================
// ROW MAPPING HELPER
// ============================================================

function rowToMemory(row: Record<string, unknown>): Memory {
  const parseJson = <T>(val: unknown, fallback: T): T => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  };

  return {
    id: row.id as string,
    type: row.type as MemoryType,
    content: row.content as string,
    confidence: (row.confidence as number) ?? 0.8,
    tags: parseJson<string[]>(row.tags, []),
    relatedFiles: parseJson<string[]>(row.related_files, []),
    relatedModules: parseJson<string[]>(row.related_modules, []),
    createdAt: row.created_at as string,
    lastAccessedAt: row.last_accessed_at as string,
    accessCount: (row.access_count as number) ?? 0,
    scope: (row.scope as MemoryScope) ?? 'global',
    source: (row.source as MemorySource) ?? 'agent_explicit',
    sessionId: (row.session_id as string) ?? '',
    commitSha: (row.commit_sha as string | null) ?? undefined,
    provenanceSessionIds: parseJson<string[]>(row.provenance_session_ids, []),
    targetNodeId: (row.target_node_id as string | null) ?? undefined,
    impactedNodeIds: parseJson<string[]>(row.impacted_node_ids, []),
    relations: parseJson<MemoryRelation[]>(row.relations, []),
    decayHalfLifeDays: (row.decay_half_life_days as number | null) ?? undefined,
    needsReview: Boolean(row.needs_review),
    userVerified: Boolean(row.user_verified),
    citationText: (row.citation_text as string | null) ?? undefined,
    pinned: Boolean(row.pinned),
    deprecated: Boolean(row.deprecated),
    deprecatedAt: (row.deprecated_at as string | null) ?? undefined,
    staleAt: (row.stale_at as string | null) ?? undefined,
    projectId: row.project_id as string,
    trustLevelScope: (row.trust_level_scope as string | null) ?? undefined,
    chunkType: (row.chunk_type as Memory['chunkType']) ?? undefined,
    chunkStartLine: (row.chunk_start_line as number | null) ?? undefined,
    chunkEndLine: (row.chunk_end_line as number | null) ?? undefined,
    contextPrefix: (row.context_prefix as string | null) ?? undefined,
    embeddingModelId: (row.embedding_model_id as string | null) ?? undefined,
    workUnitRef: row.work_unit_ref
      ? parseJson<WorkUnitRef | undefined>(row.work_unit_ref, undefined)
      : undefined,
    methodology: (row.methodology as string | null) ?? undefined,
  };
}

// ============================================================
// MEMORY SERVICE IMPLEMENTATION
// ============================================================

export class MemoryServiceImpl implements MemoryService {
  constructor(
    private readonly db: Client,
    private readonly embeddingService: EmbeddingService,
    private readonly retrievalPipeline: RetrievalPipeline,
  ) {}

  /**
   * Store a memory entry in the database.
   * Inserts into memories, memories_fts, and memory_embeddings tables.
   * Returns the generated memory ID.
   */
  async store(entry: MemoryRecordEntry): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const tags = JSON.stringify(entry.tags ?? []);
    const relatedFiles = JSON.stringify(entry.relatedFiles ?? []);
    const relatedModules = JSON.stringify(entry.relatedModules ?? []);
    const provenanceSessionIds = JSON.stringify([]);
    const relations = JSON.stringify([]);
    const workUnitRef = entry.workUnitRef ? JSON.stringify(entry.workUnitRef) : null;

    try {
      // Build a temporary Memory-like object to generate contextual embedding
      const memoryForEmbedding: Memory = {
        id,
        type: entry.type,
        content: entry.content,
        confidence: entry.confidence ?? 0.8,
        tags: entry.tags ?? [],
        relatedFiles: entry.relatedFiles ?? [],
        relatedModules: entry.relatedModules ?? [],
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        scope: entry.scope ?? 'global',
        source: entry.source ?? 'agent_explicit',
        sessionId: entry.sessionId ?? '',
        provenanceSessionIds: [],
        projectId: entry.projectId,
        workUnitRef: entry.workUnitRef,
        methodology: entry.methodology,
        decayHalfLifeDays: entry.decayHalfLifeDays,
        needsReview: entry.needsReview,
        pinned: entry.pinned,
        citationText: entry.citationText,
        chunkType: entry.chunkType,
        chunkStartLine: entry.chunkStartLine,
        chunkEndLine: entry.chunkEndLine,
        contextPrefix: entry.contextPrefix,
        trustLevelScope: entry.trustLevelScope,
      };

      const contextualText = buildMemoryContextualText(memoryForEmbedding);
      const embedding = await this.embeddingService.embed(contextualText, 1024);
      const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
      const modelId = this.embeddingService.getProvider();
      const embeddingModelId = `${modelId}-d1024`;

      await this.db.batch([
        // Insert into memories table
        {
          sql: `INSERT INTO memories (
            id, type, content, confidence, tags, related_files, related_modules,
            created_at, last_accessed_at, access_count,
            session_id, scope, work_unit_ref, methodology,
            source, relations, decay_half_life_days, provenance_session_ids,
            needs_review, pinned, citation_text,
            chunk_type, chunk_start_line, chunk_end_line, context_prefix,
            trust_level_scope, project_id, embedding_model_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, 0,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
          )`,
          args: [
            id,
            entry.type,
            entry.content,
            entry.confidence ?? 0.8,
            tags,
            relatedFiles,
            relatedModules,
            now,
            now,
            entry.sessionId ?? null,
            entry.scope ?? 'global',
            workUnitRef,
            entry.methodology ?? null,
            entry.source ?? 'agent_explicit',
            relations,
            entry.decayHalfLifeDays ?? null,
            provenanceSessionIds,
            entry.needsReview ? 1 : 0,
            entry.pinned ? 1 : 0,
            entry.citationText ?? null,
            entry.chunkType ?? null,
            entry.chunkStartLine ?? null,
            entry.chunkEndLine ?? null,
            entry.contextPrefix ?? null,
            entry.trustLevelScope ?? 'personal',
            entry.projectId,
            embeddingModelId,
          ],
        },
        // Insert into FTS5 table
        {
          sql: `INSERT INTO memories_fts (memory_id, content, tags, related_files)
                VALUES (?, ?, ?, ?)`,
          args: [
            id,
            entry.content,
            (entry.tags ?? []).join(' '),
            (entry.relatedFiles ?? []).join(' '),
          ],
        },
        // Insert into memory_embeddings table
        {
          sql: `INSERT INTO memory_embeddings (memory_id, embedding, model_id, dims, created_at)
                VALUES (?, ?, ?, 1024, ?)`,
          args: [id, embeddingBlob, embeddingModelId, now],
        },
      ]);

      return id;
    } catch (error) {
      console.error('[MemoryService] Failed to store memory:', error);
      throw error;
    }
  }

  /**
   * Search memories using filters.
   * If a query string is provided, delegates to the retrieval pipeline.
   * Otherwise, performs a direct SQL query using type/scope/project filters.
   */
  async search(filters: MemorySearchFilters): Promise<Memory[]> {
    try {
      let memories: Memory[];

      if (filters.query) {
        // Use the retrieval pipeline for semantic search
        const result = await this.retrievalPipeline.search(filters.query, {
          phase: filters.phase ?? 'explore',
          projectId: filters.projectId ?? '',
          maxResults: filters.limit ?? 8,
        });
        memories = result.memories;
      } else {
        // Direct SQL query using structural filters
        memories = await this.directSearch(filters);
      }

      // Post-filter by minConfidence
      if (filters.minConfidence !== undefined) {
        memories = memories.filter((m) => m.confidence >= (filters.minConfidence ?? 0));
      }

      // Post-filter deprecated
      if (filters.excludeDeprecated) {
        memories = memories.filter((m) => !m.deprecated);
      }

      // Apply custom filter callback
      if (filters.filter) {
        memories = memories.filter(filters.filter);
      }

      // Sort
      if (filters.sort === 'recency') {
        memories.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      } else if (filters.sort === 'confidence') {
        memories.sort((a, b) => b.confidence - a.confidence);
      }
      // 'relevance' sort is preserved from pipeline order

      // Apply limit after all filtering
      if (filters.limit !== undefined && memories.length > filters.limit) {
        memories = memories.slice(0, filters.limit);
      }

      return memories;
    } catch (error) {
      console.error('[MemoryService] Failed to search memories:', error);
      return [];
    }
  }

  /**
   * Quick BM25-only pattern search.
   * Returns the single best match or null.
   * Used for fast lookups (e.g., StepInjectionDecider).
   */
  async searchByPattern(pattern: string): Promise<Memory | null> {
    try {
      const results = await searchBM25(this.db, pattern, '', 1);
      if (results.length === 0) return null;

      const memoryId = results[0].memoryId;
      const row = await this.db.execute({
        sql: 'SELECT * FROM memories WHERE id = ? AND deprecated = 0',
        args: [memoryId],
      });

      if (row.rows.length === 0) return null;
      return rowToMemory(row.rows[0] as Record<string, unknown>);
    } catch (error) {
      console.error('[MemoryService] searchByPattern failed:', error);
      return null;
    }
  }

  /**
   * Convenience method for /remember command and Teach panel.
   * Stores a user-taught preference with full confidence.
   */
  async insertUserTaught(content: string, projectId: string, tags: string[]): Promise<string> {
    return this.store({
      type: 'preference',
      content,
      projectId,
      tags,
      source: 'user_taught',
      confidence: 1.0,
      scope: 'global',
    });
  }

  /**
   * Search for workflow_recipe memories matching a task description.
   * Uses the retrieval pipeline with a type filter applied post-search.
   */
  async searchWorkflowRecipe(
    taskDescription: string,
    opts?: { limit?: number },
  ): Promise<Memory[]> {
    try {
      const limit = opts?.limit ?? 5;
      const result = await this.retrievalPipeline.search(taskDescription, {
        phase: 'implement',
        projectId: '',
        maxResults: limit * 3, // Fetch extra to allow for type filtering
      });

      // Filter to workflow_recipe type
      const recipes = result.memories.filter((m) => m.type === 'workflow_recipe');
      return recipes.slice(0, limit);
    } catch (error) {
      console.error('[MemoryService] searchWorkflowRecipe failed:', error);
      return [];
    }
  }

  /**
   * Increment access_count and update last_accessed_at for a memory.
   */
  async updateAccessCount(memoryId: string): Promise<void> {
    try {
      await this.db.execute({
        sql: `UPDATE memories
              SET access_count = access_count + 1,
                  last_accessed_at = ?
              WHERE id = ?`,
        args: [new Date().toISOString(), memoryId],
      });
    } catch (error) {
      console.error('[MemoryService] updateAccessCount failed:', error);
    }
  }

  /**
   * Mark a memory as deprecated.
   */
  async deprecateMemory(memoryId: string): Promise<void> {
    try {
      await this.db.execute({
        sql: `UPDATE memories
              SET deprecated = 1, deprecated_at = ?
              WHERE id = ?`,
        args: [new Date().toISOString(), memoryId],
      });
    } catch (error) {
      console.error('[MemoryService] deprecateMemory failed:', error);
    }
  }

  /**
   * Mark a memory as user-verified and clear the needs_review flag.
   */
  async verifyMemory(memoryId: string): Promise<void> {
    await this.db.execute({
      sql: `UPDATE memories SET user_verified = 1, needs_review = 0 WHERE id = ?`,
      args: [memoryId],
    });
  }

  /**
   * Pin or unpin a memory.
   */
  async pinMemory(memoryId: string, pinned: boolean): Promise<void> {
    await this.db.execute({
      sql: `UPDATE memories SET pinned = ? WHERE id = ?`,
      args: [pinned ? 1 : 0, memoryId],
    });
  }

  /**
   * Permanently delete a memory and all associated records.
   */
  async deleteMemory(memoryId: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM memory_embeddings WHERE memory_id = ?', args: [memoryId] },
      { sql: 'DELETE FROM memories_fts WHERE memory_id = ?', args: [memoryId] },
      { sql: 'DELETE FROM memories WHERE id = ?', args: [memoryId] },
    ]);
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async directSearch(filters: MemorySearchFilters): Promise<Memory[]> {
    const conditions: string[] = ['1=1'];
    const args: (string | number | null)[] = [];

    if (filters.excludeDeprecated !== false) {
      conditions.push('deprecated = 0');
    }

    if (filters.projectId) {
      conditions.push('project_id = ?');
      args.push(filters.projectId);
    }

    if (filters.scope) {
      conditions.push('scope = ?');
      args.push(filters.scope);
    }

    if (filters.types && filters.types.length > 0) {
      const placeholders = filters.types.map(() => '?').join(', ');
      conditions.push(`type IN (${placeholders})`);
      args.push(...filters.types);
    }

    if (filters.sources && filters.sources.length > 0) {
      const placeholders = filters.sources.map(() => '?').join(', ');
      conditions.push(`source IN (${placeholders})`);
      args.push(...filters.sources);
    }

    if (filters.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      args.push(filters.minConfidence);
    }

    const orderBy =
      filters.sort === 'recency'
        ? 'created_at DESC'
        : filters.sort === 'confidence'
          ? 'confidence DESC'
          : 'last_accessed_at DESC';

    const limit = filters.limit ?? 50;

    const sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`;
    args.push(limit);

    const result = await this.db.execute({ sql, args });
    return result.rows.map((r) => rowToMemory(r as Record<string, unknown>));
  }
}
