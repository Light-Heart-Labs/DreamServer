/**
 * Tests for Provider Registry and Transforms
 *
 * Validates registry creation, model resolution, and per-provider transforms.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock all @ai-sdk/* providers for registry tests
const mockLanguageModel = vi.fn((id: string) => ({ id, type: 'language-model' }));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/mistral', () => ({
  createMistral: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/groq', () => ({
  createGroq: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => mockLanguageModel),
}));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => mockLanguageModel),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => mockLanguageModel),
}));
vi.mock('ai', () => ({
  createProviderRegistry: vi.fn((providers: Record<string, any>) => ({
    languageModel: vi.fn((id: string) => {
      const [providerKey, modelId] = id.split(':');
      const provider = providers[providerKey];
      if (!provider) throw new Error(`Provider "${providerKey}" not found in registry`);
      return provider(modelId);
    }),
  })),
}));

import { buildRegistry, resolveModel } from '../registry';
import { SupportedProvider } from '../types';
import {
  isAdaptiveModel,
  getThinkingKwargsForModel,
  transformThinkingConfig,
  sanitizeThinkingLevel,
  normalizeToolId,
  meetsCacheThreshold,
  getCacheBreakpoints,
} from '../transforms';

// =============================================================================
// Registry Tests
// =============================================================================

describe('buildRegistry', () => {
  it('builds registry with multiple providers', () => {
    const registry = buildRegistry({
      providers: {
        [SupportedProvider.Anthropic]: { apiKey: 'sk-ant' },
        [SupportedProvider.OpenAI]: { apiKey: 'sk-oai' },
      },
    });
    expect(registry).toBeDefined();
    expect(registry.languageModel).toBeDefined();
  });

  it('skips undefined provider configs', () => {
    const registry = buildRegistry({
      providers: {
        [SupportedProvider.Anthropic]: { apiKey: 'sk-ant' },
      },
    });
    expect(registry).toBeDefined();
  });
});

describe('resolveModel', () => {
  it('resolves provider:model string to a language model', () => {
    const registry = buildRegistry({
      providers: {
        [SupportedProvider.Anthropic]: { apiKey: 'sk-ant' },
      },
    });

    const model = resolveModel(registry, 'anthropic:claude-sonnet-4-5-20250929');
    expect(model).toBeDefined();
    expect((model as any).id).toBe('claude-sonnet-4-5-20250929');
  });

  it('throws for unregistered provider', () => {
    const registry = buildRegistry({
      providers: {
        [SupportedProvider.Anthropic]: { apiKey: 'sk-ant' },
      },
    });

    expect(() => resolveModel(registry, 'openai:gpt-4o' as `${string}:${string}`)).toThrow(
      'Provider "openai" not found in registry',
    );
  });
});

// =============================================================================
// Transform Tests
// =============================================================================

describe('isAdaptiveModel', () => {
  it('returns true for Opus 4.6', () => {
    expect(isAdaptiveModel('claude-opus-4-6')).toBe(true);
  });

  it('returns false for Sonnet', () => {
    expect(isAdaptiveModel('claude-sonnet-4-5-20250929')).toBe(false);
  });

  it('returns false for unknown model', () => {
    expect(isAdaptiveModel('gpt-4o')).toBe(false);
  });
});

describe('getThinkingKwargsForModel', () => {
  it('returns budgetTokens for non-adaptive model', () => {
    const result = getThinkingKwargsForModel('claude-sonnet-4-5-20250929', 'medium');
    expect(result.maxThinkingTokens).toBe(4096);
    expect(result.effortLevel).toBeUndefined();
  });

  it('returns budgetTokens and effortLevel for adaptive model (Opus 4.6)', () => {
    const result = getThinkingKwargsForModel('claude-opus-4-6', 'high');
    expect(result.maxThinkingTokens).toBe(16384);
    expect(result.effortLevel).toBe('high');
  });

  it('maps low thinking level correctly', () => {
    const result = getThinkingKwargsForModel('claude-opus-4-6', 'low');
    expect(result.maxThinkingTokens).toBe(1024);
    expect(result.effortLevel).toBe('low');
  });
});

describe('transformThinkingConfig', () => {
  it('returns budgetTokens for Anthropic', () => {
    const config = transformThinkingConfig('anthropic', 'claude-sonnet-4-5-20250929', 'medium');
    expect(config.budgetTokens).toBe(4096);
    expect(config.effortLevel).toBeUndefined();
  });

  it('returns budgetTokens + effortLevel for Anthropic adaptive model', () => {
    const config = transformThinkingConfig('anthropic', 'claude-opus-4-6', 'high');
    expect(config.budgetTokens).toBe(16384);
    expect(config.effortLevel).toBe('high');
  });

  it('returns reasoningEffort for OpenAI', () => {
    const config = transformThinkingConfig('openai', 'gpt-4o', 'high');
    expect(config.reasoningEffort).toBe('high');
    expect(config.budgetTokens).toBeUndefined();
  });

  it('returns reasoningEffort for Azure', () => {
    const config = transformThinkingConfig('azure', 'gpt-4o', 'medium');
    expect(config.reasoningEffort).toBe('medium');
  });

  it('returns empty config for unsupported provider', () => {
    const config = transformThinkingConfig('groq', 'llama-3.1-70b', 'high');
    expect(config).toEqual({});
  });
});

describe('sanitizeThinkingLevel', () => {
  it('passes through valid levels', () => {
    expect(sanitizeThinkingLevel('low')).toBe('low');
    expect(sanitizeThinkingLevel('medium')).toBe('medium');
    expect(sanitizeThinkingLevel('high')).toBe('high');
  });

  it('maps ultrathink to high', () => {
    expect(sanitizeThinkingLevel('ultrathink')).toBe('high');
  });

  it('maps none to low', () => {
    expect(sanitizeThinkingLevel('none')).toBe('low');
  });

  it('defaults unknown values to medium', () => {
    expect(sanitizeThinkingLevel('invalid')).toBe('medium');
    expect(sanitizeThinkingLevel('')).toBe('medium');
  });
});

describe('normalizeToolId', () => {
  it('passes valid Anthropic tool IDs through', () => {
    expect(normalizeToolId('anthropic', 'my_tool-1')).toBe('my_tool-1');
  });

  it('sanitizes invalid chars for Anthropic', () => {
    expect(normalizeToolId('anthropic', 'my.tool@v2')).toBe('my_tool_v2');
  });

  it('truncates long OpenAI tool IDs to 64 chars', () => {
    const longId = 'a'.repeat(100);
    const result = normalizeToolId('openai', longId);
    expect(result.length).toBe(64);
  });

  it('sanitizes and truncates for Azure', () => {
    const longId = 'tool.name.'.repeat(20);
    const result = normalizeToolId('azure', longId);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).not.toContain('.');
  });

  it('passes through for other providers', () => {
    expect(normalizeToolId('groq', 'any.tool@name')).toBe('any.tool@name');
  });
});

describe('meetsCacheThreshold', () => {
  it('returns true when Anthropic content meets threshold', () => {
    expect(meetsCacheThreshold('anthropic', 'toolDefinitions', 1024)).toBe(true);
    expect(meetsCacheThreshold('anthropic', 'systemPrompt', 2000)).toBe(true);
  });

  it('returns false when below threshold', () => {
    expect(meetsCacheThreshold('anthropic', 'toolDefinitions', 500)).toBe(false);
  });

  it('returns false for non-Anthropic providers', () => {
    expect(meetsCacheThreshold('openai', 'toolDefinitions', 5000)).toBe(false);
  });
});

describe('getCacheBreakpoints', () => {
  it('returns breakpoints for Anthropic based on cumulative tokens', () => {
    // Messages: 1000, 1100 (cumulative 2100 >= 2048 → breakpoint at index 1)
    const breakpoints = getCacheBreakpoints('anthropic', [1000, 1100, 500, 4000]);
    expect(breakpoints).toContain(1);
    expect(breakpoints.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for non-Anthropic', () => {
    expect(getCacheBreakpoints('openai', [5000, 5000])).toEqual([]);
  });

  it('returns empty array for empty messages', () => {
    expect(getCacheBreakpoints('anthropic', [])).toEqual([]);
  });
});
