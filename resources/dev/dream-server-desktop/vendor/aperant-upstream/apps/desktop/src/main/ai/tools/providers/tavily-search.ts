/**
 * Tavily Search Provider
 * ======================
 *
 * SearchProvider implementation using the Tavily API.
 * Requires TAVILY_API_KEY environment variable.
 * Free tier: 1,000 searches/month, email-only signup.
 */

import { tavily } from '@tavily/core';

import type { SearchOptions, SearchProvider, SearchResult } from './types';

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT = 15_000;

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Web search is not configured. ' +
        'Set the TAVILY_API_KEY environment variable to enable web search. ' +
        'Get a free key at https://tavily.com (1,000 searches/month on free tier).',
      );
    }

    const client = tavily({ apiKey });

    const response = await client.search(query, {
      maxResults: options?.maxResults ?? DEFAULT_MAX_RESULTS,
      includeDomains: options?.includeDomains?.length ? options.includeDomains : undefined,
      excludeDomains: options?.excludeDomains?.length ? options.excludeDomains : undefined,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    });

    if (!response.results?.length) {
      return [];
    }

    return response.results.map((r) => ({
      title: r.title ?? '',
      url: r.url,
      content: r.content,
    }));
  }
}
