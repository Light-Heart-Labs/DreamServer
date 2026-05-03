/**
 * db.test.ts — Verify getInMemoryClient creates tables and basic operations work
 * Uses :memory: URL to avoid Electron app dependency.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getInMemoryClient } from '../db';

afterEach(() => {
  // Nothing to clean up — each test creates a fresh in-memory client
});

describe('getInMemoryClient', () => {
  it('creates a client without throwing', async () => {
    await expect(getInMemoryClient()).resolves.not.toThrow();
  });

  it('returns a client with an execute method', async () => {
    const client = await getInMemoryClient();
    expect(typeof client.execute).toBe('function');
    client.close();
  });

  it('creates the memories table', async () => {
    const client = await getInMemoryClient();
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
    );
    expect(result.rows).toHaveLength(1);
    client.close();
  });

  it('allows inserting a memory record', async () => {
    const client = await getInMemoryClient();
    const now = new Date().toISOString();
    const id = 'test-id-001';

    await client.execute({
      sql: `INSERT INTO memories (
        id, type, content, confidence, tags, related_files, related_modules,
        created_at, last_accessed_at, access_count, scope, source, project_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        'gotcha',
        'Test memory content',
        0.9,
        '[]',
        '[]',
        '[]',
        now,
        now,
        0,
        'global',
        'user_taught',
        'test-project',
      ],
    });

    const result = await client.execute({
      sql: 'SELECT id, type, content FROM memories WHERE id = ?',
      args: [id],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(id);
    expect(result.rows[0].type).toBe('gotcha');
    expect(result.rows[0].content).toBe('Test memory content');

    client.close();
  });

  it('allows querying by project_id', async () => {
    const client = await getInMemoryClient();
    const now = new Date().toISOString();

    // Insert two records for different projects
    for (const [idx, projectId] of [['1', 'project-a'], ['2', 'project-b']]) {
      await client.execute({
        sql: `INSERT INTO memories (
          id, type, content, confidence, tags, related_files, related_modules,
          created_at, last_accessed_at, access_count, scope, source, project_id
        ) VALUES (?, 'preference', ?, 0.8, '[]', '[]', '[]', ?, ?, 0, 'global', 'agent_explicit', ?)`,
        args: [`proj-test-${idx}`, `Content for project ${projectId}`, now, now, projectId],
      });
    }

    const result = await client.execute({
      sql: 'SELECT id FROM memories WHERE project_id = ?',
      args: ['project-a'],
    });

    expect(result.rows).toHaveLength(1);
    client.close();
  });

  it('creates observer tables accessible for insert', async () => {
    const client = await getInMemoryClient();
    const now = new Date().toISOString();

    await expect(
      client.execute({
        sql: `INSERT INTO observer_file_nodes (file_path, project_id, access_count, last_accessed_at, session_count)
              VALUES (?, ?, ?, ?, ?)`,
        args: ['src/main/index.ts', 'test-project', 1, now, 1],
      })
    ).resolves.not.toThrow();

    client.close();
  });
});
