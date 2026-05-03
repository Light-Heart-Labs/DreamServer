import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JinaBrowseProvider } from '../jina-browse';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

function mockFetchResponse(body: string, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JinaBrowseProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('JINA_API_KEY', '');
  });

  it('should have name "jina"', () => {
    const provider = new JinaBrowseProvider();
    expect(provider.name).toBe('jina');
  });

  it('should fetch via r.jina.ai and return markdown', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse('# Hello World\n\nSome content here.'),
    );

    const provider = new JinaBrowseProvider();
    const result = await provider.browse('https://example.com');

    expect(result.url).toBe('https://example.com');
    expect(result.content).toContain('# Hello World');
    expect(result.content).toContain('Some content here.');

    // Should call r.jina.ai with the URL
    expect(mockFetch).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'text/markdown' }),
      }),
    );
  });

  it('should extract title from Jina response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse('Title: Example Page\n\n# Heading\nBody text'),
    );

    const provider = new JinaBrowseProvider();
    const result = await provider.browse('https://example.com');

    expect(result.title).toBe('Example Page');
  });

  it('should use API key when JINA_API_KEY is set', async () => {
    vi.stubEnv('JINA_API_KEY', 'jina-test-key');
    mockFetch.mockResolvedValueOnce(mockFetchResponse('Content'));

    const provider = new JinaBrowseProvider();
    await provider.browse('https://example.com');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jina-test-key',
        }),
      }),
    );
  });

  it('should not include Authorization header without API key', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse('Content'));

    const provider = new JinaBrowseProvider();
    await provider.browse('https://example.com');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse('Not Found', 404, 'Not Found'));

    const provider = new JinaBrowseProvider();
    await expect(provider.browse('https://example.com/missing')).rejects.toThrow('404');
  });

  it('should truncate content exceeding max length', async () => {
    const longContent = 'X'.repeat(150_000);
    mockFetch.mockResolvedValueOnce(mockFetchResponse(longContent));

    const provider = new JinaBrowseProvider();
    const result = await provider.browse('https://example.com');

    expect(result.content.length).toBeLessThan(150_000);
    expect(result.content).toContain('[Content truncated');
  });

  it('should pass timeout via AbortController', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse('Content'));

    const provider = new JinaBrowseProvider();
    await provider.browse('https://example.com', { timeout: 5_000 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
