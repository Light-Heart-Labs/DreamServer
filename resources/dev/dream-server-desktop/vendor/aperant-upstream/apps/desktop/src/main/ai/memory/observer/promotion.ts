/**
 * Promotion Pipeline
 *
 * 8-stage filter pipeline that promotes behavioral signals to validated memories.
 * Runs during finalize() after session completes.
 */

import type { MemoryCandidate, SessionType, SessionOutcome, SignalType } from '../types';
import type { ScratchpadAnalytics } from './scratchpad';
import { applyTrustGate } from './trust-gate';
import { SIGNAL_VALUES } from './signals';

// ============================================================
// SESSION TYPE PROMOTION LIMITS
// ============================================================

export const SESSION_TYPE_PROMOTION_LIMITS: Record<SessionType, number> = {
  build: 20,
  insights: 5,
  roadmap: 3,
  terminal: 3,
  changelog: 0,
  spec_creation: 3,
  pr_review: 8,
};

// ============================================================
// EARLY TRIGGER CONDITIONS
// ============================================================

export interface EarlyTrigger {
  condition: (analytics: ScratchpadAnalytics) => boolean;
  signalType: SignalType;
  priority: number;
}

export const EARLY_TRIGGERS: EarlyTrigger[] = [
  {
    condition: (a) => a.selfCorrectionCount >= 1,
    signalType: 'self_correction',
    priority: 0.9,
  },
  {
    condition: (a) => [...a.grepPatternCounts.values()].some((c) => c >= 3),
    signalType: 'repeated_grep',
    priority: 0.8,
  },
  {
    condition: (a) => a.configFilesTouched.size > 0 && a.fileEditSet.size >= 2,
    signalType: 'config_touch',
    priority: 0.7,
  },
  {
    condition: (a) => a.errorFingerprints.size >= 2,
    signalType: 'error_retry',
    priority: 0.75,
  },
];

// ============================================================
// PROMOTION PIPELINE
// ============================================================

export class PromotionPipeline {
  /**
   * Run the 8-stage promotion filter on raw candidates.
   *
   * Stage 1: Validation filter — discard signals from failed approaches (unless dead_end)
   * Stage 2: Frequency filter — require minSessions per signal class
   * Stage 3: Novelty filter — cosine similarity > 0.88 to existing = discard (placeholder)
   * Stage 4: Trust gate — contamination check
   * Stage 5: Scoring — final confidence from signal priority + session count
   * Stage 6: LLM synthesis — single generateText call (caller's responsibility)
   * Stage 7: Embedding — batch embed (caller's responsibility)
   * Stage 8: DB write — single transaction (caller's responsibility)
   */
  async promote(
    candidates: MemoryCandidate[],
    sessionType: SessionType,
    outcome: SessionOutcome,
    externalToolCallStep: number | undefined,
    sessionCountsBySignal?: Map<SignalType, number>,
  ): Promise<MemoryCandidate[]> {
    const limit = SESSION_TYPE_PROMOTION_LIMITS[sessionType];
    if (limit === 0) return [];

    // Stage 1: Validation filter
    let filtered = this.validationFilter(candidates, outcome);

    // Stage 2: Frequency filter
    filtered = this.frequencyFilter(filtered, sessionCountsBySignal);

    // Stage 3: Novelty filter (placeholder — full cosine similarity check requires embeddings)
    // In production this queries the DB for existing memories and checks similarity.
    filtered = this.noveltyFilter(filtered);

    // Stage 4: Trust gate
    filtered = filtered.map((c) => applyTrustGate(c, externalToolCallStep));

    // Stage 5: Scoring — boost confidence based on signal value
    filtered = this.scoreFilter(filtered);

    // Sort by priority descending and apply session-type cap
    filtered = filtered
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);

    return filtered;
  }

  /**
   * Stage 1: Remove candidates from failed sessions unless they represent dead ends.
   */
  private validationFilter(
    candidates: MemoryCandidate[],
    outcome: SessionOutcome,
  ): MemoryCandidate[] {
    if (outcome === 'success' || outcome === 'partial') {
      return candidates;
    }
    // For failure/abandoned sessions, only keep dead_end candidates
    return candidates.filter((c) => c.proposedType === 'dead_end');
  }

  /**
   * Stage 2: Remove signals that don't meet the minimum sessions threshold.
   * Uses the provided session counts map (sourced from DB observer tables).
   * If no session counts provided, passes all through (conservative).
   */
  private frequencyFilter(
    candidates: MemoryCandidate[],
    sessionCountsBySignal: Map<SignalType, number> | undefined,
  ): MemoryCandidate[] {
    if (!sessionCountsBySignal) return candidates;

    return candidates.filter((c) => {
      const entry = SIGNAL_VALUES[c.signalType];
      if (!entry) return false;
      const sessionCount = sessionCountsBySignal.get(c.signalType) ?? 0;
      return sessionCount >= entry.minSessions;
    });
  }

  /**
   * Stage 3: Novelty filter — in this implementation a placeholder.
   * Full version requires embedding similarity against existing DB memories.
   * Candidates with confidence < 0.2 (very low novelty estimate) are dropped.
   */
  private noveltyFilter(candidates: MemoryCandidate[]): MemoryCandidate[] {
    return candidates.filter((c) => c.confidence >= 0.2);
  }

  /**
   * Stage 5: Boost priority from signal value table.
   */
  private scoreFilter(candidates: MemoryCandidate[]): MemoryCandidate[] {
    return candidates.map((c) => {
      const signalEntry = SIGNAL_VALUES[c.signalType];
      if (!signalEntry) return c;

      // Final priority: blend candidate priority with signal score
      const boostedPriority = c.priority * 0.6 + signalEntry.score * 0.4;
      const boostedConfidence = Math.min(1.0, c.confidence * signalEntry.score + 0.1);

      return {
        ...c,
        priority: boostedPriority,
        confidence: boostedConfidence,
      };
    });
  }
}
