import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TavilySearchProvider } from '../tavily-search';

// ---------------------------------------------------------------------------
// Mock @tavily/core
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();

vi.mock('@tavily/core', () => ({
  tavily: () => ({ search: mockSearch }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTavilyResponse(
  items: { title?: string; url: string; content?: string }[],
) {
  return {
    query: 'test',
    responseTime: 0.5,
    images: [],
    results: items.map((item) => ({
      score: 0.9,
      publishedDate: '2026-01-01',
      title: '',
      ...item,
    })),
    requestId: 'test-req-id',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TavilySearchProvider', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    vi.stubEnv('TAVILY_API_KEY', 'test-key-123');
  });

  it('should have name "tavily"', () => {
    const provider = new TavilySearchProvider();
    expect(provider.name).toBe('tavily');
  });

  it('should throw when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const provider = new TavilySearchProvider();

    await expect(provider.search('test')).rejects.toThrow('TAVILY_API_KEY');
  });

  it('should return normalized search results', async () => {
    mockSearch.mockResolvedValueOnce(
      makeTavilyResponse([
        { title: 'Node.js', url: 'https://nodejs.org/', content: 'Runtime' },
        { url: 'https://example.com', content: 'No title' },
      ]),
    );

    const provider = new TavilySearchProvider();
    const results = await provider.search('node.js');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Node.js',
      url: 'https://nodejs.org/',
      content: 'Runtime',
    });
    expect(results[1].title).toBe('');
  });

  it('should return empty array when no results', async () => {
    mockSearch.mockResolvedValueOnce(makeTavilyResponse([]));

    const provider = new TavilySearchProvider();
    const results = await provider.search('xyznonexistent');

    expect(results).toEqual([]);
  });

  it('should pass options to Tavily client', async () => {
    mockSearch.mockResolvedValueOnce(makeTavilyResponse([{ url: 'https://test.com' }]));

    const provider = new TavilySearchProvider();
    await provider.search('test', {
      maxResults: 5,
      includeDomains: ['github.com'],
      excludeDomains: ['spam.com'],
      timeout: 10_000,
    });

    expect(mockSearch).toHaveBeenCalledWith('test', {
      maxResults: 5,
      includeDomains: ['github.com'],
      excludeDomains: ['spam.com'],
      timeout: 10_000,
    });
  });

  it('should use defaults when no options provided', async () => {
    mockSearch.mockResolvedValueOnce(makeTavilyResponse([{ url: 'https://test.com' }]));

    const provider = new TavilySearchProvider();
    await provider.search('test');

    expect(mockSearch).toHaveBeenCalledWith('test', {
      maxResults: 10,
      includeDomains: undefined,
      excludeDomains: undefined,
      timeout: 15_000,
    });
  });
});
