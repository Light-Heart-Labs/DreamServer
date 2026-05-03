/**
 * Search & Browse Provider Interfaces
 * ====================================
 *
 * Pluggable interfaces for web search and URL browsing.
 * Tools (WebSearch, WebFetch) depend on these interfaces,
 * not on specific provider implementations (Tavily, Jina, etc.).
 *
 * Search and Browse are deliberately separate interfaces —
 * search queries go through dedicated API endpoints,
 * browse requests fetch and convert individual URLs.
 */

// ---------------------------------------------------------------------------
// Search Provider
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  content?: string;
}

export interface SearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeout?: number;
}

/**
 * Provider for web search queries.
 * Implementations: TavilySearchProvider
 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Browse Provider
// ---------------------------------------------------------------------------

export interface BrowseResult {
  url: string;
  /** Page content, ideally as markdown */
  content: string;
  title?: string;
}

export interface BrowseOptions {
  timeout?: number;
}

/**
 * Provider for fetching and extracting content from URLs.
 * Implementations: JinaBrowseProvider, FetchBrowseProvider
 */
export interface BrowseProvider {
  readonly name: string;
  browse(url: string, options?: BrowseOptions): Promise<BrowseResult>;
}
