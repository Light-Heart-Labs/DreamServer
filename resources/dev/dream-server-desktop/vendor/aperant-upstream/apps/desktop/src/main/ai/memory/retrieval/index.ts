/**
 * Retrieval Module — Barrel Export
 */

export { detectQueryType, QUERY_TYPE_WEIGHTS } from './query-classifier';
export type { QueryType } from './query-classifier';

export { searchBM25 } from './bm25-search';
export type { BM25Result } from './bm25-search';

export { searchDense } from './dense-search';
export type { DenseResult } from './dense-search';

export { searchGraph } from './graph-search';
export type { GraphSearchResult } from './graph-search';

export { weightedRRF } from './rrf-fusion';
export type { RankedResult, RRFPath } from './rrf-fusion';

export { applyGraphNeighborhoodBoost } from './graph-boost';

export { Reranker } from './reranker';
export type { RerankerProvider, RerankerCandidate, RerankerResult } from './reranker';

export { packContext, estimateTokens, DEFAULT_PACKING_CONFIG } from './context-packer';
export type { ContextPackingConfig } from './context-packer';

export { hydeSearch } from './hyde';

export { RetrievalPipeline } from './pipeline';
export type { RetrievalConfig, RetrievalResult } from './pipeline';
