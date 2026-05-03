/**
 * search_memory Agent Tool
 *
 * Allows agents to explicitly search the memory system during a session.
 * Sends an IPC request to the main thread's MemoryService and returns
 * formatted results.
 *
 * This tool is available only when a WorkerObserverProxy is injected.
 * Sessions without memory support get a no-op stub.
 */

import { tool } from 'ai';
import { z } from 'zod/v3';
import type { Tool as AITool } from 'ai';
import type { WorkerObserverProxy } from '../ipc/worker-observer-proxy';
import type { MemoryType, MemorySearchFilters } from '../types';

// ============================================================
// INPUT SCHEMA
// ============================================================

const searchMemorySchema = z.object({
  query: z
    .string()
    .describe(
      'Search query describing what you are looking for (e.g., "how to handle auth errors", "file access patterns for auth module")',
    ),
  types: z
    .array(
      z.enum([
        'gotcha',
        'decision',
        'preference',
        'pattern',
        'requirement',
        'error_pattern',
        'module_insight',
        'prefetch_pattern',
        'work_state',
        'causal_dependency',
        'task_calibration',
        'e2e_observation',
        'dead_end',
        'work_unit_outcome',
        'workflow_recipe',
        'context_cost',
      ]),
    )
    .optional()
    .describe('Optional: filter by memory type(s)'),
  relatedFiles: z
    .array(z.string())
    .optional()
    .describe('Optional: filter memories related to specific files'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of results to return (default 5, max 20)'),
});

type SearchMemoryInput = z.infer<typeof searchMemorySchema>;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a `search_memory` AI SDK tool bound to a WorkerObserverProxy.
 *
 * @param proxy - The worker-side memory IPC proxy
 * @param projectId - Project identifier for scoping results
 */
export function createSearchMemoryTool(
  proxy: WorkerObserverProxy,
  projectId: string,
): AITool<SearchMemoryInput, string> {
  return tool({
    description:
      'Search the persistent memory system for relevant context, gotchas, decisions, and patterns from previous sessions. Use this when you are unsure how something was done before, or to check for known pitfalls before making a change.',
    inputSchema: searchMemorySchema,
    execute: async (input: SearchMemoryInput): Promise<string> => {
      const filters: MemorySearchFilters = {
        query: input.query,
        types: input.types as MemoryType[] | undefined,
        relatedFiles: input.relatedFiles,
        limit: input.limit ?? 5,
        projectId,
        excludeDeprecated: true,
      };

      const memories = await proxy.searchMemory(filters);

      if (memories.length === 0) {
        return 'No relevant memories found for this query.';
      }

      const lines = memories.map((m, i) => {
        const fileRef =
          m.relatedFiles.length > 0
            ? ` [${m.relatedFiles.map((f) => f.split('/').pop()).join(', ')}]`
            : '';
        const confidence = `(confidence: ${(m.confidence * 100).toFixed(0)}%)`;
        return `${i + 1}. [${m.type}]${fileRef} ${confidence}\n   ${m.content}`;
      });

      return `Memory search results for "${input.query}":\n\n${lines.join('\n\n')}`;
    },
  });
}

/**
 * Create a no-op stub `search_memory` tool for sessions without memory support.
 */
export function createSearchMemoryStub(): AITool<SearchMemoryInput, string> {
  return tool({
    description: 'Search the memory system (memory not available in this session).',
    inputSchema: searchMemorySchema,
    execute: async (_input: SearchMemoryInput): Promise<string> => {
      return 'Memory system not available in this session.';
    },
  });
}
