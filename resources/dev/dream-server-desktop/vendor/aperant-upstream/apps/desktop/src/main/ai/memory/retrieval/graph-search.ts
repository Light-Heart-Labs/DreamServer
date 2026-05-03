/**
 * Knowledge Graph Search
 *
 * Three retrieval sub-paths:
 *   1. File-scoped: memories tagged to recently-accessed files
 *   2. Co-access: memories for files co-accessed with recent files
 *   3. Closure neighbors: memories for files 1-hop away in the dependency graph
 */

import type { Client } from '@libsql/client';

export interface GraphSearchResult {
  memoryId: string;
  graphScore: number;
  reason: 'co_access' | 'closure_neighbor' | 'file_scoped';
}

/**
 * Search memories using knowledge graph traversal.
 *
 * @param db - libSQL client
 * @param recentFiles - File paths recently accessed by the agent
 * @param projectId - Scope search to this project
 * @param limit - Maximum number of deduplicated results to return
 */
export async function searchGraph(
  db: Client,
  recentFiles: string[],
  projectId: string,
  limit: number = 15,
): Promise<GraphSearchResult[]> {
  const results: GraphSearchResult[] = [];

  if (recentFiles.length === 0) return results;

  // Path 1: File-scoped memories (directly tagged to recent files)
  await collectFileScopedMemories(db, recentFiles, projectId, results, limit);

  // Path 2: Co-access neighbors (files frequently co-accessed with recent files)
  await collectCoAccessMemories(db, recentFiles, projectId, results);

  // Path 3: Closure table 1-hop neighbors (structural dependencies)
  await collectClosureNeighborMemories(db, recentFiles, projectId, results);

  // Deduplicate — keep highest-scored entry per memoryId
  const seen = new Map<string, GraphSearchResult>();
  for (const r of results) {
    const existing = seen.get(r.memoryId);
    if (!existing || r.graphScore > existing.graphScore) {
      seen.set(r.memoryId, r);
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.graphScore - a.graphScore)
    .slice(0, limit);
}

// ============================================================
// SUB-PATH HELPERS
// ============================================================

async function collectFileScopedMemories(
  db: Client,
  recentFiles: string[],
  projectId: string,
  results: GraphSearchResult[],
  limit: number,
): Promise<void> {
  try {
    const placeholders = recentFiles.map(() => '?').join(',');
    const fileScoped = await db.execute({
      sql: `SELECT DISTINCT m.id FROM memories m
        WHERE m.project_id = ?
          AND m.deprecated = 0
          AND EXISTS (
            SELECT 1 FROM json_each(m.related_files) je
            WHERE je.value IN (${placeholders})
          )
        LIMIT ?`,
      args: [projectId, ...recentFiles, limit],
    });

    for (const row of fileScoped.rows) {
      results.push({
        memoryId: row.id as string,
        graphScore: 0.8,
        reason: 'file_scoped',
      });
    }
  } catch {
    // json_each may not be available in all libSQL versions — skip gracefully
  }
}

async function collectCoAccessMemories(
  db: Client,
  recentFiles: string[],
  projectId: string,
  results: GraphSearchResult[],
): Promise<void> {
  try {
    const placeholders = recentFiles.map(() => '?').join(',');
    const coAccess = await db.execute({
      sql: `SELECT DISTINCT file_b AS neighbor, weight
        FROM observer_co_access_edges
        WHERE file_a IN (${placeholders})
          AND project_id = ?
          AND weight > 0.3
        ORDER BY weight DESC
        LIMIT 10`,
      args: [...recentFiles, projectId],
    });

    for (const row of coAccess.rows) {
      const neighbor = row.neighbor as string;
      const weight = row.weight as number;

      // Get memories for this co-accessed file
      const neighborMemories = await db.execute({
        sql: `SELECT id FROM memories
          WHERE project_id = ?
            AND deprecated = 0
            AND related_files LIKE ?
          LIMIT 5`,
        args: [projectId, `%${neighbor}%`],
      });

      for (const m of neighborMemories.rows) {
        results.push({
          memoryId: m.id as string,
          graphScore: weight * 0.7,
          reason: 'co_access',
        });
      }
    }
  } catch {
    // Skip if observer_co_access_edges is empty or query fails
  }
}

async function collectClosureNeighborMemories(
  db: Client,
  recentFiles: string[],
  projectId: string,
  results: GraphSearchResult[],
): Promise<void> {
  try {
    const placeholders = recentFiles.map(() => '?').join(',');
    const closureNeighbors = await db.execute({
      sql: `SELECT DISTINCT gc.descendant_id
        FROM graph_closure gc
        JOIN graph_nodes gn ON gc.ancestor_id = gn.id
        WHERE gn.file_path IN (${placeholders})
          AND gn.project_id = ?
          AND gc.depth = 1
        LIMIT 15`,
      args: [...recentFiles, projectId],
    });

    for (const row of closureNeighbors.rows) {
      const nodeId = row.descendant_id as string;

      const nodeMemories = await db.execute({
        sql: `SELECT id FROM memories
          WHERE project_id = ?
            AND deprecated = 0
            AND target_node_id = ?
          LIMIT 3`,
        args: [projectId, nodeId],
      });

      for (const m of nodeMemories.rows) {
        results.push({
          memoryId: m.id as string,
          graphScore: 0.6,
          reason: 'closure_neighbor',
        });
      }
    }
  } catch {
    // Skip if graph tables are empty or query fails
  }
}
