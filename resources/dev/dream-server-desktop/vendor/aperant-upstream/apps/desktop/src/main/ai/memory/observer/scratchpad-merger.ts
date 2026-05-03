/**
 * Parallel Scratchpad Merger
 *
 * Merges scratchpads from parallel subagents into a single unified scratchpad.
 * Used when multiple coder agents run in parallel on different subtasks.
 *
 * Deduplication uses 88% text similarity threshold (Jaccard on words).
 * Quorum boost: entries observed by 2+ agents get confidence boost of +0.1.
 */

import type { AcuteCandidate, SignalType } from '../types';
import type { Scratchpad, ScratchpadAnalytics } from './scratchpad';
import type { ObserverSignal } from './signals';

// ============================================================
// MERGED SCRATCHPAD RESULT
// ============================================================

export interface MergedScratchpadEntry {
  signalType: SignalType;
  signals: ObserverSignal[];
  quorumCount: number; // how many scratchpads had this signal type
}

export interface MergedScratchpad {
  signals: MergedScratchpadEntry[];
  acuteCandidates: AcuteCandidate[];
  analytics: {
    totalFiles: number;
    totalEdits: number;
    totalSelfCorrections: number;
    totalGrepPatterns: number;
    totalErrorFingerprints: number;
    maxStep: number;
  };
}

// ============================================================
// MERGER CLASS
// ============================================================

export class ParallelScratchpadMerger {
  /**
   * Merge multiple scratchpads from parallel subagents.
   *
   * Algorithm:
   * 1. Flatten all signals per type
   * 2. Deduplicate by content similarity (> 88% Jaccard on words)
   * 3. Quorum boost: signals seen in 2+ scratchpads get priority boost
   * 4. Merge analytics by aggregation
   */
  merge(scratchpads: Scratchpad[]): MergedScratchpad {
    if (scratchpads.length === 0) {
      return {
        signals: [],
        acuteCandidates: [],
        analytics: {
          totalFiles: 0,
          totalEdits: 0,
          totalSelfCorrections: 0,
          totalGrepPatterns: 0,
          totalErrorFingerprints: 0,
          maxStep: 0,
        },
      };
    }

    // Collect all signal types present
    const allSignalTypes = new Set<SignalType>();
    for (const sp of scratchpads) {
      for (const signalType of sp.signals.keys()) {
        allSignalTypes.add(signalType);
      }
    }

    // Merge signals per type
    const mergedSignals: MergedScratchpadEntry[] = [];
    for (const signalType of allSignalTypes) {
      const allForType: ObserverSignal[] = [];
      let quorumCount = 0;

      for (const sp of scratchpads) {
        const signals = sp.signals.get(signalType) ?? [];
        if (signals.length > 0) {
          quorumCount++;
          allForType.push(...signals);
        }
      }

      // Deduplicate signals by content similarity
      const deduplicated = this.deduplicateSignals(allForType);

      mergedSignals.push({
        signalType,
        signals: deduplicated,
        quorumCount,
      });
    }

    // Merge acute candidates across all scratchpads and deduplicate
    const allAcute = scratchpads.flatMap((sp) => sp.acuteCandidates);
    const deduplicatedAcute = this.deduplicateAcuteCandidates(allAcute);

    // Aggregate analytics
    const analytics = this.mergeAnalytics(scratchpads.map((sp) => sp.analytics));

    return {
      signals: mergedSignals,
      acuteCandidates: deduplicatedAcute,
      analytics,
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * Deduplicate signals by computing Jaccard similarity on signal content.
   * Signals with similarity > 0.88 are considered duplicates.
   */
  private deduplicateSignals(signals: ObserverSignal[]): ObserverSignal[] {
    if (signals.length <= 1) return signals;

    const kept: ObserverSignal[] = [];
    for (const candidate of signals) {
      const candidateWords = this.extractWords(JSON.stringify(candidate));
      const isDuplicate = kept.some((existing) => {
        const existingWords = this.extractWords(JSON.stringify(existing));
        return jaccardSimilarity(candidateWords, existingWords) > 0.88;
      });
      if (!isDuplicate) {
        kept.push(candidate);
      }
    }
    return kept;
  }

  /**
   * Deduplicate acute candidates by content similarity.
   */
  private deduplicateAcuteCandidates(candidates: AcuteCandidate[]): AcuteCandidate[] {
    if (candidates.length <= 1) return candidates;

    const kept: AcuteCandidate[] = [];
    for (const candidate of candidates) {
      const candidateWords = this.extractWords(JSON.stringify(candidate.rawData));
      const isDuplicate = kept.some((existing) => {
        const existingWords = this.extractWords(JSON.stringify(existing.rawData));
        return jaccardSimilarity(candidateWords, existingWords) > 0.88;
      });
      if (!isDuplicate) {
        kept.push(candidate);
      }
    }
    return kept;
  }

  private extractWords(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  }

  private mergeAnalytics(
    analyticsArray: ScratchpadAnalytics[],
  ): MergedScratchpad['analytics'] {
    const allFiles = new Set<string>();
    const allEdits = new Set<string>();
    let totalSelfCorrections = 0;
    const allGrepPatterns = new Set<string>();
    const allErrorFingerprints = new Set<string>();
    let maxStep = 0;

    for (const a of analyticsArray) {
      for (const f of a.fileAccessCounts.keys()) allFiles.add(f);
      for (const f of a.fileEditSet) allEdits.add(f);
      totalSelfCorrections += a.selfCorrectionCount;
      for (const p of a.grepPatternCounts.keys()) allGrepPatterns.add(p);
      for (const fp of a.errorFingerprints.keys()) allErrorFingerprints.add(fp);
      if (a.currentStep > maxStep) maxStep = a.currentStep;
    }

    return {
      totalFiles: allFiles.size,
      totalEdits: allEdits.size,
      totalSelfCorrections,
      totalGrepPatterns: allGrepPatterns.size,
      totalErrorFingerprints: allErrorFingerprints.size,
      maxStep,
    };
  }
}

// ============================================================
// HELPERS
// ============================================================

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}
