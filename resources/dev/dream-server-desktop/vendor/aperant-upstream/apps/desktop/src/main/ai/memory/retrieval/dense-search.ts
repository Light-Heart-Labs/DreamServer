/**
 * Dense Vector Search
 *
 * Attempts libsql's native vector_distance_cos() for cosine similarity search.
 * Falls back to JS-side cosine similarity if the native query fails (e.g. when
 * embeddings are stored as plain BLOBs rather than F32_BLOB typed columns).
 */

import type { Client } from '@libsql/client';
import type { EmbeddingService } from '../embedding-service';

export interface DenseResult {
  memoryId: string;
  distance: number;
}

/**
 * Search memories using dense vector similarity.
 *
 * Attempts sqlite-vec vector_distance_cos first; falls back to JS-side
 * cosine similarity if the extension query fails.
 *
 * @param db - libSQL client
 * @param query - Query text to embed and search with
 * @param embeddingService - Service for computing query embedding
 * @param projectId - Scope search to this project
 * @param dims - Embedding dimension: 256 for fast candidate gen, 1024 for precision
 * @param limit - Maximum number of results to return
 */
export async function searchDense(
  db: Client,
  query: string,
  embeddingService: EmbeddingService,
  projectId: string,
  dims: 256 | 1024 = 256,
  limit: number = 30,
): Promise<DenseResult[]> {
  const queryEmbedding = await embeddingService.embed(query, dims);

  // Attempt libsql native vector_distance_cos query.
  // Falls back to JS-side cosine similarity if the query fails.
  try {
    const embeddingBlob = serializeEmbedding(queryEmbedding);

    const result = await db.execute({
      sql: `SELECT me.memory_id, vector_distance_cos(me.embedding, ?) AS distance
        FROM memory_embeddings me
        JOIN memories m ON me.memory_id = m.id
        WHERE m.project_id = ?
          AND m.deprecated = 0
          AND me.dims = ?
        ORDER BY distance ASC
        LIMIT ?`,
      args: [embeddingBlob, projectId, dims, limit],
    });

    return result.rows.map((r) => ({
      memoryId: r.memory_id as string,
      distance: r.distance as number,
    }));
  } catch {
    // Native vector query failed — use JS-side cosine similarity
    return searchDenseJsFallback(db, queryEmbedding, projectId, dims, limit);
  }
}

/**
 * JS-side cosine similarity fallback.
 * Fetches all embeddings for the project and computes similarity in-process.
 * Suitable for small datasets; for large datasets sqlite-vec is strongly preferred.
 */
async function searchDenseJsFallback(
  db: Client,
  queryEmbedding: number[],
  projectId: string,
  dims: number,
  limit: number,
): Promise<DenseResult[]> {
  const result = await db.execute({
    sql: `SELECT me.memory_id, me.embedding
      FROM memory_embeddings me
      JOIN memories m ON me.memory_id = m.id
      WHERE m.project_id = ?
        AND m.deprecated = 0
        AND me.dims = ?`,
    args: [projectId, dims],
  });

  const scored: DenseResult[] = [];

  for (const row of result.rows) {
    const rawEmbedding = row.embedding;
    if (!rawEmbedding) continue;

    const storedEmbedding = deserializeEmbedding(rawEmbedding as ArrayBuffer);
    const distance = cosineDistance(queryEmbedding, storedEmbedding);

    scored.push({
      memoryId: row.memory_id as string,
      distance,
    });
  }

  return scored.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

// ============================================================
// EMBEDDING SERIALIZATION HELPERS
// ============================================================

function serializeEmbedding(embedding: number[]): Buffer {
  const buf = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

function deserializeEmbedding(buf: ArrayBuffer | Buffer | Uint8Array): number[] {
  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
  const result: number[] = [];
  for (let i = 0; i < view.length; i += 4) {
    result.push(view.readFloatLE(i));
  }
  return result;
}

/**
 * Cosine distance (1 - cosine similarity).
 * Returns 0.0 for identical vectors, 2.0 for opposite vectors.
 */
function cosineDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return 1 - dot / denom;
}
