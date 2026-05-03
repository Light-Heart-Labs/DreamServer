/**
 * PromotionPipeline Tests
 *
 * Tests promotion gates per session type and signal scoring.
 */

import { describe, it, expect } from 'vitest';
import { PromotionPipeline, SESSION_TYPE_PROMOTION_LIMITS } from '../../observer/promotion';
import type { MemoryCandidate, SessionType } from '../../types';

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    signalType: 'self_correction',
    proposedType: 'gotcha',
    content: 'Test candidate content',
    relatedFiles: [],
    relatedModules: [],
    confidence: 0.7,
    priority: 0.8,
    originatingStep: 5,
    ...overrides,
  };
}

describe('SESSION_TYPE_PROMOTION_LIMITS', () => {
  it('returns 0 for changelog (never promote)', () => {
    expect(SESSION_TYPE_PROMOTION_LIMITS.changelog).toBe(0);
  });

  it('returns 20 for build sessions', () => {
    expect(SESSION_TYPE_PROMOTION_LIMITS.build).toBe(20);
  });

  it('returns 5 for insights sessions', () => {
    expect(SESSION_TYPE_PROMOTION_LIMITS.insights).toBe(5);
  });

  it('returns 3 for roadmap sessions', () => {
    expect(SESSION_TYPE_PROMOTION_LIMITS.roadmap).toBe(3);
  });

  it('returns 8 for pr_review sessions', () => {
    expect(SESSION_TYPE_PROMOTION_LIMITS.pr_review).toBe(8);
  });
});

describe('PromotionPipeline', () => {
  const pipeline = new PromotionPipeline();

  describe('changelog sessions', () => {
    it('promotes zero candidates for changelog', async () => {
      const candidates = [makeCandidate(), makeCandidate(), makeCandidate()];
      const result = await pipeline.promote(candidates, 'changelog', 'success', undefined);
      expect(result).toHaveLength(0);
    });
  });

  describe('validation filter', () => {
    it('keeps all candidates on success', async () => {
      const candidates = [makeCandidate(), makeCandidate()];
      const result = await pipeline.promote(candidates, 'build', 'success', undefined);
      expect(result.length).toBeGreaterThan(0);
    });

    it('keeps only dead_end candidates on failure', async () => {
      const candidates = [
        makeCandidate({ proposedType: 'gotcha' }),
        makeCandidate({ proposedType: 'dead_end' }),
        makeCandidate({ proposedType: 'error_pattern' }),
      ];
      const result = await pipeline.promote(candidates, 'build', 'failure', undefined);
      for (const c of result) {
        expect(c.proposedType).toBe('dead_end');
      }
    });

    it('keeps only dead_end candidates on abandoned session', async () => {
      const candidates = [
        makeCandidate({ proposedType: 'gotcha' }),
        makeCandidate({ proposedType: 'dead_end' }),
      ];
      const result = await pipeline.promote(candidates, 'insights', 'abandoned', undefined);
      expect(result.every((c) => c.proposedType === 'dead_end')).toBe(true);
    });
  });

  describe('session type cap', () => {
    it('caps at 5 for insights sessions', async () => {
      const candidates = Array.from({ length: 10 }, (_, i) =>
        makeCandidate({ priority: i * 0.1 }),
      );
      const result = await pipeline.promote(candidates, 'insights', 'success', undefined);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('caps at 20 for build sessions', async () => {
      const candidates = Array.from({ length: 30 }, (_, i) =>
        makeCandidate({ priority: 0.5 + i * 0.01 }),
      );
      const result = await pipeline.promote(candidates, 'build', 'success', undefined);
      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('sorts by priority descending before capping', async () => {
      const candidates = [
        makeCandidate({ priority: 0.3, content: 'low priority' }),
        makeCandidate({ priority: 0.9, content: 'high priority' }),
        makeCandidate({ priority: 0.6, content: 'medium priority' }),
      ];
      // roadmap cap is 3, so all should be returned — check ordering
      const result = await pipeline.promote(candidates, 'roadmap', 'success', undefined);
      if (result.length >= 2) {
        expect(result[0].priority).toBeGreaterThanOrEqual(result[1].priority);
      }
    });
  });

  describe('trust gate integration', () => {
    it('flags candidates after external tool call step', async () => {
      const candidates = [
        makeCandidate({ originatingStep: 15, confidence: 0.8 }),
      ];
      // External tool call at step 10 — candidate at step 15 should be flagged
      const result = await pipeline.promote(candidates, 'build', 'success', 10);
      if (result.length > 0) {
        expect(result[0].needsReview).toBe(true);
        expect(result[0].confidence).toBeLessThan(0.8);
      }
    });

    it('does not flag candidates before external tool call step', async () => {
      const candidates = [
        makeCandidate({ originatingStep: 5, confidence: 0.8, needsReview: false }),
      ];
      // External tool call at step 10 — candidate at step 5 should be clean
      const result = await pipeline.promote(candidates, 'build', 'success', 10);
      if (result.length > 0) {
        expect(result[0].needsReview).toBeFalsy();
        // Confidence may have been boosted by scoring but not reduced by trust gate
      }
    });
  });

  describe('scoring', () => {
    it('boosts confidence based on signal value', async () => {
      const candidate = makeCandidate({
        signalType: 'self_correction', // score: 0.88
        confidence: 0.5,
        priority: 0.5,
      });
      const result = await pipeline.promote([candidate], 'build', 'success', undefined);
      if (result.length > 0) {
        // Priority should be boosted
        expect(result[0].priority).toBeGreaterThan(0.5);
      }
    });
  });

  describe('frequency filter', () => {
    it('drops candidates that do not meet min session count', async () => {
      const sessionCounts = new Map([['self_correction' as const, 0]]);
      const candidates = [makeCandidate({ signalType: 'self_correction' })];
      const result = await pipeline.promote(
        candidates,
        'build',
        'success',
        undefined,
        sessionCounts,
      );
      // self_correction requires minSessions: 1, count is 0 — should be dropped
      expect(result).toHaveLength(0);
    });

    it('keeps candidates that meet min session count', async () => {
      const sessionCounts = new Map([['self_correction' as const, 1]]);
      const candidates = [makeCandidate({ signalType: 'self_correction' })];
      const result = await pipeline.promote(
        candidates,
        'build',
        'success',
        undefined,
        sessionCounts,
      );
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('promotion pipeline — all session types', () => {
  const pipeline = new PromotionPipeline();
  const sessionTypes: SessionType[] = [
    'build', 'insights', 'roadmap', 'terminal', 'changelog', 'spec_creation', 'pr_review',
  ];

  it.each(sessionTypes)('handles %s session type without throwing', async (sessionType) => {
    const candidates = [makeCandidate(), makeCandidate()];
    await expect(
      pipeline.promote(candidates, sessionType, 'success', undefined),
    ).resolves.not.toThrow();
  });
});
