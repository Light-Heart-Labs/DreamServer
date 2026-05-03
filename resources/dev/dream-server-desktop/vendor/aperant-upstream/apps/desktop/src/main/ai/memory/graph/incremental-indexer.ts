/**
 * Incremental File Indexer
 *
 * File watcher that triggers re-indexing of code files.
 * Uses chokidar with 500ms debounce.
 * Implements the Glean-inspired staleness model:
 *   - On file change: markFileEdgesStale → re-extract → upsertNodes/Edges → updateClosure
 */

import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import type { GraphDatabase } from './graph-database';
import { makeNodeId } from './graph-database';
import type { TreeSitterLoader } from './tree-sitter-loader';
import { ASTExtractor } from './ast-extractor';

const DEBOUNCE_MS = 500;
const COLD_START_YIELD_EVERY = 100;

export class IncrementalIndexer {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private extractor = new ASTExtractor();
  private isIndexing = false;

  constructor(
    private projectRoot: string,
    private projectId: string,
    private graphDb: GraphDatabase,
    private treeSitter: TreeSitterLoader,
  ) {}

  /**
   * Start watching for file changes.
   */
  async startWatching(): Promise<void> {
    if (this.watcher) return;

    const { TreeSitterLoader: TSLoader } = await import('./tree-sitter-loader');
    const extensions = TSLoader.SUPPORTED_EXTENSIONS;

    this.watcher = watch(this.projectRoot, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.auto-claude/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/__pycache__/**',
        '**/target/**', // Rust
        '**/*.min.js',
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on startup
    });

    const handleChange = (filePath: string) => {
      const ext = '.' + filePath.split('.').pop()?.toLowerCase();
      if (!extensions.includes(ext)) return;

      // Debounce
      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        this.debounceTimers.delete(filePath);
        await this.indexFile(filePath).catch(err => {
          console.warn(`[IncrementalIndexer] Failed to index ${filePath}:`, err);
        });
      }, DEBOUNCE_MS);

      this.debounceTimers.set(filePath, timer);
    };

    const handleDelete = async (filePath: string) => {
      const ext = '.' + filePath.split('.').pop()?.toLowerCase();
      if (!extensions.includes(ext)) return;

      await this.graphDb.markFileEdgesStale(this.projectId, filePath).catch(() => {});
      await this.graphDb.markFileNodesStale(this.projectId, filePath).catch(() => {});
    };

    this.watcher.on('change', handleChange);
    this.watcher.on('add', handleChange);
    this.watcher.on('unlink', handleDelete);
  }

  /**
   * Index a single file: mark stale, re-extract, upsert, update closure.
   */
  async indexFile(filePath: string): Promise<void> {
    const { TreeSitterLoader: TSLoader } = await import('./tree-sitter-loader');
    const lang = TSLoader.detectLanguage(filePath);
    if (!lang) return;

    const parser = await this.treeSitter.getParser(lang);
    if (!parser) return;

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      // File may have been deleted — mark stale
      await this.graphDb.markFileEdgesStale(this.projectId, filePath);
      await this.graphDb.markFileNodesStale(this.projectId, filePath);
      return;
    }

    // 1. Mark existing nodes and edges as stale
    await this.graphDb.markFileNodesStale(this.projectId, filePath);
    await this.graphDb.markFileEdgesStale(this.projectId, filePath);

    // 2. Parse and extract
    let tree: import('web-tree-sitter').Tree | null = null;
    try {
      tree = parser.parse(content);
    } catch {
      return;
    }

    if (!tree) return;

    const { nodes, edges } = this.extractor.extract(tree, filePath, lang);

    // 3. Upsert nodes
    const nodeIdMap = new Map<string, string>(); // label → id
    for (const node of nodes) {
      const id = await this.graphDb.upsertNode({
        projectId: this.projectId,
        type: node.type,
        label: node.label,
        filePath: node.filePath,
        language: node.language,
        startLine: node.startLine,
        endLine: node.endLine,
        layer: 1,
        source: 'ast',
        confidence: 'inferred',
        metadata: node.metadata ?? {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        staleAt: undefined,
        associatedMemoryIds: [],
      });
      nodeIdMap.set(node.label, id);
    }

    // 4. Resolve and upsert edges
    // For edges where either endpoint may not have a node in our DB yet,
    // we create "stub" file nodes for external references.
    for (const edge of edges) {
      const fromId = await this.resolveOrCreateNode(edge.fromLabel, filePath, lang, nodeIdMap);
      const toId = await this.resolveOrCreateNode(edge.toLabel, filePath, lang, nodeIdMap);

      if (!fromId || !toId) continue;

      await this.graphDb.upsertEdge({
        projectId: this.projectId,
        fromId,
        toId,
        type: edge.type,
        layer: 1,
        weight: 1.0,
        source: 'ast',
        confidence: 1.0,
        metadata: edge.metadata ?? {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        staleAt: undefined,
      });
    }

    // 5. Delete stale nodes and edges (old version of this file)
    await this.graphDb.deleteStaleNodesForFile(this.projectId, filePath);
    await this.graphDb.deleteStaleEdgesForFile(this.projectId, filePath);

    // 6. Update closure for affected nodes
    const fileNodeId = nodeIdMap.get(filePath);
    if (fileNodeId) {
      await this.graphDb.updateClosureForNode(fileNodeId);
    }

    // Update index state counts
    const counts = await this.graphDb.countNodesAndEdges(this.projectId);
    await this.graphDb.updateIndexState(this.projectId, {
      lastIndexedAt: Date.now(),
      ...counts,
    });
  }

  /**
   * Cold-start index: walk project, index all supported files.
   * Yields control every COLD_START_YIELD_EVERY files to avoid blocking.
   */
  async coldStartIndex(): Promise<void> {
    if (this.isIndexing) return;
    this.isIndexing = true;

    try {
      const { TreeSitterLoader: TSLoader } = await import('./tree-sitter-loader');
      await this.treeSitter.initialize();

      const files = this.collectSupportedFiles(this.projectRoot, TSLoader.SUPPORTED_EXTENSIONS);

      let indexed = 0;
      for (const filePath of files) {
        await this.indexFile(filePath);
        indexed++;

        if (indexed % COLD_START_YIELD_EVERY === 0) {
          // Yield to event loop
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }

      // Rebuild full closure after cold start
      await this.graphDb.rebuildClosure(this.projectId);

      const counts = await this.graphDb.countNodesAndEdges(this.projectId);
      await this.graphDb.updateIndexState(this.projectId, {
        lastIndexedAt: Date.now(),
        ...counts,
      });
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Stop file watcher and clear pending timers.
   */
  stopWatching(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  // ---- Private helpers ----

  private async resolveOrCreateNode(
    label: string,
    currentFilePath: string,
    lang: string,
    nodeIdMap: Map<string, string>,
  ): Promise<string | null> {
    // Check if already upserted in this batch
    const existing = nodeIdMap.get(label);
    if (existing) return existing;

    // Check if it's a relative path import (create stub file node)
    if (label.startsWith('.') || label.startsWith('/')) {
      const resolvedPath = label.startsWith('.')
        ? join(currentFilePath, '..', label)
        : label;

      const id = makeNodeId(this.projectId, resolvedPath, resolvedPath, 'file');
      nodeIdMap.set(label, id);

      await this.graphDb.upsertNode({
        projectId: this.projectId,
        type: 'file',
        label: resolvedPath,
        filePath: resolvedPath,
        language: lang,
        startLine: 1,
        endLine: 1,
        layer: 1,
        source: 'ast',
        confidence: 'inferred',
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        staleAt: undefined,
        associatedMemoryIds: [],
      });

      return id;
    }

    // External module or unresolved symbol — create a stub node
    const stubId = makeNodeId(this.projectId, '', label, 'module');
    nodeIdMap.set(label, stubId);

    await this.graphDb.upsertNode({
      projectId: this.projectId,
      type: 'module',
      label,
      filePath: undefined,
      language: undefined,
      layer: 1,
      source: 'ast',
      confidence: 'inferred',
      metadata: { external: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      staleAt: undefined,
      associatedMemoryIds: [],
    });

    return stubId;
  }

  private collectSupportedFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = [];
    const IGNORED_DIRS = new Set([
      'node_modules', '.git', '.auto-claude', 'dist', 'build',
      '.next', '__pycache__', 'target', '.venv',
    ]);

    const walk = (currentDir: string) => {
      if (!existsSync(currentDir)) return;

      let entries: string[];
      try {
        entries = readdirSync(currentDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry)) continue;

        const fullPath = join(currentDir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          const ext = '.' + entry.split('.').pop()?.toLowerCase();
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(dir);
    return files;
  }
}
