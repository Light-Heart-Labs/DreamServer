/**
 * Weighted Reciprocal Rank Fusion
 *
 * Merges ranked lists from multiple retrieval paths (BM25, dense, graph)
 * using weighted RRF. All merging is done application-side — no FULL OUTER JOIN.
 *
 * RRF formula: score = weight / (k + rank + 1)
 * Standard k=60 prevents high-rank outliers from dominating.
 */

export interface RankedResult {
  memoryId: string;
  score: number;
  sources: Set<string>; // which retrieval paths contributed
}

export interface RRFPath {
  results: Array<{ memoryId: string }>;
  weight: number;
  name: string;
}

/**
 * Weighted Reciprocal Rank Fusion.
 *
 * Merges multiple ranked result lists into a single unified ranking.
 * Each path contributes `weight / (k + rank + 1)` per result.
 *
 * @param paths - Array of ranked result lists with their weights and names
 * @param k - RRF constant (default: 60); higher values reduce rank sensitivity
 */
export function weightedRRF(paths: RRFPath[], k: number = 60): RankedResult[] {
  const scores = new Map<string, { score: number; sources: Set<string> }>();

  for (const { results, weight, name } of paths) {
    results.forEach((r, rank) => {
      const contribution = weight / (k + rank + 1);
      const existing = scores.get(r.memoryId);
      if (existing) {
        existing.score += contribution;
        existing.sources.add(name);
      } else {
        scores.set(r.memoryId, {
          score: contribution,
          sources: new Set([name]),
        });
      }
    });
  }

  return [...scores.entries()]
    .map(([memoryId, { score, sources }]) => ({ memoryId, score, sources }))
    .sort((a, b) => b.score - a.score);
}
