/**
 * Graph Neighborhood Boost
 *
 * The unique competitive advantage of the memory system.
 * After initial RRF fusion, boost candidates that share file-graph neighborhood
 * with the top-K results. This promotes structurally-related memories even when
 * they don't score well on text similarity alone.
 *
 * Algorithm:
 *   1. Get related_files from top-K RRF results
 *   2. Query closure table for 1-hop file neighbors
 *   3. Boost remaining candidates whose related_files overlap with neighbor set
 *   4. Re-rank with boosted scores
 */

import type { Client } from '@libsql/client';
import type { RankedResult } from './rrf-fusion';

const GRAPH_BOOST_FACTOR = 0.3;

/**
 * Apply graph neighborhood boost to candidates below the top-K cut.
 *
 * @param db - libSQL client
 * @param rankedCandidates - Results from weightedRRF, sorted by descending score
 * @param projectId - Scope to this project
 * @param topK - Number of top results to use as reference anchors
 */
export async function applyGraphNeighborhoodBoost(
  db: Client,
  rankedCandidates: RankedResult[],
  projectId: string,
  topK: number = 10,
): Promise<RankedResult[]> {
  if (rankedCandidates.length <= topK) return rankedCandidates;

  // Step 1: Batch-fetch related_files for ALL candidates in one query
  const allIds = rankedCandidates.map((r) => r.memoryId);
  const placeholders = allIds.map(() => '?').join(',');

  let relatedFilesMap: Map<string, string[]>;
  try {
    const memoriesResult = await db.execute({
      sql: `SELECT id, related_files FROM memories WHERE id IN (${placeholders})`,
      args: allIds,
    });

    relatedFilesMap = new Map();
    for (const row of memoriesResult.rows) {
      try {
        const files = JSON.parse((row.related_files as string) ?? '[]') as string[];
        relatedFilesMap.set(row.id as string, files);
      } catch {
        relatedFilesMap.set(row.id as string, []);
      }
    }
  } catch {
    // DB query failed — return original ranking unchanged
    return rankedCandidates;
  }

  // Step 2: Collect file paths from top-K results
  const topFiles: string[] = [];
  for (const candidate of rankedCandidates.slice(0, topK)) {
    const files = relatedFilesMap.get(candidate.memoryId) ?? [];
    topFiles.push(...files);
  }

  if (topFiles.length === 0) return rankedCandidates;

  // Step 3: Query closure table for 1-hop neighbors of top-file set
  const neighborFiles = new Set<string>();
  try {
    const filePlaceholders = topFiles.map(() => '?').join(',');
    const neighbors = await db.execute({
      sql: `SELECT DISTINCT gn2.file_path
        FROM graph_closure gc
        JOIN graph_nodes gn ON gc.ancestor_id = gn.id
        JOIN graph_nodes gn2 ON gc.descendant_id = gn2.id
        WHERE gn.file_path IN (${filePlaceholders})
          AND gn.project_id = ?
          AND gc.depth = 1
          AND gn2.file_path IS NOT NULL`,
      args: [...topFiles, projectId],
    });

    for (const row of neighbors.rows) {
      if (row.file_path) neighborFiles.add(row.file_path as string);
    }
  } catch {
    // Graph tables may be empty — skip boost gracefully
    return rankedCandidates;
  }

  if (neighborFiles.size === 0) return rankedCandidates;

  // Step 4: Apply boost to candidates below top-K that overlap with neighbor set
  const topFilesSet = new Set(topFiles);
  const boosted: RankedResult[] = rankedCandidates.map((candidate, rank) => {
    if (rank < topK) return candidate;

    const candidateFiles = relatedFilesMap.get(candidate.memoryId) ?? [];
    const neighborOverlap = candidateFiles.filter(
      (f) => neighborFiles.has(f) && !topFilesSet.has(f),
    ).length;

    if (neighborOverlap === 0) return candidate;

    const boostAmount =
      GRAPH_BOOST_FACTOR * (neighborOverlap / Math.max(topFiles.length, 1));

    return { ...candidate, score: candidate.score + boostAmount };
  });

  return boosted.sort((a, b) => b.score - a.score);
}
