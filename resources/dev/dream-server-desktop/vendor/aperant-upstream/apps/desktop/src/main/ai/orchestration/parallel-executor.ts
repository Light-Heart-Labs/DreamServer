/**
 * Parallel Executor
 * =================
 *
 * Replaces the Claude Agent SDK `agents` parameter for concurrent subtask execution.
 * Uses Promise.allSettled() over concurrent runAgentSession() calls so that
 * per-call failures don't block successful subtasks.
 *
 * Handles:
 * - Concurrency limiting (configurable max parallel sessions)
 * - Per-call failure isolation (failed subtasks don't block others)
 * - Rate limit detection with automatic back-off
 * - Cancellation via AbortSignal
 */

import type { SessionResult } from '../session/types';
import type { SubtaskInfo } from './build-orchestrator';

// =============================================================================
// Constants
// =============================================================================

/** Default maximum number of concurrent sessions */
const DEFAULT_MAX_CONCURRENCY = 3;

/** Base delay for rate limit back-off (ms) */
const RATE_LIMIT_BASE_DELAY_MS = 30_000;

/** Maximum rate limit back-off delay (ms) */
const RATE_LIMIT_MAX_DELAY_MS = 300_000;

/** Delay between launching concurrent sessions to stagger API calls (ms) */
const STAGGER_DELAY_MS = 1_000;

// =============================================================================
// Types
// =============================================================================

/** Configuration for parallel execution */
export interface ParallelExecutorConfig {
  /** Maximum number of concurrent sessions */
  maxConcurrency?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Called when a subtask execution starts */
  onSubtaskStart?: (subtask: SubtaskInfo) => void;
  /** Called when a subtask execution completes (success or failure) */
  onSubtaskComplete?: (subtask: SubtaskInfo, result: SessionResult) => void;
  /** Called when a subtask fails */
  onSubtaskFailed?: (subtask: SubtaskInfo, error: Error) => void;
  /** Called when a rate limit is detected */
  onRateLimited?: (delayMs: number) => void;
}

/** Function that runs a single subtask session */
export type SubtaskSessionRunner = (subtask: SubtaskInfo) => Promise<SessionResult>;

/** Result of a single parallel execution */
export interface ParallelSubtaskResult {
  subtaskId: string;
  /** Whether the session succeeded */
  success: boolean;
  /** The session result (if the session ran) */
  result?: SessionResult;
  /** Error (if the session threw) */
  error?: string;
  /** Whether this subtask was rate limited */
  rateLimited: boolean;
}

/** Result of the full parallel execution batch */
export interface ParallelExecutionResult {
  /** Individual results for each subtask */
  results: ParallelSubtaskResult[];
  /** Number of subtasks that completed successfully */
  successCount: number;
  /** Number of subtasks that failed */
  failureCount: number;
  /** Number of subtasks that were rate limited */
  rateLimitedCount: number;
  /** Whether execution was cancelled */
  cancelled: boolean;
}

// =============================================================================
// Parallel Executor
// =============================================================================

/**
 * Execute multiple subtask sessions concurrently with concurrency limiting.
 *
 * Uses Promise.allSettled() so individual failures don't reject the batch.
 * Rate-limited sessions are tracked separately for retry scheduling.
 */
export async function executeParallel(
  subtasks: SubtaskInfo[],
  runSession: SubtaskSessionRunner,
  config: ParallelExecutorConfig = {},
): Promise<ParallelExecutionResult> {
  const maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  if (subtasks.length === 0) {
    return {
      results: [],
      successCount: 0,
      failureCount: 0,
      rateLimitedCount: 0,
      cancelled: false,
    };
  }

  // Split into batches based on concurrency limit
  const batches = createBatches(subtasks, maxConcurrency);
  const allResults: ParallelSubtaskResult[] = [];
  let rateLimitBackoff = 0;

  for (const batch of batches) {
    if (config.abortSignal?.aborted) {
      // Mark remaining as cancelled
      break;
    }

    // Wait for rate limit back-off if needed
    if (rateLimitBackoff > 0) {
      config.onRateLimited?.(rateLimitBackoff);
      await delay(rateLimitBackoff, config.abortSignal);
      rateLimitBackoff = 0;
    }

    // Execute batch concurrently with staggered starts
    const batchPromises = batch.map((subtask, index) =>
      executeSingleSubtask(subtask, runSession, config, index * STAGGER_DELAY_MS),
    );

    const settled = await Promise.allSettled(batchPromises);

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        allResults.push(outcome.value);

        // Detect rate limiting for back-off
        if (outcome.value.rateLimited) {
          rateLimitBackoff = Math.min(
            RATE_LIMIT_BASE_DELAY_MS * (2 ** allResults.filter((r) => r.rateLimited).length),
            RATE_LIMIT_MAX_DELAY_MS,
          );
        }
      } else {
        // Promise.allSettled rejection — unexpected throw
        allResults.push({
          subtaskId: 'unknown',
          success: false,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          rateLimited: false,
        });
      }
    }
  }

  const successCount = allResults.filter((r) => r.success).length;
  const rateLimitedCount = allResults.filter((r) => r.rateLimited).length;

  return {
    results: allResults,
    successCount,
    failureCount: allResults.length - successCount,
    rateLimitedCount,
    cancelled: config.abortSignal?.aborted ?? false,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Execute a single subtask with error isolation.
 */
async function executeSingleSubtask(
  subtask: SubtaskInfo,
  runSession: SubtaskSessionRunner,
  config: ParallelExecutorConfig,
  staggerDelayMs: number,
): Promise<ParallelSubtaskResult> {
  // Stagger to avoid thundering herd
  if (staggerDelayMs > 0) {
    await delay(staggerDelayMs, config.abortSignal);
  }

  if (config.abortSignal?.aborted) {
    return {
      subtaskId: subtask.id,
      success: false,
      error: 'Cancelled',
      rateLimited: false,
    };
  }

  config.onSubtaskStart?.(subtask);

  try {
    const result = await runSession(subtask);

    const rateLimited = result.outcome === 'rate_limited';
    const success = result.outcome === 'completed';

    if (success || rateLimited) {
      config.onSubtaskComplete?.(subtask, result);
    } else if (result.outcome === 'error' || result.outcome === 'auth_failure') {
      config.onSubtaskFailed?.(
        subtask,
        new Error(result.error?.message ?? `Session ended with outcome: ${result.outcome}`),
      );
    }

    return {
      subtaskId: subtask.id,
      success,
      result,
      rateLimited,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    config.onSubtaskFailed?.(subtask, error instanceof Error ? error : new Error(message));

    return {
      subtaskId: subtask.id,
      success: false,
      error: message,
      rateLimited: isRateLimitError(message),
    };
  }
}

/**
 * Split an array into batches of the given size.
 */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Check if an error message indicates a rate limit.
 */
function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests');
}

/**
 * Delay with abort signal support.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
