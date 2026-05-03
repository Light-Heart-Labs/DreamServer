import { describe, it, expect, vi, beforeEach } from 'vitest';

import { webFetchTool } from '../web-fetch';
import type { ToolContext } from '../../types';

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

const mockBrowse = vi.fn();

vi.mock('../../providers', () => ({
  createBrowseProvider: () => ({ name: 'jina', browse: mockBrowse }),
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

describe('WebFetch Tool', () => {
  beforeEach(() => {
    mockBrowse.mockReset();
  });

  it('should have correct metadata', () => {
    expect(webFetchTool.metadata.name).toBe('WebFetch');
    expect(webFetchTool.metadata.permission).toBe('read_only');
  });

  it('should return fetched content with prompt context', async () => {
    mockBrowse.mockResolvedValueOnce({
      url: 'https://example.com',
      content: '# Example\n\nThis is a page.',
      title: 'Example',
    });

    const result = await webFetchTool.config.execute(
      { url: 'https://example.com', prompt: 'Extract the heading' },
      baseContext,
    );

    expect(result).toContain('URL: https://example.com');
    expect(result).toContain('Prompt: Extract the heading');
    expect(result).toContain('# Example');
    expect(result).toContain('This is a page.');
  });

  it('should handle browse provider errors', async () => {
    mockBrowse.mockRejectedValueOnce(new Error('HTTP 404 Not Found'));

    const result = await webFetchTool.config.execute(
      { url: 'https://example.com/missing', prompt: 'Read the page' },
      baseContext,
    );

    expect(result).toContain('Error');
    expect(result).toContain('HTTP 404 Not Found');
  });

  it('should handle timeout errors', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mockBrowse.mockRejectedValueOnce(abortError);

    const result = await webFetchTool.config.execute(
      { url: 'https://slow-site.example.com', prompt: 'Read' },
      baseContext,
    );

    expect(result).toContain('timed out');
  });

  it('should pass timeout option to browse provider', async () => {
    mockBrowse.mockResolvedValueOnce({
      url: 'https://example.com',
      content: 'Page content',
    });

    await webFetchTool.config.execute(
      { url: 'https://example.com', prompt: 'Read' },
      baseContext,
    );

    expect(mockBrowse).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ timeout: 30_000 }),
    );
  });
});
