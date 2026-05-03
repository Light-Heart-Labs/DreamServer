/**
 * Graph Database
 *
 * CRUD operations for graph_nodes, graph_edges, and graph_closure tables.
 * Uses @libsql/client async API throughout.
 *
 * Key design:
 * - Node IDs are deterministic: sha256(projectId:filePath:label:type)
 * - Closure table enables O(1) impact analysis
 * - Staleness model: stale_at IS NULL = fresh edge
 */

import type { Client } from '@libsql/client';
import { createHash } from 'crypto';
import type {
  GraphNode,
  GraphEdge,
  ClosureEntry,
  GraphIndexState,
  GraphNodeType,
  GraphEdgeType,
  GraphNodeSource,
  GraphNodeConfidence,
  ImpactResult,
} from '../types';

/** Maximum depth for closure table traversal (prevents quadratic growth). */
const MAX_CLOSURE_DEPTH = 5;

/**
 * Generate a deterministic ID for a graph node.
 */
export function makeNodeId(projectId: string, filePath: string, label: string, type: GraphNodeType): string {
  return createHash('sha256')
    .update(`${projectId}:${filePath}:${label}:${type}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Generate a deterministic ID for a graph edge.
 */
export function makeEdgeId(projectId: string, fromId: string, toId: string, type: GraphEdgeType): string {
  return createHash('sha256')
    .update(`${projectId}:${fromId}:${toId}:${type}`)
    .digest('hex')
    .slice(0, 32);
}

// ---- Row mapping helpers ----

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as GraphNodeType,
    label: row.label as string,
    filePath: (row.file_path as string | null) ?? undefined,
    language: (row.language as string | null) ?? undefined,
    startLine: (row.start_line as number | null) ?? undefined,
    endLine: (row.end_line as number | null) ?? undefined,
    layer: (row.layer as number) ?? 1,
    source: row.source as GraphNodeSource,
    confidence: (row.confidence as GraphNodeConfidence) ?? 'inferred',
    metadata: JSON.parse((row.metadata as string) ?? '{}') as Record<string, unknown>,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    staleAt: (row.stale_at as number | null) ?? undefined,
    associatedMemoryIds: JSON.parse((row.associated_memory_ids as string) ?? '[]') as string[],
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    fromId: row.from_id as string,
    toId: row.to_id as string,
    type: row.type as GraphEdgeType,
    layer: (row.layer as number) ?? 1,
    weight: (row.weight as number) ?? 1.0,
    source: row.source as GraphNodeSource,
    confidence: (row.confidence as number) ?? 1.0,
    metadata: JSON.parse((row.metadata as string) ?? '{}') as Record<string, unknown>,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    staleAt: (row.stale_at as number | null) ?? undefined,
  };
}

function rowToClosure(row: Record<string, unknown>): ClosureEntry {
  return {
    ancestorId: row.ancestor_id as string,
    descendantId: row.descendant_id as string,
    depth: row.depth as number,
    path: JSON.parse(row.path as string) as string[],
    edgeTypes: JSON.parse(row.edge_types as string) as GraphEdgeType[],
    totalWeight: row.total_weight as number,
  };
}

export class GraphDatabase {
  constructor(private db: Client) {}

  // ============================================================
  // NODE OPERATIONS
  // ============================================================

  async upsertNode(node: Omit<GraphNode, 'id'>): Promise<string> {
    const id = makeNodeId(node.projectId, node.filePath ?? '', node.label, node.type);
    const now = Date.now();

    await this.db.execute({
      sql: `INSERT INTO graph_nodes
        (id, project_id, type, label, file_path, language, start_line, end_line,
         layer, source, confidence, metadata, created_at, updated_at, stale_at, associated_memory_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          label = excluded.label,
          file_path = excluded.file_path,
          language = excluded.language,
          start_line = excluded.start_line,
          end_line = excluded.end_line,
          layer = excluded.layer,
          source = excluded.source,
          confidence = excluded.confidence,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at,
          stale_at = excluded.stale_at,
          associated_memory_ids = excluded.associated_memory_ids`,
      args: [
        id,
        node.projectId,
        node.type,
        node.label,
        node.filePath ?? null,
        node.language ?? null,
        node.startLine ?? null,
        node.endLine ?? null,
        node.layer,
        node.source,
        node.confidence,
        JSON.stringify(node.metadata),
        node.createdAt ?? now,
        now,
        node.staleAt ?? null,
        JSON.stringify(node.associatedMemoryIds),
      ],
    });

    return id;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM graph_nodes WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToNode(result.rows[0] as unknown as Record<string, unknown>);
  }

  async getNodesByFile(projectId: string, filePath: string): Promise<GraphNode[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM graph_nodes WHERE project_id = ? AND file_path = ?',
      args: [projectId, filePath],
    });

    return result.rows.map(r => rowToNode(r as unknown as Record<string, unknown>));
  }

  async markFileNodesStale(projectId: string, filePath: string): Promise<void> {
    const now = Date.now();
    await this.db.execute({
      sql: 'UPDATE graph_nodes SET stale_at = ? WHERE project_id = ? AND file_path = ?',
      args: [now, projectId, filePath],
    });
  }

  async deleteStaleNodesForFile(projectId: string, filePath: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM graph_nodes WHERE project_id = ? AND file_path = ? AND stale_at IS NOT NULL',
      args: [projectId, filePath],
    });
  }

  // ============================================================
  // EDGE OPERATIONS
  // ============================================================

  async upsertEdge(edge: Omit<GraphEdge, 'id'>): Promise<string> {
    const id = makeEdgeId(edge.projectId, edge.fromId, edge.toId, edge.type);
    const now = Date.now();

    await this.db.execute({
      sql: `INSERT INTO graph_edges
        (id, project_id, from_id, to_id, type, layer, weight, source, confidence,
         metadata, created_at, updated_at, stale_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          layer = excluded.layer,
          weight = excluded.weight,
          source = excluded.source,
          confidence = excluded.confidence,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at,
          stale_at = excluded.stale_at`,
      args: [
        id,
        edge.projectId,
        edge.fromId,
        edge.toId,
        edge.type,
        edge.layer,
        edge.weight,
        edge.source,
        edge.confidence,
        JSON.stringify(edge.metadata),
        edge.createdAt ?? now,
        now,
        edge.staleAt ?? null,
      ],
    });

    return id;
  }

  async getEdgesFrom(nodeId: string): Promise<GraphEdge[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM graph_edges WHERE from_id = ? AND stale_at IS NULL',
      args: [nodeId],
    });

    return result.rows.map(r => rowToEdge(r as unknown as Record<string, unknown>));
  }

  async getEdgesTo(nodeId: string): Promise<GraphEdge[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM graph_edges WHERE to_id = ? AND stale_at IS NULL',
      args: [nodeId],
    });

    return result.rows.map(r => rowToEdge(r as unknown as Record<string, unknown>));
  }

  async markFileEdgesStale(projectId: string, filePath: string): Promise<void> {
    const now = Date.now();
    // Mark edges where the source node is in this file
    await this.db.execute({
      sql: `UPDATE graph_edges SET stale_at = ?
            WHERE project_id = ?
              AND from_id IN (
                SELECT id FROM graph_nodes WHERE project_id = ? AND file_path = ?
              )`,
      args: [now, projectId, projectId, filePath],
    });
  }

  async clearFileEdgesStale(projectId: string, filePath: string): Promise<void> {
    // Clear stale_at for fresh edges (after re-index)
    await this.db.execute({
      sql: `UPDATE graph_edges SET stale_at = NULL
            WHERE project_id = ?
              AND from_id IN (
                SELECT id FROM graph_nodes WHERE project_id = ? AND file_path = ?
              )`,
      args: [projectId, projectId, filePath],
    });
  }

  async deleteStaleEdgesForFile(projectId: string, filePath: string): Promise<void> {
    await this.db.execute({
      sql: `DELETE FROM graph_edges
            WHERE project_id = ? AND stale_at IS NOT NULL
              AND from_id IN (
                SELECT id FROM graph_nodes WHERE project_id = ? AND file_path = ?
              )`,
      args: [projectId, projectId, filePath],
    });
  }

  // ============================================================
  // CLOSURE TABLE
  // ============================================================

  /**
   * Rebuild the entire closure table for a project.
   * Uses recursive CTE. Safe to call from a background job.
   */
  async rebuildClosure(projectId: string): Promise<void> {
    // Delete existing closure entries for this project
    await this.db.execute({
      sql: `DELETE FROM graph_closure
            WHERE ancestor_id IN (
              SELECT id FROM graph_nodes WHERE project_id = ?
            )`,
      args: [projectId],
    });

    // Get all fresh edges for the project
    const edgesResult = await this.db.execute({
      sql: `SELECT from_id, to_id, type, weight
            FROM graph_edges
            WHERE project_id = ? AND stale_at IS NULL`,
      args: [projectId],
    });

    if (edgesResult.rows.length === 0) return;

    // Build adjacency map
    const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>();
    for (const row of edgesResult.rows) {
      const r = row as unknown as { from_id: string; to_id: string; type: string; weight: number };
      if (!adj.has(r.from_id)) adj.set(r.from_id, []);
      adj.get(r.from_id)!.push({ to: r.to_id, type: r.type, weight: r.weight });
    }

    // BFS/DFS to compute transitive closure (capped at MAX_CLOSURE_DEPTH)
    const closureEntries: Array<{
      ancestorId: string;
      descendantId: string;
      depth: number;
      path: string[];
      edgeTypes: string[];
      totalWeight: number;
    }> = [];

    const allNodes = new Set<string>();
    for (const [from, tos] of adj) {
      allNodes.add(from);
      for (const { to } of tos) allNodes.add(to);
    }

    for (const startNode of allNodes) {
      const visited = new Map<string, { depth: number; path: string[]; types: string[]; weight: number }>();
      const queue: Array<{
        node: string;
        depth: number;
        path: string[];
        types: string[];
        weight: number;
      }> = [{ node: startNode, depth: 0, path: [startNode], types: [], weight: 0 }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const { node, depth, path, types, weight } = current;

        if (depth > MAX_CLOSURE_DEPTH) continue;
        if (depth > 0) {
          const prev = visited.get(node);
          // Only record shortest path
          if (!prev || prev.depth > depth) {
            visited.set(node, { depth, path, types, weight });
            closureEntries.push({
              ancestorId: startNode,
              descendantId: node,
              depth,
              path,
              edgeTypes: types,
              totalWeight: weight,
            });
          } else {
            continue;
          }
        }

        const neighbors = adj.get(node) ?? [];
        for (const { to, type, weight: edgeWeight } of neighbors) {
          if (!path.includes(to)) { // Avoid cycles
            queue.push({
              node: to,
              depth: depth + 1,
              path: [...path, to],
              types: [...types, type],
              weight: weight + edgeWeight,
            });
          }
        }
      }
    }

    // Batch insert closure entries
    if (closureEntries.length === 0) return;

    const BATCH_SIZE = 500;
    for (let i = 0; i < closureEntries.length; i += BATCH_SIZE) {
      const batch = closureEntries.slice(i, i + BATCH_SIZE);
      const statements = batch.map(e => ({
        sql: `INSERT OR REPLACE INTO graph_closure
              (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          e.ancestorId,
          e.descendantId,
          e.depth,
          JSON.stringify(e.path),
          JSON.stringify(e.edgeTypes),
          e.totalWeight,
        ],
      }));

      await this.db.batch(statements);
    }
  }

  /**
   * Update closure entries for a single node (after re-indexing a file).
   * More efficient than full rebuild for incremental updates.
   */
  async updateClosureForNode(nodeId: string): Promise<void> {
    // Delete existing closure entries where this node is ancestor or descendant
    await this.db.execute({
      sql: 'DELETE FROM graph_closure WHERE ancestor_id = ? OR descendant_id = ?',
      args: [nodeId, nodeId],
    });

    // Get the project ID for this node
    const nodeResult = await this.db.execute({
      sql: 'SELECT project_id FROM graph_nodes WHERE id = ?',
      args: [nodeId],
    });

    if (nodeResult.rows.length === 0) return;
    const projectId = nodeResult.rows[0].project_id as string;

    // Recompute descendants of this node
    await this.computeAndInsertDescendants(nodeId, projectId);

    // Recompute this node as descendant of its ancestors
    await this.computeAndInsertAncestorPaths(nodeId, projectId);
  }

  private async computeAndInsertDescendants(startNodeId: string, projectId: string): Promise<void> {
    const edgesResult = await this.db.execute({
      sql: `SELECT from_id, to_id, type, weight
            FROM graph_edges
            WHERE project_id = ? AND stale_at IS NULL`,
      args: [projectId],
    });

    const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>();
    for (const row of edgesResult.rows) {
      const r = row as unknown as { from_id: string; to_id: string; type: string; weight: number };
      if (!adj.has(r.from_id)) adj.set(r.from_id, []);
      adj.get(r.from_id)!.push({ to: r.to_id, type: r.type, weight: r.weight });
    }

    const entries: Array<[string, string, number, string, string, number]> = [];
    const queue = [{
      node: startNodeId,
      depth: 0,
      path: [startNodeId],
      types: [] as string[],
      weight: 0,
    }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { node, depth, path, types, weight } = current;

      if (depth > MAX_CLOSURE_DEPTH || visited.has(node)) continue;
      visited.add(node);

      if (depth > 0) {
        entries.push([
          startNodeId,
          node,
          depth,
          JSON.stringify(path),
          JSON.stringify(types),
          weight,
        ]);
      }

      for (const { to, type, weight: w } of (adj.get(node) ?? [])) {
        if (!path.includes(to)) {
          queue.push({ node: to, depth: depth + 1, path: [...path, to], types: [...types, type], weight: weight + w });
        }
      }
    }

    if (entries.length === 0) return;

    const statements = entries.map(([anc, desc, depth, path, types, weight]) => ({
      sql: `INSERT OR REPLACE INTO graph_closure
            (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [anc, desc, depth, path, types, weight],
    }));

    await this.db.batch(statements);
  }

  private async computeAndInsertAncestorPaths(targetNodeId: string, projectId: string): Promise<void> {
    // Find all nodes that have this node as a descendant by traversing reverse edges
    const reverseEdgesResult = await this.db.execute({
      sql: `SELECT from_id, to_id, type, weight
            FROM graph_edges
            WHERE project_id = ? AND stale_at IS NULL`,
      args: [projectId],
    });

    // Build reverse adjacency map (to → from)
    const reverseAdj = new Map<string, Array<{ from: string; type: string; weight: number }>>();
    for (const row of reverseEdgesResult.rows) {
      const r = row as unknown as { from_id: string; to_id: string; type: string; weight: number };
      if (!reverseAdj.has(r.to_id)) reverseAdj.set(r.to_id, []);
      reverseAdj.get(r.to_id)!.push({ from: r.from_id, type: r.type, weight: r.weight });
    }

    // BFS backwards to find ancestors
    const ancestors: Array<{ node: string; depth: number; path: string[]; types: string[]; weight: number }> = [];
    const queue = [{ node: targetNodeId, depth: 0, path: [targetNodeId], types: [] as string[], weight: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { node, depth, path, types, weight } = current;

      if (depth > MAX_CLOSURE_DEPTH || visited.has(node)) continue;
      visited.add(node);

      if (depth > 0) {
        ancestors.push(current);
      }

      for (const { from, type, weight: w } of (reverseAdj.get(node) ?? [])) {
        if (!path.includes(from)) {
          queue.push({ node: from, depth: depth + 1, path: [from, ...path], types: [type, ...types], weight: weight + w });
        }
      }
    }

    if (ancestors.length === 0) return;

    const statements = ancestors.map(a => ({
      sql: `INSERT OR REPLACE INTO graph_closure
            (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        a.node,
        targetNodeId,
        a.depth,
        JSON.stringify(a.path),
        JSON.stringify(a.types),
        a.weight,
      ],
    }));

    await this.db.batch(statements);
  }

  async getDescendants(nodeId: string, maxDepth: number): Promise<ClosureEntry[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM graph_closure
            WHERE ancestor_id = ? AND depth <= ?
            ORDER BY depth, total_weight DESC`,
      args: [nodeId, maxDepth],
    });

    return result.rows.map(r => rowToClosure(r as unknown as Record<string, unknown>));
  }

  async getAncestors(nodeId: string, maxDepth: number): Promise<ClosureEntry[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM graph_closure
            WHERE descendant_id = ? AND depth <= ?
            ORDER BY depth, total_weight DESC`,
      args: [nodeId, maxDepth],
    });

    return result.rows.map(r => rowToClosure(r as unknown as Record<string, unknown>));
  }

  // ============================================================
  // IMPACT ANALYSIS
  // ============================================================

  async analyzeImpact(
    target: string,
    projectId: string,
    maxDepth: number = 3,
  ): Promise<ImpactResult> {
    // Find target node by label or filePath:label format
    const nodeResult = await this.db.execute({
      sql: `SELECT * FROM graph_nodes
            WHERE project_id = ? AND (label = ? OR label LIKE ?)
            AND stale_at IS NULL
            LIMIT 1`,
      args: [projectId, target, `%:${target}`],
    });

    if (nodeResult.rows.length === 0) {
      return {
        target: { nodeId: '', label: target, filePath: '' },
        directDependents: [],
        transitiveDependents: [],
        affectedTests: [],
        affectedMemories: [],
      };
    }

    const targetNode = rowToNode(nodeResult.rows[0] as unknown as Record<string, unknown>);

    // Get direct dependents (who imports/calls this node)
    const directEdgesResult = await this.db.execute({
      sql: `SELECT ge.*, gn.label as from_label, gn.file_path as from_file
            FROM graph_edges ge
            JOIN graph_nodes gn ON ge.from_id = gn.id
            WHERE ge.to_id = ? AND ge.stale_at IS NULL`,
      args: [targetNode.id],
    });

    const directDependents = directEdgesResult.rows.map(row => {
      const r = row as unknown as { from_id: string; from_label: string; from_file: string; type: string };
      return {
        nodeId: r.from_id,
        label: r.from_label,
        filePath: r.from_file ?? '',
        edgeType: r.type,
      };
    });

    // Get transitive dependents via closure table
    const closureResult = await this.db.execute({
      sql: `SELECT gc.ancestor_id, gc.depth, gn.label, gn.file_path
            FROM graph_closure gc
            JOIN graph_nodes gn ON gc.ancestor_id = gn.id
            WHERE gc.descendant_id = ? AND gc.depth <= ?
            ORDER BY gc.depth`,
      args: [targetNode.id, maxDepth],
    });

    const transitiveDependents = closureResult.rows
      .map(row => {
        const r = row as unknown as { ancestor_id: string; depth: number; label: string; file_path: string };
        return {
          nodeId: r.ancestor_id,
          label: r.label,
          filePath: r.file_path ?? '',
          depth: r.depth,
        };
      })
      .filter(d => !directDependents.some(dd => dd.nodeId === d.nodeId));

    // Find affected test files
    const allAffectedFiles = new Set([
      targetNode.filePath ?? '',
      ...directDependents.map(d => d.filePath),
      ...transitiveDependents.map(d => d.filePath),
    ]);

    const affectedTests = Array.from(allAffectedFiles)
      .filter(fp => fp && (
        fp.includes('.test.') ||
        fp.includes('.spec.') ||
        fp.includes('__tests__') ||
        fp.includes('/test/')
      ))
      .map(fp => ({ filePath: fp }));

    // Find related memories
    const filePaths = Array.from(allAffectedFiles).filter(Boolean).slice(0, 10);
    let affectedMemories: ImpactResult['affectedMemories'] = [];

    if (filePaths.length > 0) {
      const placeholders = filePaths.map(() => '?').join(',');
      const memoriesResult = await this.db.execute({
        sql: `SELECT id, type, content FROM memories
              WHERE project_id = ?
                AND deprecated = 0
                AND related_files LIKE ?
              LIMIT 10`,
        args: [projectId, `%${filePaths[0]}%`],
      }).catch(() => ({ rows: [] }));

      affectedMemories = memoriesResult.rows.map(row => {
        const r = row as unknown as { id: string; type: string; content: string };
        return { memoryId: r.id, type: r.type, content: r.content.slice(0, 200) };
      });
      void placeholders; // Used for type checking
    }

    return {
      target: {
        nodeId: targetNode.id,
        label: targetNode.label,
        filePath: targetNode.filePath ?? '',
      },
      directDependents,
      transitiveDependents,
      affectedTests,
      affectedMemories,
    };
  }

  // ============================================================
  // INDEX STATE
  // ============================================================

  async getIndexState(projectId: string): Promise<GraphIndexState | null> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM graph_index_state WHERE project_id = ?',
      args: [projectId],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as unknown as {
      project_id: string;
      last_indexed_at: number;
      last_commit_sha: string | null;
      node_count: number;
      edge_count: number;
      stale_edge_count: number;
      index_version: number;
    };

    return {
      projectId: row.project_id,
      lastIndexedAt: row.last_indexed_at,
      lastCommitSha: row.last_commit_sha ?? undefined,
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      staleEdgeCount: row.stale_edge_count,
      indexVersion: row.index_version,
    };
  }

  async updateIndexState(projectId: string, state: Partial<GraphIndexState>): Promise<void> {
    const existing = await this.getIndexState(projectId);
    const now = Date.now();

    if (!existing) {
      await this.db.execute({
        sql: `INSERT INTO graph_index_state
              (project_id, last_indexed_at, last_commit_sha, node_count, edge_count, stale_edge_count, index_version)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          projectId,
          state.lastIndexedAt ?? now,
          state.lastCommitSha ?? null,
          state.nodeCount ?? 0,
          state.edgeCount ?? 0,
          state.staleEdgeCount ?? 0,
          state.indexVersion ?? 1,
        ],
      });
    } else {
      await this.db.execute({
        sql: `UPDATE graph_index_state SET
              last_indexed_at = ?,
              last_commit_sha = ?,
              node_count = ?,
              edge_count = ?,
              stale_edge_count = ?,
              index_version = ?
              WHERE project_id = ?`,
        args: [
          state.lastIndexedAt ?? existing.lastIndexedAt,
          state.lastCommitSha ?? existing.lastCommitSha ?? null,
          state.nodeCount ?? existing.nodeCount,
          state.edgeCount ?? existing.edgeCount,
          state.staleEdgeCount ?? existing.staleEdgeCount,
          state.indexVersion ?? existing.indexVersion,
          projectId,
        ],
      });
    }
  }

  /**
   * Count nodes and edges for a project (for index state).
   */
  async countNodesAndEdges(projectId: string): Promise<{ nodeCount: number; edgeCount: number; staleEdgeCount: number }> {
    const [nodeResult, edgeResult, staleResult] = await Promise.all([
      this.db.execute({
        sql: 'SELECT COUNT(*) as count FROM graph_nodes WHERE project_id = ? AND stale_at IS NULL',
        args: [projectId],
      }),
      this.db.execute({
        sql: 'SELECT COUNT(*) as count FROM graph_edges WHERE project_id = ? AND stale_at IS NULL',
        args: [projectId],
      }),
      this.db.execute({
        sql: 'SELECT COUNT(*) as count FROM graph_edges WHERE project_id = ? AND stale_at IS NOT NULL',
        args: [projectId],
      }),
    ]);

    return {
      nodeCount: (nodeResult.rows[0] as unknown as { count: number }).count,
      edgeCount: (edgeResult.rows[0] as unknown as { count: number }).count,
      staleEdgeCount: (staleResult.rows[0] as unknown as { count: number }).count,
    };
  }
}
