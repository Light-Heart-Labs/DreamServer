/**
 * StepMemoryState
 *
 * Tracks per-step memory state during a session.
 * Used by the prepareStep callback to feed context to StepInjectionDecider.
 */

import type { RecentToolCallContext } from './step-injection-decider';

// ============================================================
// STEP MEMORY STATE
// ============================================================

export class StepMemoryState {
  private recentToolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  private injectedMemoryIds = new Set<string>();

  /**
   * Record a tool call. Maintains a rolling window of the last 20 calls.
   */
  recordToolCall(toolName: string, args: Record<string, unknown>): void {
    this.recentToolCalls.push({ toolName, args });
    if (this.recentToolCalls.length > 20) {
      this.recentToolCalls.shift();
    }
  }

  /**
   * Mark memory IDs as having been injected so they are not injected again.
   */
  markInjected(memoryIds: string[]): void {
    for (const id of memoryIds) {
      this.injectedMemoryIds.add(id);
    }
  }

  /**
   * Get the recent tool call context for the injection decider.
   *
   * @param windowSize - How many of the most recent calls to include (default 5)
   */
  getRecentContext(windowSize = 5): RecentToolCallContext {
    return {
      toolCalls: this.recentToolCalls.slice(-windowSize),
      injectedMemoryIds: this.injectedMemoryIds,
    };
  }

  /**
   * Reset all state (call at session start or when starting a new subtask).
   */
  reset(): void {
    this.recentToolCalls = [];
    this.injectedMemoryIds.clear();
  }
}
