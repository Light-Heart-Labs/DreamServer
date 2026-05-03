/**
 * schema.test.ts — Verify the schema DDL parses and executes without errors
 * Uses an in-memory libSQL client (no Electron app dependency).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { MEMORY_SCHEMA_SQL, MEMORY_PRAGMA_SQL } from '../schema';

let client: Client;

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
});

afterAll(async () => {
  client.close();
});

describe('MEMORY_SCHEMA_SQL', () => {
  it('is a non-empty string', () => {
    expect(typeof MEMORY_SCHEMA_SQL).toBe('string');
    expect(MEMORY_SCHEMA_SQL.length).toBeGreaterThan(100);
  });

  it('executes without errors on a fresh in-memory database', async () => {
    await expect(client.executeMultiple(MEMORY_SCHEMA_SQL)).resolves.not.toThrow();
  });

  it('is idempotent — executes twice without errors', async () => {
    await expect(client.executeMultiple(MEMORY_SCHEMA_SQL)).resolves.not.toThrow();
  });

  it('creates the memories table', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the memory_embeddings table', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the memories_fts virtual table', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the embedding_cache table', async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_cache'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates all observer tables', async () => {
    const tables = [
      'observer_file_nodes',
      'observer_co_access_edges',
      'observer_error_patterns',
      'observer_module_session_counts',
      'observer_synthesis_log',
    ];

    for (const table of tables) {
      const result = await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      );
      expect(result.rows).toHaveLength(1);
    }
  });

  it('creates all knowledge graph tables', async () => {
    const tables = [
      'graph_nodes',
      'graph_edges',
      'graph_closure',
      'graph_index_state',
      'scip_symbols',
    ];

    for (const table of tables) {
      const result = await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      );
      expect(result.rows).toHaveLength(1);
    }
  });
});

describe('MEMORY_PRAGMA_SQL', () => {
  it('is a non-empty string', () => {
    expect(typeof MEMORY_PRAGMA_SQL).toBe('string');
    expect(MEMORY_PRAGMA_SQL.length).toBeGreaterThan(10);
  });

  it('contains WAL mode pragma', () => {
    expect(MEMORY_PRAGMA_SQL).toContain('journal_mode = WAL');
  });

  it('contains foreign_keys pragma', () => {
    expect(MEMORY_PRAGMA_SQL).toContain('foreign_keys = ON');
  });
});
