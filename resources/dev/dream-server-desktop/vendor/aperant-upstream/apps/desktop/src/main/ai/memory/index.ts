/**
 * Memory Module — Barrel Export
 */

export * from './types';
export * from './schema';
export { MemoryServiceImpl } from './memory-service';
export { getMemoryClient, closeMemoryClient, getWebMemoryClient, getInMemoryClient } from './db';
export {
  EmbeddingService,
  buildContextualText,
  buildMemoryContextualText,
} from './embedding-service';
export type { EmbeddingProvider, ASTChunk } from './embedding-service';
export * from './observer';
export {
  TreeSitterLoader,
  ASTExtractor,
  chunkFileByAST,
  GraphDatabase,
  makeNodeId,
  makeEdgeId,
  IncrementalIndexer,
  analyzeImpact,
  formatImpactResult,
} from './graph';
export type {
  ExtractedNode,
  ExtractedEdge,
  ExtractionResult,
  ImpactResult as GraphImpactResult,
} from './graph';
export * from './injection';
export * from './ipc';
export * from './tools';
export {
  detectQueryType,
  QUERY_TYPE_WEIGHTS,
  searchBM25,
  searchDense,
  searchGraph,
  weightedRRF,
  applyGraphNeighborhoodBoost,
  Reranker,
  packContext,
  estimateTokens,
  DEFAULT_PACKING_CONFIG,
  hydeSearch,
  RetrievalPipeline,
} from './retrieval';
export type {
  QueryType,
  BM25Result,
  DenseResult,
  GraphSearchResult,
  RankedResult,
  RRFPath,
  RerankerProvider,
  RerankerCandidate,
  RerankerResult,
  ContextPackingConfig,
  RetrievalConfig,
  RetrievalResult,
} from './retrieval';
