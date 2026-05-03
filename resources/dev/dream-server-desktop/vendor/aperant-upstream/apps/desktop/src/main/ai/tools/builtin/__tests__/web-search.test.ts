import { describe, it, expect, vi, beforeEach } from 'vitest';

import { webSearchTool } from '../web-search';
import type { ToolContext } from '../../types';

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();

vi.mock('../../providers', () => ({
  createSearchProvider: () => ({ name: 'serper', search: mockSearch }),
}));

vi.mock('../../../security/bash-validator', () => ({
  bashSecurityHook: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseContext: ToolContext = {
  cwd: '/test',
  projectDir: '/test/project',
  specDir: '/test/specs/001',
  securityProfile: {
    baseCommands: new Set(),
    stackCommands: new Set(),
    scriptCommands: new Set(),
    customCommands: new Set(),
    customScripts: { shellScripts: [] },
    getAllAllowedCommands: () => new Set(),
  },
} as unknown as ToolContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSearch Tool', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it('should have correct metadata', () => {
    expect(webSearchTool.metadata.name).toBe('WebSearch');
    expect(webSearchTool.metadata.permission).toBe('read_only');
  });

  it('should return formatted search results', async () => {
    mockSearch.mockResolvedValueOnce([
      {
        title: 'Node.js Official',
        url: 'https://nodejs.org/',
        content: 'Node.js is a JavaScript runtime built on V8.',
      },
      {
        title: 'Node.js Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Node.js',
        content: 'Node.js is an open-source, cross-platform runtime.',
      },
    ]);

    const result = await webSearchTool.config.execute(
      { query: 'node.js', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('Search results for: node.js');
    expect(result).toContain('Node.js Official');
    expect(result).toContain('https://nodejs.org/');
    expect(result).toContain('Node.js Wikipedia');
    expect(result).toContain('open-source');
  });

  it('should handle no results', async () => {
    mockSearch.mockResolvedValueOnce([]);

    const result = await webSearchTool.config.execute(
      { query: 'xyznonexistent', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('No search results found');
  });

  it('should pass domain filtering options', async () => {
    mockSearch.mockResolvedValueOnce([
      { title: 'GitHub Result', url: 'https://github.com/vercel/ai' },
    ]);

    await webSearchTool.config.execute(
      {
        query: 'vercel ai sdk',
        allowed_domains: ['github.com'],
        blocked_domains: ['spam.example.com'],
      },
      baseContext,
    );

    expect(mockSearch).toHaveBeenCalledWith(
      'vercel ai sdk',
      expect.objectContaining({
        includeDomains: ['github.com'],
        excludeDomains: ['spam.example.com'],
      }),
    );
  });

  it('should handle search errors gracefully', async () => {
    mockSearch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await webSearchTool.config.execute(
      { query: 'test query', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('Error');
    expect(result).toContain('Network timeout');
  });

  it('should handle provider configuration errors', async () => {
    mockSearch.mockRejectedValueOnce(
      new Error('Web search is not configured. The Serper API key was not embedded at build time.'),
    );

    const result = await webSearchTool.config.execute(
      { query: 'test', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('not configured');
  });

  it('should truncate long content snippets', async () => {
    const longContent = 'A'.repeat(500);
    mockSearch.mockResolvedValueOnce([
      { title: 'Long Content', url: 'https://example.com', content: longContent },
    ]);

    const result = await webSearchTool.config.execute(
      { query: 'test', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('Long Content');
    // 300 char truncation
    expect(result).not.toContain('A'.repeat(500));
  });

  it('should handle results without content', async () => {
    mockSearch.mockResolvedValueOnce([
      { title: 'No Content', url: 'https://example.com' },
    ]);

    const result = await webSearchTool.config.execute(
      { query: 'test', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(result).toContain('No Content');
    expect(result).toContain('https://example.com');
  });

  it('should pass maxResults and timeout', async () => {
    mockSearch.mockResolvedValueOnce([{ title: 'Test', url: 'https://test.com' }]);

    await webSearchTool.config.execute(
      { query: 'test', allowed_domains: undefined, blocked_domains: undefined },
      baseContext,
    );

    expect(mockSearch).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({
        maxResults: 10,
        timeout: 15_000,
      }),
    );
  });
});
