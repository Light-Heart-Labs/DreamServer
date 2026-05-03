/**
 * Trust Gate — Anti-Injection Defense
 *
 * Inspired by the Windsurf SpAIware exploit.
 * Any signal derived from agent output produced after a WebFetch or WebSearch call
 * is flagged as potentially tainted (may contain prompt-injection payloads).
 */

import type { MemoryCandidate } from '../types';

/**
 * Apply the trust gate to a memory candidate.
 *
 * If the candidate originated AFTER an external tool call (WebFetch/WebSearch),
 * it is flagged as needing review and its confidence is reduced by 30%.
 */
export function applyTrustGate(
  candidate: MemoryCandidate,
  externalToolCallStep: number | undefined,
): MemoryCandidate {
  if (externalToolCallStep !== undefined && candidate.originatingStep > externalToolCallStep) {
    return {
      ...candidate,
      needsReview: true,
      confidence: candidate.confidence * 0.7,
      trustFlags: {
        contaminated: true,
        contaminationSource: 'web_fetch',
      },
    };
  }
  return candidate;
}
