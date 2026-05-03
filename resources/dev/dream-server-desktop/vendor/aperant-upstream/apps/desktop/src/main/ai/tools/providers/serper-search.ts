/**
 * Serper.dev Search Provider
 * ==========================
 *
 * SearchProvider implementation using the Serper.dev Google Search API.
 * Uses a build-time embedded API key — search works out of the box
 * with no user configuration.
 *
 * API key is injected at build time via Vite `define` from CI secrets.
 * In dev, set SERPER_API_KEY in apps/desktop/.env.
 */

import type { SearchOptions, SearchProvider, SearchResult } from './types';

// Build-time constant — replaced by Vite at compile time
declare const __SERPER_API_KEY__: string;

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT = 15_000;

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet?: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
  searchParameters?: Record<string, unknown>;
}

/**
 * Resolve the API key: build-time constant, then env var fallback (for dev).
 */
function resolveApiKey(): string {
  // Build-time injected key (production builds)
  if (typeof __SERPER_API_KEY__ !== 'undefined' && __SERPER_API_KEY__) {
    return __SERPER_API_KEY__;
  }
  // Env var fallback (local development)
  return process.env.SERPER_API_KEY ?? '';
}

/**
 * Build domain filter suffixes for the query string.
 * Serper uses Google's site: operator for domain filtering.
 */
function buildDomainFilter(
  includeDomains?: string[],
  excludeDomains?: string[],
): string {
  const parts: string[] = [];

  if (includeDomains?.length) {
    // Multiple include domains: (site:a.com OR site:b.com)
    if (includeDomains.length === 1) {
      parts.push(`site:${includeDomains[0]}`);
    } else {
      parts.push(`(${includeDomains.map((d) => `site:${d}`).join(' OR ')})`);
    }
  }

  if (excludeDomains?.length) {
    for (const domain of excludeDomains) {
      parts.push(`-site:${domain}`);
    }
  }

  return parts.join(' ');
}

export class SerperSearchProvider implements SearchProvider {
  readonly name = 'serper';

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error(
        'Web search is not configured. The Serper API key was not embedded at build time. ' +
        'Set the SERPER_API_KEY environment variable for local development.',
      );
    }

    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Append domain filters to query
      const domainFilter = buildDomainFilter(options?.includeDomains, options?.excludeDomains);
      const fullQuery = domainFilter ? `${query} ${domainFilter}` : query;

      const response = await fetch(SERPER_ENDPOINT, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: fullQuery,
          num: options?.maxResults ?? DEFAULT_MAX_RESULTS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Serper API error: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
      }

      const data = (await response.json()) as SerperResponse;

      if (!data.organic?.length) {
        return [];
      }

      return data.organic.map((r) => ({
        title: r.title ?? '',
        url: r.link,
        content: r.snippet,
      }));
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
