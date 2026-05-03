/**
 * Provider Factory
 * ================
 *
 * Factory functions for creating search and browse providers.
 * Tools import from here — they never import provider implementations directly.
 */

export type { SearchProvider, SearchResult, SearchOptions, BrowseProvider, BrowseResult, BrowseOptions } from './types';

export { SerperSearchProvider } from './serper-search';
export { TavilySearchProvider } from './tavily-search';
export { JinaBrowseProvider } from './jina-browse';
export { FetchBrowseProvider } from './fetch-browse';

import type { SearchProvider } from './types';
import type { BrowseProvider } from './types';
import { SerperSearchProvider } from './serper-search';
import { JinaBrowseProvider } from './jina-browse';

/**
 * Create the default search provider.
 * Uses Serper.dev with an embedded API key — search works out of the box.
 */
export function createSearchProvider(): SearchProvider {
  return new SerperSearchProvider();
}

/**
 * Create the default browse provider.
 * Currently returns JinaBrowseProvider (URL → markdown, no API key needed).
 */
export function createBrowseProvider(): BrowseProvider {
  return new JinaBrowseProvider();
}
