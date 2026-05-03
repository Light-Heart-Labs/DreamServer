/**
 * Trust Gate Tests
 *
 * Tests contamination flagging for signals derived after external tool calls.
 */

import { describe, it, expect } from 'vitest';
import { applyTrustGate } from '../../observer/trust-gate';
import type { MemoryCandidate } from '../../types';

function makeCandidate(originatingStep: number, confidence = 0.8): MemoryCandidate {
  return {
    signalType: 'self_correction',
    proposedType: 'gotcha',
    content: 'Test memory content',
    relatedFiles: [],
    relatedModules: [],
    confidence,
    priority: 0.8,
    originatingStep,
  };
}

describe('applyTrustGate', () => {
  describe('when no external tool call has occurred', () => {
    it('returns candidate unchanged when externalToolCallStep is undefined', () => {
      const candidate = makeCandidate(10, 0.8);
      const result = applyTrustGate(candidate, undefined);
      expect(result).toEqual(candidate);
      expect(result.needsReview).toBeUndefined();
    });
  });

  describe('when external tool call has occurred', () => {
    it('flags candidate originating AFTER external tool call', () => {
      const candidate = makeCandidate(15, 0.8); // step 15 > step 10
      const result = applyTrustGate(candidate, 10);

      expect(result.needsReview).toBe(true);
      expect(result.confidence).toBeLessThan(0.8);
      expect(result.confidence).toBeCloseTo(0.8 * 0.7, 5);
      expect(result.trustFlags?.contaminated).toBe(true);
      expect(result.trustFlags?.contaminationSource).toBe('web_fetch');
    });

    it('does NOT flag candidate originating BEFORE external tool call', () => {
      const candidate = makeCandidate(5, 0.8); // step 5 < step 10
      const result = applyTrustGate(candidate, 10);

      expect(result.needsReview).toBeUndefined();
      expect(result.confidence).toBe(0.8);
      expect(result.trustFlags).toBeUndefined();
    });

    it('does NOT flag candidate at SAME step as external tool call', () => {
      const candidate = makeCandidate(10, 0.8); // step 10 === step 10 (not strictly greater)
      const result = applyTrustGate(candidate, 10);

      expect(result.needsReview).toBeUndefined();
      expect(result.confidence).toBe(0.8);
    });

    it('reduces confidence by 30%', () => {
      const candidate = makeCandidate(20, 1.0);
      const result = applyTrustGate(candidate, 5);
      expect(result.confidence).toBeCloseTo(0.7, 5);
    });

    it('preserves all other candidate fields', () => {
      const candidate = makeCandidate(20, 0.8);
      candidate.relatedFiles = ['/src/auth.ts'];
      candidate.content = 'Important content';
      const result = applyTrustGate(candidate, 5);

      expect(result.relatedFiles).toEqual(['/src/auth.ts']);
      expect(result.content).toBe('Important content');
      expect(result.signalType).toBe('self_correction');
      expect(result.proposedType).toBe('gotcha');
      expect(result.priority).toBe(0.8);
      expect(result.originatingStep).toBe(20);
    });

    it('does not mutate original candidate', () => {
      const candidate = makeCandidate(20, 0.8);
      const originalConfidence = candidate.confidence;
      applyTrustGate(candidate, 5);

      // Original should be unchanged (immutable pattern)
      expect(candidate.confidence).toBe(originalConfidence);
      expect(candidate.needsReview).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles zero step numbers', () => {
      const candidate = makeCandidate(0, 0.8);
      const result = applyTrustGate(candidate, 0);
      // originatingStep (0) is NOT > externalToolCallStep (0) — no contamination
      expect(result.needsReview).toBeUndefined();
    });

    it('handles candidate at step 1 after external call at step 0', () => {
      const candidate = makeCandidate(1, 0.9);
      const result = applyTrustGate(candidate, 0);
      // step 1 > step 0 — should be contaminated
      expect(result.needsReview).toBe(true);
    });

    it('applies standard 0.7 confidence multiplier regardless of signal type', () => {
      const signalTypes = ['co_access', 'error_retry', 'repeated_grep'] as const;
      for (const signalType of signalTypes) {
        const candidate: MemoryCandidate = {
          ...makeCandidate(15, 0.8),
          signalType,
        };
        const result = applyTrustGate(candidate, 10);
        expect(result.confidence).toBeCloseTo(0.56, 4); // 0.8 * 0.7
      }
    });
  });
});
