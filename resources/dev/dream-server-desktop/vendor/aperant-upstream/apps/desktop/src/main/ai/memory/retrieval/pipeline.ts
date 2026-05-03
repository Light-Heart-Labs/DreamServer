/**
 * Retrieval Pipeline Orchestrator
 *
 * Main entry point. Ties together all retrieval stages:
 *   1. Parallel candidate generation (BM25 + Dense + Graph)
 *   2. Weighted RRF fusion
 *   2b. Graph neighborhood boost
 *   3. Cross-encoder reranking (top 20 → top 8)
 *   4. Phase-aware context packing
 */

import type { Client } from '@libsql/client';
import type { Memory, UniversalPhase } from '../types';
import type { EmbeddingService } from '../embedding-service';
import { detectQueryType, QUERY_TYPE_WEIGHTS } from './query-classifier';
import { searchBM25 } from './bm25-search';
import { searchDense } from './dense-search';
import { searchGraph } from './graph-search';
import { weightedRRF } from './rrf-fusion';
import { applyGraphNeighborhoodBoost } from './graph-boost';
import { Reranker } from './reranker';
import { packContext } from './context-packer';

// ============================================================
// TYPES
// ============================================================

export interface RetrievalConfig {
  phase: UniversalPhase;
  projectId: string;
  recentFiles?: string[];
  recentToolCalls?: string[];
  maxResults?: number;
}

export interface RetrievalResult {
  memories: Memory[];
  formattedContext: string;
}

// ============================================================
// PIPELINE CLASS
// ============================================================

export class RetrievalPipeline {
  constructor(
    private readonly db: Client,
    private readonly embeddingService: EmbeddingService,
    private readonly reranker: Reranker,
  ) {}

  /**
   * Run the complete retrieval pipeline for a query.
   *
   * @param query - Search query text
   * @param config - Phase, project, and context configuration
   */
  async search(query: string, config: RetrievalConfig): Promise<RetrievalResult> {
    const queryType = detectQueryType(query, config.recentToolCalls);
    const weights = QUERY_TYPE_WEIGHTS[queryType];

    // Stage 1: Parallel candidate generation from all three paths
    const [bm25Results, denseResults, graphResults] = await Promise.all([
      searchBM25(this.db, query, config.projectId, 20),
      searchDense(this.db, query, this.embeddingService, config.projectId, 256, 30),
      searchGraph(this.db, config.recentFiles ?? [], config.projectId, 15),
    ]);

    // Stage 2a: Weighted RRF fusion (application-side — no SQL FULL OUTER JOIN)
    const fused = weightedRRF([
      {
        results: bm25Results.map((r) => ({ memoryId: r.memoryId })),
        weight: weights.fts,
        name: 'bm25',
      },
      {
        results: denseResults.map((r) => ({ memoryId: r.memoryId })),
        weight: weights.dense,
        name: 'dense',
      },
      {
        results: graphResults.map((r) => ({ memoryId: r.memoryId })),
        weight: weights.graph,
        name: 'graph',
      },
    ]);

    // Stage 2b: Graph neighborhood boost
    const boosted = await applyGraphNeighborhoodBoost(
      this.db,
      fused,
      config.projectId,
    );

    // Fetch full memory records for top candidates
    const topCandidateIds = boosted.slice(0, 20).map((r) => r.memoryId);
    const memories = await this.fetchMemories(topCandidateIds);

    if (memories.length === 0) {
      return { memories: [], formattedContext: '' };
    }

    // Stage 3: Cross-encoder reranking (top 20 → top maxResults)
    const maxResults = config.maxResults ?? 8;
    const reranked = await this.reranker.rerank(
      query,
      memories.map((m) => ({
        memoryId: m.id,
        content: `[${m.type}] ${m.relatedFiles.join(', ')}: ${m.content}`,
      })),
      maxResults,
    );

    // Re-order memories by reranker score
    const rerankedMemories = reranked
      .map((r) => memories.find((m) => m.id === r.memoryId))
      .filter((m): m is Memory => m !== undefined);

    // Stage 4: Phase-aware context packing
    const formattedContext = packContext(rerankedMemories, config.phase);

    return { memories: rerankedMemories, formattedContext };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async fetchMemories(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');

    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM memories WHERE id IN (${placeholders}) AND deprecated = 0`,
        args: ids,
      });

      // Preserve the order from the ids array (RRF ranking order)
      const byId = new Map<string, Memory>();
      for (const row of result.rows) {
        const memory = this.rowToMemory(row as Record<string, unknown>);
        byId.set(memory.id, memory);
      }

      return ids.map((id) => byId.get(id)).filter((m): m is Memory => m !== undefined);
    } catch {
      return [];
    }
  }

  private rowToMemory(row: Record<string, unknown>): Memory {
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
      type: row.type as Memory['type'],
      content: row.content as string,
      confidence: (row.confidence as number) ?? 0.8,
      tags: parseJson<string[]>(row.tags, []),
      relatedFiles: parseJson<string[]>(row.related_files, []),
      relatedModules: parseJson<string[]>(row.related_modules, []),
      createdAt: row.created_at as string,
      lastAccessedAt: row.last_accessed_at as string,
      accessCount: (row.access_count as number) ?? 0,
      scope: (row.scope as Memory['scope']) ?? 'global',
      source: (row.source as Memory['source']) ?? 'agent_explicit',
      sessionId: (row.session_id as string) ?? '',
      commitSha: (row.commit_sha as string | null) ?? undefined,
      provenanceSessionIds: parseJson<string[]>(row.provenance_session_ids, []),
      targetNodeId: (row.target_node_id as string | null) ?? undefined,
      impactedNodeIds: parseJson<string[]>(row.impacted_node_ids, []),
      relations: parseJson(row.relations, []),
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
        ? parseJson(row.work_unit_ref, undefined)
        : undefined,
      methodology: (row.methodology as string | null) ?? undefined,
    };
  }
}
