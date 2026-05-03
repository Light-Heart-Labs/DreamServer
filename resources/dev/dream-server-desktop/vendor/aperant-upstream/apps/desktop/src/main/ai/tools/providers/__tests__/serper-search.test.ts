import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SerperSearchProvider } from '../serper-search';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

function mockFetchResponse(body: unknown, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function makeSerperResponse(
  items: { title?: string; link: string; snippet?: string }[],
) {
  return {
    searchParameters: { q: 'test', type: 'search', engine: 'google' },
    organic: items.map((item, i) => ({
      title: '',
      position: i + 1,
      ...item,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SerperSearchProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('SERPER_API_KEY', 'test-serper-key');
  });

  it('should have name "serper"', () => {
    const provider = new SerperSearchProvider();
    expect(provider.name).toBe('serper');
  });

  it('should return normalized search results', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(
        makeSerperResponse([
          { title: 'Node.js', link: 'https://nodejs.org/', snippet: 'Runtime' },
          { link: 'https://example.com', snippet: 'No title' },
        ]),
      ),
    );

    const provider = new SerperSearchProvider();
    const results = await provider.search('node.js');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Node.js',
      url: 'https://nodejs.org/',
      content: 'Runtime',
    });
    expect(results[1].title).toBe('');
    expect(results[1].url).toBe('https://example.com');
  });

  it('should return empty array when no results', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ organic: [] }),
    );

    const provider = new SerperSearchProvider();
    const results = await provider.search('xyznonexistent');

    expect(results).toEqual([]);
  });

  it('should post to Serper endpoint with correct headers', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://test.com' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('test query');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-KEY': 'test-serper-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('should send query and num in request body', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://test.com' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('test', { maxResults: 5 });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.q).toBe('test');
    expect(callBody.num).toBe(5);
  });

  it('should append site: filter for includeDomains', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://github.com/test' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('ai sdk', { includeDomains: ['github.com'] });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.q).toBe('ai sdk site:github.com');
  });

  it('should append -site: filter for excludeDomains', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://test.com' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('test', { excludeDomains: ['spam.com', 'ads.com'] });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.q).toBe('test -site:spam.com -site:ads.com');
  });

  it('should handle multiple includeDomains with OR', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://test.com' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('test', { includeDomains: ['github.com', 'stackoverflow.com'] });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.q).toBe('test (site:github.com OR site:stackoverflow.com)');
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse('Unauthorized', 401, 'Unauthorized'),
    );

    const provider = new SerperSearchProvider();
    await expect(provider.search('test')).rejects.toThrow('401');
  });

  it('should throw when no API key is available', async () => {
    vi.stubEnv('SERPER_API_KEY', '');

    const provider = new SerperSearchProvider();
    await expect(provider.search('test')).rejects.toThrow('not configured');
  });

  it('should use AbortController for timeout', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(makeSerperResponse([{ link: 'https://test.com' }])),
    );

    const provider = new SerperSearchProvider();
    await provider.search('test', { timeout: 5_000 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
