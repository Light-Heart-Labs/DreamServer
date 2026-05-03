/**
 * Query Type Classifier
 *
 * Detects the type of a retrieval query to apply optimal
 * retrieval path weights in the RRF fusion stage.
 */

export type QueryType = 'identifier' | 'semantic' | 'structural';

/**
 * Detect query type from the query string and optional recent tool call context.
 *
 * - identifier: camelCase, snake_case, or file paths — favour BM25 + graph
 * - structural: user recently used graph analysis tools — favour graph path
 * - semantic: natural language questions — favour dense vector search
 */
export function detectQueryType(query: string, recentToolCalls?: string[]): QueryType {
  // Identifier: camelCase, snake_case, or file paths (with / or .)
  if (/[a-z][A-Z]|_[a-z]/.test(query) || query.includes('/') || query.includes('.')) {
    return 'identifier';
  }

  // Structural: recent tool calls include graph analysis operations
  if (
    recentToolCalls?.some(
      (t) => t === 'analyzeImpact' || t === 'getDependencies',
    )
  ) {
    return 'structural';
  }

  return 'semantic';
}

/**
 * Query-type-dependent weights for Weighted RRF fusion.
 * Weights sum to 1.0 per query type.
 */
export const QUERY_TYPE_WEIGHTS: Record<
  QueryType,
  { fts: number; dense: number; graph: number }
> = {
  identifier: { fts: 0.5, dense: 0.2, graph: 0.3 },
  semantic:   { fts: 0.25, dense: 0.5, graph: 0.25 },
  structural: { fts: 0.25, dense: 0.15, graph: 0.6 },
};
