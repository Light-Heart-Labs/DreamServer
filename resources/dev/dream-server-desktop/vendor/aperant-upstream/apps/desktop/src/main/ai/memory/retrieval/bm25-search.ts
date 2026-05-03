/**
 * BM25 / FTS5 Search
 *
 * Uses SQLite FTS5 MATCH syntax with BM25 scoring.
 * FTS5 is used in ALL modes (local and cloud) — NOT Tantivy.
 */

import type { Client } from '@libsql/client';

export interface BM25Result {
  memoryId: string;
  bm25Score: number;
}

/**
 * Search memories using FTS5 BM25 full-text search.
 *
 * Note: FTS5 bm25() returns negative values (lower = better match).
 * Results are ordered ascending (most negative first = best match).
 *
 * @param db - libSQL client
 * @param query - User query string (FTS5 MATCH syntax)
 * @param projectId - Scope search to this project
 * @param limit - Maximum number of results to return
 */
export async function searchBM25(
  db: Client,
  query: string,
  projectId: string,
  limit: number = 100,
): Promise<BM25Result[]> {
  try {
    // Sanitize query for FTS5: wrap in quotes if it contains special chars
    const sanitizedQuery = sanitizeFtsQuery(query);

    const result = await db.execute({
      sql: `SELECT m.id, bm25(memories_fts) AS bm25_score
        FROM memories_fts
        JOIN memories m ON memories_fts.memory_id = m.id
        WHERE memories_fts MATCH ?
          AND m.project_id = ?
          AND m.deprecated = 0
        ORDER BY bm25_score
        LIMIT ?`,
      args: [sanitizedQuery, projectId, limit],
    });

    return result.rows.map((r) => ({
      memoryId: r.id as string,
      bm25Score: r.bm25_score as number,
    }));
  } catch {
    // FTS5 MATCH can fail on malformed queries — return empty result gracefully
    return [];
  }
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * FTS5 special characters: " ( ) * : ^ + -
 * If query contains special chars beyond word boundaries, quote the whole thing.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '""';

  // If already looks like a valid FTS5 query with operators, pass through
  if (/^["(]/.test(trimmed)) return trimmed;

  // Simple word-only query: safe to pass through
  if (/^[\w\s]+$/.test(trimmed)) return trimmed;

  // Otherwise: quote the phrase to prevent FTS5 parse errors
  const escaped = trimmed.replace(/"/g, '""');
  return `"${escaped}"`;
}
