/**
 * StepInjectionDecider
 *
 * Decides whether to inject memory context between agent steps.
 * Three triggers: gotcha injection, scratchpad reflection, search short-circuit.
 */

import type { Memory, MemoryService } from '../types';
import type { Scratchpad } from '../observer/scratchpad';
import type { AcuteCandidate } from '../types';

// ============================================================
// TYPES
// ============================================================

export interface RecentToolCallContext {
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  injectedMemoryIds: Set<string>;
}

export interface StepInjection {
  content: string;
  type: 'gotcha_injection' | 'scratchpad_reflection' | 'search_short_circuit';
  memoryIds: string[];
}

// ============================================================
// STEP INJECTION DECIDER
// ============================================================

export class StepInjectionDecider {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly scratchpad: Scratchpad,
    private readonly projectId: string,
  ) {}

  /**
   * Evaluate the current step context and decide if a memory injection is warranted.
   * Returns null if no injection is needed, or a StepInjection if one should be made.
   *
   * Enforces a 50ms soft budget — if exceeded, still returns the result.
   */
  async decide(
    stepNumber: number,
    recentContext: RecentToolCallContext,
  ): Promise<StepInjection | null> {
    const start = process.hrtime.bigint();

    try {
      // Trigger 1: Agent read a file with unseen gotchas
      const recentReads = recentContext.toolCalls
        .filter((t) => t.toolName === 'Read' || t.toolName === 'Edit')
        .map((t) => t.args.file_path as string)
        .filter(Boolean);

      if (recentReads.length > 0) {
        const freshGotchas = await this.memoryService.search({
          types: ['gotcha', 'error_pattern', 'dead_end'],
          relatedFiles: recentReads,
          limit: 4,
          minConfidence: 0.65,
          projectId: this.projectId,
          filter: (m) => !recentContext.injectedMemoryIds.has(m.id),
        });

        if (freshGotchas.length > 0) {
          return {
            content: this.formatGotchas(freshGotchas),
            type: 'gotcha_injection',
            memoryIds: freshGotchas.map((m) => m.id),
          };
        }
      }

      // Trigger 2: New scratchpad entry from agent's record_memory call
      const newEntries = this.scratchpad.getNewSince(stepNumber - 1);
      if (newEntries.length > 0) {
        return {
          content: this.formatScratchpadEntries(newEntries),
          type: 'scratchpad_reflection',
          memoryIds: [],
        };
      }

      // Trigger 3: Agent is searching for something already in memory
      const recentSearches = recentContext.toolCalls
        .filter((t) => t.toolName === 'Grep' || t.toolName === 'Glob')
        .slice(-3);

      for (const search of recentSearches) {
        const pattern = (search.args.pattern ?? search.args.glob ?? '') as string;
        if (!pattern) continue;

        const known = await this.memoryService.searchByPattern(pattern);
        if (known && !recentContext.injectedMemoryIds.has(known.id)) {
          return {
            content: `MEMORY CONTEXT: ${known.content}`,
            type: 'search_short_circuit',
            memoryIds: [known.id],
          };
        }
      }

      return null;
    } catch {
      // Gracefully return null on any failure — never disrupt the agent loop
      return null;
    } finally {
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
      if (elapsed > 50) {
        console.warn(`[StepInjectionDecider] decide() exceeded 50ms budget: ${elapsed.toFixed(2)}ms`);
      }
    }
  }

  // ============================================================
  // PRIVATE FORMATTING HELPERS
  // ============================================================

  private formatGotchas(memories: Memory[]): string {
    const bullets = memories
      .map((m) => {
        const fileContext =
          m.relatedFiles.length > 0
            ? ` (${m.relatedFiles.map((f) => f.split('/').pop()).join(', ')})`
            : '';
        return `- [${m.type}]${fileContext}: ${m.content}`;
      })
      .join('\n');

    return `MEMORY ALERT — Gotchas for files you just accessed:\n${bullets}`;
  }

  private formatScratchpadEntries(entries: AcuteCandidate[]): string {
    const lines = entries
      .map((e) => {
        const rawData = e.rawData as Record<string, unknown>;
        const text = String(rawData.triggeringText ?? rawData.matchedText ?? '').slice(0, 200);
        return `- [step ${e.stepNumber}] ${e.signalType}: ${text}`;
      })
      .join('\n');

    return `MEMORY REFLECTION — New observations recorded this step:\n${lines}`;
  }
}
