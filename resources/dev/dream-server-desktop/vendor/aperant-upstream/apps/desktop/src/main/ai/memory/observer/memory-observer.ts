/**
 * Memory Observer
 *
 * Passive behavioral observation layer. Runs on the MAIN THREAD.
 * Taps every postMessage event from worker threads.
 *
 * RULES:
 * - observe() MUST complete in < 2ms
 * - observe() NEVER awaits
 * - observe() NEVER accesses the database
 * - observe() NEVER throws
 */

import type {
  MemoryIpcRequest,
  MemoryCandidate,
  SessionOutcome,
  SessionType,
  AcuteCandidate,
  SignalType,
} from '../types';
import { Scratchpad } from './scratchpad';
import { detectDeadEnd } from './dead-end-detector';
import { applyTrustGate } from './trust-gate';
import { SELF_CORRECTION_PATTERNS } from './signals';
import { SESSION_TYPE_PROMOTION_LIMITS } from './promotion';

// ============================================================
// EXTERNAL TOOL NAMES (for trust gate)
// ============================================================

const EXTERNAL_TOOL_NAMES = new Set(['WebFetch', 'WebSearch']);

// ============================================================
// MEMORY OBSERVER
// ============================================================

export class MemoryObserver {
  private readonly scratchpad: Scratchpad;
  private readonly projectId: string;
  private externalToolCallStep: number | undefined = undefined;

  constructor(sessionId: string, sessionType: SessionType, projectId: string) {
    this.scratchpad = new Scratchpad(sessionId, sessionType);
    this.projectId = projectId;
  }

  /**
   * Called for every IPC message from worker thread.
   * MUST complete in < 2ms. Never awaits. Never accesses DB.
   */
  observe(message: MemoryIpcRequest): void {
    const start = process.hrtime.bigint();

    try {
      switch (message.type) {
        case 'memory:tool-call':
          this.onToolCall(message);
          break;
        case 'memory:tool-result':
          this.onToolResult(message);
          break;
        case 'memory:reasoning':
          this.onReasoning(message);
          break;
        case 'memory:step-complete':
          this.onStepComplete(message.stepNumber);
          break;
      }
    } catch {
      // Observer must never throw — swallow all errors silently
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (elapsed > 2) {
      console.warn(`[MemoryObserver] observe() budget exceeded: ${elapsed.toFixed(2)}ms`);
    }
  }

  /**
   * Get the underlying scratchpad for checkpointing.
   */
  getScratchpad(): Scratchpad {
    return this.scratchpad;
  }

  /**
   * Get all acute candidates captured since the given step.
   */
  getNewCandidatesSince(stepNumber: number): AcuteCandidate[] {
    return this.scratchpad.getNewSince(stepNumber);
  }

  /**
   * Finalize the session: collect all signals, apply gates, return candidates.
   *
   * This is called AFTER the session completes. It may be slow (LLM synthesis, etc.)
   * but must complete within a reasonable budget.
   */
  async finalize(outcome: SessionOutcome): Promise<MemoryCandidate[]> {
    const candidates: MemoryCandidate[] = [
      ...this.finalizeCoAccess(),
      ...this.finalizeErrorRetry(),
      ...this.finalizeAcuteCandidates(),
      ...this.finalizeRepeatedGrep(),
    ];

    // Apply trust gate to all candidates
    const gated = candidates.map((c) => applyTrustGate(c, this.externalToolCallStep));

    // Apply session-type promotion limit
    const limit = SESSION_TYPE_PROMOTION_LIMITS[this.scratchpad.sessionType];
    const filtered = gated.sort((a, b) => b.priority - a.priority).slice(0, limit);

    // Optional LLM synthesis for co-access patterns on successful builds
    if (outcome === 'success' && filtered.some((c) => c.signalType === 'co_access')) {
      const synthesized = await this.synthesizeCoAccessWithLLM(filtered);
      // Don't exceed the limit
      const remaining = limit - filtered.length;
      if (remaining > 0) {
        filtered.push(...synthesized.slice(0, remaining));
      }
    }

    return filtered;
  }

  // ============================================================
  // PRIVATE: EVENT HANDLERS (all synchronous, O(1))
  // ============================================================

  private onToolCall(
    msg: Extract<MemoryIpcRequest, { type: 'memory:tool-call' }>,
  ): void {
    const { toolName, args, stepNumber } = msg;

    // Track external tool calls for trust gate
    if (EXTERNAL_TOOL_NAMES.has(toolName)) {
      if (this.externalToolCallStep === undefined) {
        this.externalToolCallStep = stepNumber;
      }
    }

    // Update scratchpad analytics
    this.scratchpad.recordToolCall(toolName, args, stepNumber);

    // Track file edits
    if ((toolName === 'Edit' || toolName === 'Write') && typeof args.file_path === 'string') {
      this.scratchpad.recordFileEdit(args.file_path);
    }
  }

  private onToolResult(
    msg: Extract<MemoryIpcRequest, { type: 'memory:tool-result' }>,
  ): void {
    const { toolName, result, stepNumber } = msg;
    this.scratchpad.recordToolResult(toolName, result, stepNumber);
  }

  private onReasoning(
    msg: Extract<MemoryIpcRequest, { type: 'memory:reasoning' }>,
  ): void {
    const { text, stepNumber } = msg;

    // Detect self-corrections
    for (const pattern of SELF_CORRECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        this.scratchpad.recordSelfCorrection(stepNumber);

        // Create acute candidate
        const candidate: AcuteCandidate = {
          signalType: 'self_correction',
          rawData: {
            triggeringText: text.slice(0, 200),
            matchedPattern: pattern.toString(),
            matchText: match[0],
          },
          priority: 0.9,
          capturedAt: Date.now(),
          stepNumber,
        };
        this.scratchpad.acuteCandidates.push(candidate);
        break; // Only record first matching pattern per reasoning chunk
      }
    }

    // Detect dead-end language
    const deadEnd = detectDeadEnd(text);
    if (deadEnd.matched) {
      const candidate: AcuteCandidate = {
        signalType: 'backtrack',
        rawData: {
          triggeringText: text.slice(0, 200),
          matchedPattern: deadEnd.pattern,
          matchedText: deadEnd.matchedText,
        },
        priority: 0.68,
        capturedAt: Date.now(),
        stepNumber,
      };
      this.scratchpad.acuteCandidates.push(candidate);
    }
  }

  private onStepComplete(stepNumber: number): void {
    this.scratchpad.analytics.currentStep = stepNumber;
    // Co-access detection happens continuously in recordToolCall
    // Step complete is a good time to emit any pending signals
  }

  // ============================================================
  // PRIVATE: FINALIZE HELPERS
  // ============================================================

  private finalizeCoAccess(): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const { intraSessionCoAccess } = this.scratchpad.analytics;

    for (const [fileA, coFiles] of intraSessionCoAccess) {
      for (const fileB of coFiles) {
        candidates.push({
          signalType: 'co_access',
          proposedType: 'prefetch_pattern',
          content: `Files "${fileA}" and "${fileB}" are frequently accessed together in the same session.`,
          relatedFiles: [fileA, fileB],
          relatedModules: [],
          confidence: 0.65,
          priority: 0.91,
          originatingStep: this.scratchpad.analytics.currentStep,
        });
      }
    }

    return candidates;
  }

  private finalizeErrorRetry(): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const { errorFingerprints } = this.scratchpad.analytics;

    for (const [fingerprint, count] of errorFingerprints) {
      if (count >= 2) {
        candidates.push({
          signalType: 'error_retry',
          proposedType: 'error_pattern',
          content: `Recurring error pattern (fingerprint: ${fingerprint}) encountered ${count} times in this session.`,
          relatedFiles: [],
          relatedModules: [],
          confidence: 0.6 + Math.min(0.3, count * 0.05),
          priority: 0.85,
          originatingStep: this.scratchpad.analytics.currentStep,
        });
      }
    }

    return candidates;
  }

  private finalizeAcuteCandidates(): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    for (const acute of this.scratchpad.acuteCandidates) {
      const rawData = acute.rawData as Record<string, unknown>;

      if (acute.signalType === 'self_correction') {
        candidates.push({
          signalType: 'self_correction',
          proposedType: 'gotcha',
          content: `Self-correction detected: ${String(rawData.matchText ?? '').slice(0, 150)}`,
          relatedFiles: [],
          relatedModules: [],
          confidence: 0.8,
          priority: acute.priority,
          originatingStep: acute.stepNumber,
        });
      } else if (acute.signalType === 'backtrack') {
        candidates.push({
          signalType: 'backtrack',
          proposedType: 'dead_end',
          content: `Approach abandoned mid-session: ${String(rawData.matchedText ?? '').slice(0, 150)}`,
          relatedFiles: [],
          relatedModules: [],
          confidence: 0.65,
          priority: acute.priority,
          originatingStep: acute.stepNumber,
        });
      }
    }

    return candidates;
  }

  private finalizeRepeatedGrep(): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const { grepPatternCounts } = this.scratchpad.analytics;

    for (const [pattern, count] of grepPatternCounts) {
      if (count >= 3) {
        candidates.push({
          signalType: 'repeated_grep',
          proposedType: 'module_insight',
          content: `Pattern "${pattern}" was searched ${count} times — may indicate a module that is hard to navigate.`,
          relatedFiles: [],
          relatedModules: [],
          confidence: 0.55 + Math.min(0.3, count * 0.04),
          priority: 0.76,
          originatingStep: this.scratchpad.analytics.currentStep,
        });
      }
    }

    return candidates;
  }

  /**
   * Optional LLM synthesis for co-access patterns.
   * Single generateText call per session maximum.
   */
  private async synthesizeCoAccessWithLLM(
    _candidates: MemoryCandidate[],
  ): Promise<MemoryCandidate[]> {
    // Placeholder — full implementation requires access to the AI provider.
    // In production this would call generateText() with a synthesis prompt
    // to convert raw co-access data into 1-3 sentence memory content.
    // Deferred to PromotionPipeline which has access to the provider factory.
    return [];
  }
}
