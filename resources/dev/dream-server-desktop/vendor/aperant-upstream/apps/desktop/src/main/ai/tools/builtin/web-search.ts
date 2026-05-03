/**
 * WebSearch Tool
 * ==============
 *
 * Performs web searches via a pluggable SearchProvider.
 * Supports domain filtering (allow/block lists).
 * Provider-agnostic — works with any LLM provider.
 *
 * Default provider: Tavily (requires TAVILY_API_KEY).
 */

import { z } from 'zod/v3';

import { Tool } from '../define';
import { createSearchProvider } from '../providers';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 10;
const MAX_SNIPPET_LENGTH = 300;

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query to use'),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe('Only include search results from these domains'),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe('Never include search results from these domains'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webSearchTool = Tool.define({
  metadata: {
    name: 'WebSearch',
    description:
      'Searches the web and returns results to inform responses. Provides up-to-date information for current events and recent data. Supports domain filtering.',
    permission: ToolPermission.ReadOnly,
    executionOptions: {
      ...DEFAULT_EXECUTION_OPTIONS,
      timeoutMs: SEARCH_TIMEOUT_MS,
    },
  },
  inputSchema,
  execute: async (input) => {
    const { query, allowed_domains, blocked_domains } = input;

    try {
      const provider = createSearchProvider();

      const results = await provider.search(query, {
        maxResults: MAX_RESULTS,
        includeDomains: allowed_domains?.length ? allowed_domains : undefined,
        excludeDomains: blocked_domains?.length ? blocked_domains : undefined,
        timeout: SEARCH_TIMEOUT_MS,
      });

      if (!results.length) {
        return `No search results found for: ${query}`;
      }

      const formatted = results.map((r, i) => {
        const snippet = r.content ? r.content.slice(0, MAX_SNIPPET_LENGTH) : '';
        return `${i + 1}. ${r.title}\n   URL: ${r.url}${snippet ? `\n   ${snippet}` : ''}`;
      });

      return `Search results for: ${query}\n\n${formatted.join('\n\n')}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  },
});
