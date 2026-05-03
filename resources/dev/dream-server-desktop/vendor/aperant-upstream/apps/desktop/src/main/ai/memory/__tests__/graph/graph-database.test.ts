/**
 * Tests for GraphDatabase — CRUD, closure table, impact analysis.
 * Uses in-memory libSQL client (no Electron dependency).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getInMemoryClient } from '../../db';
import { GraphDatabase, makeNodeId, makeEdgeId } from '../../graph/graph-database';
import type { Client } from '@libsql/client';

let db: Client;
let graphDb: GraphDatabase;

const PROJECT_ID = 'test-project';

beforeEach(async () => {
  db = await getInMemoryClient();
  graphDb = new GraphDatabase(db);
});

// ============================================================
// NODE OPERATIONS
// ============================================================

describe('GraphDatabase - Nodes', () => {
  it('upserts a file node and retrieves it', async () => {
    const id = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/auth/tokens.ts',
      filePath: 'src/auth/tokens.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 100,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    expect(id).toBeTruthy();
    expect(id).toHaveLength(32);

    const node = await graphDb.getNode(id);
    expect(node).not.toBeNull();
    expect(node?.label).toBe('src/auth/tokens.ts');
    expect(node?.type).toBe('file');
    expect(node?.projectId).toBe(PROJECT_ID);
  });

  it('generates deterministic IDs', () => {
    const id1 = makeNodeId(PROJECT_ID, 'src/foo.ts', 'src/foo.ts', 'file');
    const id2 = makeNodeId(PROJECT_ID, 'src/foo.ts', 'src/foo.ts', 'file');
    expect(id1).toBe(id2);
  });

  it('different inputs produce different IDs', () => {
    const id1 = makeNodeId(PROJECT_ID, 'src/foo.ts', 'src/foo.ts', 'file');
    const id2 = makeNodeId(PROJECT_ID, 'src/bar.ts', 'src/bar.ts', 'file');
    expect(id1).not.toBe(id2);
  });

  it('upsert updates existing node', async () => {
    await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'function',
      label: 'src/foo.ts:myFn',
      filePath: 'src/foo.ts',
      language: 'typescript',
      startLine: 10,
      endLine: 20,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    // Upsert again with updated line numbers
    const id = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'function',
      label: 'src/foo.ts:myFn',
      filePath: 'src/foo.ts',
      language: 'typescript',
      startLine: 15, // changed
      endLine: 25,   // changed
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const node = await graphDb.getNode(id);
    expect(node?.startLine).toBe(15);
    expect(node?.endLine).toBe(25);
  });

  it('gets nodes by file path', async () => {
    await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/auth.ts',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 50,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'function',
      label: 'src/auth.ts:login',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 5,
      endLine: 20,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const nodes = await graphDb.getNodesByFile(PROJECT_ID, 'src/auth.ts');
    expect(nodes).toHaveLength(2);
  });

  it('marks file nodes as stale', async () => {
    const id = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/stale.ts',
      filePath: 'src/stale.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 30,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    await graphDb.markFileNodesStale(PROJECT_ID, 'src/stale.ts');

    const node = await graphDb.getNode(id);
    expect(node?.staleAt).toBeDefined();
    expect(node?.staleAt).toBeGreaterThan(0);
  });
});

// ============================================================
// EDGE OPERATIONS
// ============================================================

describe('GraphDatabase - Edges', () => {
  it('upserts an import edge', async () => {
    const fromId = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/app.ts',
      filePath: 'src/app.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 100,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const toId = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/auth.ts',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 50,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const edgeId = await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId,
      toId,
      type: 'imports',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(edgeId).toBeTruthy();

    const edges = await graphDb.getEdgesFrom(fromId);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('imports');
    expect(edges[0].toId).toBe(toId);
  });

  it('gets edges pointing to a node', async () => {
    const fromId = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/a.ts',
      filePath: 'src/a.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const toId = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'src/b.ts',
      filePath: 'src/b.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId,
      toId,
      type: 'imports',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const inbound = await graphDb.getEdgesTo(toId);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromId).toBe(fromId);
  });

  it('makes edge IDs deterministic', () => {
    const id1 = makeEdgeId(PROJECT_ID, 'a', 'b', 'imports');
    const id2 = makeEdgeId(PROJECT_ID, 'a', 'b', 'imports');
    expect(id1).toBe(id2);
  });
});

// ============================================================
// CLOSURE TABLE
// ============================================================

describe('GraphDatabase - Closure Table', () => {
  it('rebuilds closure for simple chain A→B→C', async () => {
    const nodeA = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'a.ts',
      filePath: 'a.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const nodeB = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'b.ts',
      filePath: 'b.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const nodeC = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'c.ts',
      filePath: 'c.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    // A imports B, B imports C
    await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId: nodeA,
      toId: nodeB,
      type: 'imports',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId: nodeB,
      toId: nodeC,
      type: 'imports',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await graphDb.rebuildClosure(PROJECT_ID);

    // A should have B (depth 1) and C (depth 2) as descendants
    const descendantsOfA = await graphDb.getDescendants(nodeA, 5);
    expect(descendantsOfA.length).toBeGreaterThanOrEqual(2);

    const bEntry = descendantsOfA.find(d => d.descendantId === nodeB);
    const cEntry = descendantsOfA.find(d => d.descendantId === nodeC);

    expect(bEntry).toBeDefined();
    expect(bEntry?.depth).toBe(1);
    expect(cEntry).toBeDefined();
    expect(cEntry?.depth).toBe(2);
  });

  it('respects maxDepth parameter', async () => {
    // Create chain A→B→C→D
    const ids: string[] = [];
    for (const label of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      const id = await graphDb.upsertNode({
        projectId: PROJECT_ID,
        type: 'file',
        label,
        filePath: label,
        language: 'typescript',
        startLine: 1,
        endLine: 10,
        layer: 1,
        source: 'ast',
        confidence: 'inferred',
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        associatedMemoryIds: [],
      });
      ids.push(id);
    }

    for (let i = 0; i < ids.length - 1; i++) {
      await graphDb.upsertEdge({
        projectId: PROJECT_ID,
        fromId: ids[i],
        toId: ids[i + 1],
        type: 'imports',
        layer: 1,
        weight: 1.0,
        source: 'ast',
        confidence: 1.0,
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await graphDb.rebuildClosure(PROJECT_ID);

    const depth1Only = await graphDb.getDescendants(ids[0], 1);
    expect(depth1Only.every(d => d.depth <= 1)).toBe(true);

    const depth2 = await graphDb.getDescendants(ids[0], 2);
    expect(depth2.some(d => d.depth === 2)).toBe(true);
    expect(depth2.every(d => d.depth <= 2)).toBe(true);
  });

  it('gets ancestors correctly', async () => {
    const nodeA = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'root.ts',
      filePath: 'root.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const nodeB = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'file',
      label: 'child.ts',
      filePath: 'child.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId: nodeA,
      toId: nodeB,
      type: 'imports',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await graphDb.rebuildClosure(PROJECT_ID);

    const ancestors = await graphDb.getAncestors(nodeB, 3);
    expect(ancestors.some(a => a.ancestorId === nodeA)).toBe(true);
  });
});

// ============================================================
// INDEX STATE
// ============================================================

describe('GraphDatabase - Index State', () => {
  it('creates and retrieves index state', async () => {
    await graphDb.updateIndexState(PROJECT_ID, {
      lastIndexedAt: 1000,
      nodeCount: 42,
      edgeCount: 100,
      staleEdgeCount: 5,
      indexVersion: 1,
    });

    const state = await graphDb.getIndexState(PROJECT_ID);
    expect(state).not.toBeNull();
    expect(state?.projectId).toBe(PROJECT_ID);
    expect(state?.nodeCount).toBe(42);
  });

  it('updates existing index state', async () => {
    await graphDb.updateIndexState(PROJECT_ID, {
      lastIndexedAt: 1000,
      nodeCount: 10,
      edgeCount: 20,
      staleEdgeCount: 0,
    });

    await graphDb.updateIndexState(PROJECT_ID, {
      nodeCount: 20,
    });

    const state = await graphDb.getIndexState(PROJECT_ID);
    expect(state?.nodeCount).toBe(20);
  });

  it('returns null for missing project', async () => {
    const state = await graphDb.getIndexState('nonexistent-project');
    expect(state).toBeNull();
  });
});

// ============================================================
// IMPACT ANALYSIS
// ============================================================

describe('GraphDatabase - Impact Analysis', () => {
  it('returns empty result for unknown target', async () => {
    const result = await graphDb.analyzeImpact('unknown:symbol', PROJECT_ID, 3);
    expect(result.target.nodeId).toBe('');
    expect(result.directDependents).toHaveLength(0);
    expect(result.transitiveDependents).toHaveLength(0);
  });

  it('finds direct dependents', async () => {
    const fnNode = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'function',
      label: 'src/auth.ts:verifyJwt',
      filePath: 'src/auth.ts',
      language: 'typescript',
      startLine: 10,
      endLine: 30,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    const callerNode = await graphDb.upsertNode({
      projectId: PROJECT_ID,
      type: 'function',
      label: 'src/middleware.ts:authMiddleware',
      filePath: 'src/middleware.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 20,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      associatedMemoryIds: [],
    });

    await graphDb.upsertEdge({
      projectId: PROJECT_ID,
      fromId: callerNode,
      toId: fnNode,
      type: 'calls',
      layer: 1,
      weight: 1.0,
      source: 'ast',
      confidence: 1.0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await graphDb.analyzeImpact('src/auth.ts:verifyJwt', PROJECT_ID, 3);
    expect(result.target.nodeId).toBe(fnNode);
    expect(result.directDependents).toHaveLength(1);
    expect(result.directDependents[0].label).toBe('src/middleware.ts:authMiddleware');
    expect(result.directDependents[0].edgeType).toBe('calls');
  });
});
