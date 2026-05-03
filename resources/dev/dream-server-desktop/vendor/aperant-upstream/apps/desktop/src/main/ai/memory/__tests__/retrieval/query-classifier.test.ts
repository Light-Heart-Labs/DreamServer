/**
 * query-classifier.test.ts — Test query type detection
 */

import { describe, it, expect } from 'vitest';
import { detectQueryType, QUERY_TYPE_WEIGHTS } from '../../retrieval/query-classifier';

describe('detectQueryType', () => {
  describe('identifier queries', () => {
    it('detects camelCase identifiers', () => {
      expect(detectQueryType('getUserProfile')).toBe('identifier');
      expect(detectQueryType('fetchMemoryClient')).toBe('identifier');
    });

    it('detects snake_case identifiers', () => {
      expect(detectQueryType('get_user_profile')).toBe('identifier');
      expect(detectQueryType('memory_client')).toBe('identifier');
    });

    it('detects file paths with forward slash', () => {
      expect(detectQueryType('src/main/index.ts')).toBe('identifier');
      expect(detectQueryType('apps/desktop/src/main/ai')).toBe('identifier');
    });

    it('detects file paths with extension', () => {
      expect(detectQueryType('index.ts')).toBe('identifier');
      expect(detectQueryType('package.json')).toBe('identifier');
    });
  });

  describe('structural queries', () => {
    it('detects structural when recent tool calls include analyzeImpact', () => {
      expect(detectQueryType('dependencies', ['analyzeImpact'])).toBe('structural');
    });

    it('detects structural when recent tool calls include getDependencies', () => {
      expect(detectQueryType('what uses this function', ['getDependencies'])).toBe('structural');
    });

    it('structural overrides only when no identifier signal', () => {
      // camelCase wins over structural tool calls
      expect(detectQueryType('getUserProfile', ['analyzeImpact'])).toBe('identifier');
    });
  });

  describe('semantic queries', () => {
    it('detects natural language queries as semantic', () => {
      expect(detectQueryType('how does authentication work')).toBe('semantic');
      expect(detectQueryType('why does the build fail')).toBe('semantic');
      expect(detectQueryType('what is the error handling strategy')).toBe('semantic');
    });

    it('falls back to semantic with no special signals', () => {
      expect(detectQueryType('database migration pattern')).toBe('semantic');
    });

    it('falls back to semantic with empty recentToolCalls', () => {
      expect(detectQueryType('connection pooling', [])).toBe('semantic');
    });
  });
});

describe('QUERY_TYPE_WEIGHTS', () => {
  it('has weights for all three query types', () => {
    expect(QUERY_TYPE_WEIGHTS.identifier).toBeDefined();
    expect(QUERY_TYPE_WEIGHTS.semantic).toBeDefined();
    expect(QUERY_TYPE_WEIGHTS.structural).toBeDefined();
  });

  it('each weight set has fts, dense, and graph keys', () => {
    for (const weights of Object.values(QUERY_TYPE_WEIGHTS)) {
      expect(weights).toHaveProperty('fts');
      expect(weights).toHaveProperty('dense');
      expect(weights).toHaveProperty('graph');
    }
  });

  it('weights sum to 1.0 for each query type', () => {
    for (const [type, weights] of Object.entries(QUERY_TYPE_WEIGHTS)) {
      const sum = weights.fts + weights.dense + weights.graph;
      expect(sum).toBeCloseTo(1.0, 2);
      expect(type).toBeTruthy(); // type string used to identify failure
    }
  });

  it('identifier type favours BM25 (fts highest)', () => {
    const w = QUERY_TYPE_WEIGHTS.identifier;
    expect(w.fts).toBeGreaterThan(w.dense);
    expect(w.fts).toBeGreaterThan(w.graph);
  });

  it('semantic type favours dense search', () => {
    const w = QUERY_TYPE_WEIGHTS.semantic;
    expect(w.dense).toBeGreaterThan(w.fts);
    expect(w.dense).toBeGreaterThan(w.graph);
  });

  it('structural type favours graph search', () => {
    const w = QUERY_TYPE_WEIGHTS.structural;
    expect(w.graph).toBeGreaterThan(w.fts);
    expect(w.graph).toBeGreaterThan(w.dense);
  });
});
