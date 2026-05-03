import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  MODEL_ID_MAP,
  THINKING_BUDGET_MAP,
  ADAPTIVE_THINKING_MODELS,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
} from '../types';

import {
  sanitizeThinkingLevel,
  resolveModelId,
  getModelBetas,
  getThinkingBudget,
  isAdaptiveModel,
  getThinkingKwargsForModel,
  SPEC_PHASE_THINKING_LEVELS,
  getSpecPhaseThinkingBudget,
} from '../phase-config';

describe('MODEL_ID_MAP', () => {
  it('should map all model shorthands', () => {
    expect(MODEL_ID_MAP.opus).toBe('claude-opus-4-6');
    expect(MODEL_ID_MAP['opus-1m']).toBe('claude-opus-4-6');
    expect(MODEL_ID_MAP['opus-4.5']).toBeDefined();
    expect(MODEL_ID_MAP.sonnet).toBeDefined();
    expect(MODEL_ID_MAP.haiku).toBeDefined();
  });
});

describe('THINKING_BUDGET_MAP', () => {
  it('should define budgets for all four tiers', () => {
    expect(THINKING_BUDGET_MAP.low).toBe(1024);
    expect(THINKING_BUDGET_MAP.medium).toBe(4096);
    expect(THINKING_BUDGET_MAP.high).toBe(16384);
    expect(THINKING_BUDGET_MAP.xhigh).toBe(32768);
  });

  it('should have increasing budgets', () => {
    expect(THINKING_BUDGET_MAP.low).toBeLessThan(THINKING_BUDGET_MAP.medium);
    expect(THINKING_BUDGET_MAP.medium).toBeLessThan(THINKING_BUDGET_MAP.high);
    expect(THINKING_BUDGET_MAP.high).toBeLessThan(THINKING_BUDGET_MAP.xhigh);
  });
});

describe('DEFAULT_PHASE_MODELS', () => {
  it('should define models for all phases', () => {
    expect(DEFAULT_PHASE_MODELS.spec).toBeDefined();
    expect(DEFAULT_PHASE_MODELS.planning).toBeDefined();
    expect(DEFAULT_PHASE_MODELS.coding).toBeDefined();
    expect(DEFAULT_PHASE_MODELS.qa).toBeDefined();
  });
});

describe('DEFAULT_PHASE_THINKING', () => {
  it('should define thinking levels for all phases', () => {
    expect(DEFAULT_PHASE_THINKING.spec).toBeDefined();
    expect(DEFAULT_PHASE_THINKING.planning).toBeDefined();
    expect(DEFAULT_PHASE_THINKING.coding).toBeDefined();
    expect(DEFAULT_PHASE_THINKING.qa).toBeDefined();
  });
});

describe('sanitizeThinkingLevel', () => {
  it('should pass through valid levels', () => {
    expect(sanitizeThinkingLevel('low')).toBe('low');
    expect(sanitizeThinkingLevel('medium')).toBe('medium');
    expect(sanitizeThinkingLevel('high')).toBe('high');
    expect(sanitizeThinkingLevel('xhigh')).toBe('xhigh');
  });

  it('should map legacy "ultrathink" to "high"', () => {
    expect(sanitizeThinkingLevel('ultrathink')).toBe('high');
  });

  it('should map legacy "none" to "low"', () => {
    expect(sanitizeThinkingLevel('none')).toBe('low');
  });

  it('should default unknown values to "medium"', () => {
    expect(sanitizeThinkingLevel('invalid')).toBe('medium');
    expect(sanitizeThinkingLevel('')).toBe('medium');
  });
});

describe('resolveModelId', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should resolve shorthands to model IDs', () => {
    expect(resolveModelId('opus')).toBe('claude-opus-4-6');
    expect(resolveModelId('sonnet')).toMatch(/^claude-sonnet/);
    expect(resolveModelId('haiku')).toMatch(/^claude-haiku/);
  });

  it('should pass through full model IDs unchanged', () => {
    expect(resolveModelId('claude-custom-model-123')).toBe(
      'claude-custom-model-123',
    );
  });

  it('should use env var override when set', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'custom-opus-model';
    expect(resolveModelId('opus')).toBe('custom-opus-model');
  });

  it('should use env var override for sonnet', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'custom-sonnet';
    expect(resolveModelId('sonnet')).toBe('custom-sonnet');
  });

  it('should use env var override for haiku', () => {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'custom-haiku';
    expect(resolveModelId('haiku')).toBe('custom-haiku');
  });

  it('should NOT use env var for opus-4.5', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'should-not-be-used';
    expect(resolveModelId('opus-4.5')).toBe(MODEL_ID_MAP['opus-4.5']);
  });
});

describe('getModelBetas', () => {
  it('should return betas for opus-1m', () => {
    const betas = getModelBetas('opus-1m');
    expect(betas).toHaveLength(1);
    expect(betas[0]).toContain('context-1m');
  });

  it('should return empty array for models without betas', () => {
    expect(getModelBetas('sonnet')).toEqual([]);
    expect(getModelBetas('haiku')).toEqual([]);
    expect(getModelBetas('unknown')).toEqual([]);
  });
});

describe('getThinkingBudget', () => {
  it('should return correct budgets', () => {
    expect(getThinkingBudget('low')).toBe(1024);
    expect(getThinkingBudget('medium')).toBe(4096);
    expect(getThinkingBudget('high')).toBe(16384);
    expect(getThinkingBudget('xhigh')).toBe(32768);
  });

  it('should fall back to medium for unknown levels', () => {
    expect(getThinkingBudget('unknown')).toBe(4096);
  });
});

describe('isAdaptiveModel', () => {
  it('should return true for adaptive models', () => {
    expect(isAdaptiveModel('claude-opus-4-6')).toBe(true);
  });

  it('should return false for non-adaptive models', () => {
    expect(isAdaptiveModel('claude-sonnet-4-5-20250929')).toBe(false);
    expect(isAdaptiveModel('claude-haiku-4-5-20251001')).toBe(false);
  });
});

describe('getThinkingKwargsForModel', () => {
  it('should return only maxThinkingTokens for non-adaptive models', () => {
    const kwargs = getThinkingKwargsForModel(
      'claude-sonnet-4-5-20250929',
      'high',
    );
    expect(kwargs.maxThinkingTokens).toBe(16384);
    expect(kwargs.effortLevel).toBeUndefined();
  });

  it('should return both maxThinkingTokens and effortLevel for adaptive models', () => {
    const kwargs = getThinkingKwargsForModel('claude-opus-4-6', 'high');
    expect(kwargs.maxThinkingTokens).toBe(16384);
    expect(kwargs.effortLevel).toBe('high');
  });

  it('should map thinking levels to effort levels correctly', () => {
    expect(
      getThinkingKwargsForModel('claude-opus-4-6', 'low').effortLevel,
    ).toBe('low');
    expect(
      getThinkingKwargsForModel('claude-opus-4-6', 'medium').effortLevel,
    ).toBe('medium');
  });
});

describe('SPEC_PHASE_THINKING_LEVELS', () => {
  it('should define heavy phases as high', () => {
    expect(SPEC_PHASE_THINKING_LEVELS.discovery).toBe('high');
    expect(SPEC_PHASE_THINKING_LEVELS.spec_writing).toBe('high');
    expect(SPEC_PHASE_THINKING_LEVELS.self_critique).toBe('high');
  });

  it('should define light phases as medium', () => {
    expect(SPEC_PHASE_THINKING_LEVELS.requirements).toBe('medium');
    expect(SPEC_PHASE_THINKING_LEVELS.research).toBe('medium');
    expect(SPEC_PHASE_THINKING_LEVELS.context).toBe('medium');
  });
});

describe('getSpecPhaseThinkingBudget', () => {
  it('should return high budget for heavy phases', () => {
    expect(getSpecPhaseThinkingBudget('discovery')).toBe(16384);
    expect(getSpecPhaseThinkingBudget('spec_writing')).toBe(16384);
  });

  it('should return medium budget for light phases', () => {
    expect(getSpecPhaseThinkingBudget('research')).toBe(4096);
  });

  it('should fall back to medium for unknown phases', () => {
    expect(getSpecPhaseThinkingBudget('unknown_phase')).toBe(4096);
  });
});
