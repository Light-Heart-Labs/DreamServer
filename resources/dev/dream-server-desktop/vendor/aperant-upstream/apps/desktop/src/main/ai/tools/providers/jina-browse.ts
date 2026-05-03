/**
 * Jina Browse Provider
 * ====================
 *
 * BrowseProvider implementation using Jina Reader (r.jina.ai).
 * Converts URLs to clean markdown — no API key needed.
 *
 * Rate limits:
 * - Anonymous: ~20 RPM
 * - With free API key (JINA_API_KEY): ~100 RPM
 */

import type { BrowseOptions, BrowseProvider, BrowseResult } from './types';

const DEFAULT_TIMEOUT = 30_000;
const MAX_CONTENT_LENGTH = 100_000;

export class JinaBrowseProvider implements BrowseProvider {
  readonly name = 'jina';

  async browse(url: string, options?: BrowseOptions): Promise<BrowseResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        Accept: 'text/markdown',
      };

      // Use API key if available for higher rate limits (100 RPM vs 20 RPM)
      const apiKey = process.env.JINA_API_KEY;
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(`https://r.jina.ai/${url}`, {
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      let content = await response.text();

      // Extract title from markdown if present (Jina returns "Title: ..." as first line)
      let title: string | undefined;
      const titleMatch = content.match(/^Title:\s*(.+?)[\r\n]/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      if (content.length > MAX_CONTENT_LENGTH) {
        content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[Content truncated — ${content.length} characters total]`;
      }

      return { url, content, title };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
