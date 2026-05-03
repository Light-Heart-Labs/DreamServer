/**
 * Recovery Manager
 * ================
 *
 * See apps/desktop/src/main/ai/orchestration/recovery-manager.ts for the TypeScript implementation.
 * Handles checkpoint/recovery logic for the build pipeline:
 * - Save progress to build-progress.txt
 * - Resume from last completed subtask on restart
 * - Track attempt history per subtask
 * - Classify failures and determine recovery actions
 * - Detect circular fixes (same error repeated)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { safeParseJson } from '../../utils/json-repair';

// =============================================================================
// Constants
// =============================================================================

/** Only count attempts within this window (ms) — 2 hours */
const ATTEMPT_WINDOW_MS = 2 * 60 * 60 * 1_000;

/** Maximum stored attempts per subtask */
const MAX_ATTEMPTS_PER_SUBTASK = 50;

/** Minimum identical errors to flag circular fix */
const CIRCULAR_FIX_THRESHOLD = 3;

// =============================================================================
// Types
// =============================================================================

/** Types of failures that can occur during builds */
export type FailureType =
  | 'broken_build'
  | 'verification_failed'
  | 'circular_fix'
  | 'context_exhausted'
  | 'rate_limited'
  | 'auth_failure'
  | 'unknown';

/** Recovery action to take in response to a failure */
export interface RecoveryAction {
  /** What to do: rollback, retry, skip, or escalate */
  action: 'rollback' | 'retry' | 'skip' | 'escalate';
  /** Target (commit hash, subtask ID, or descriptive message) */
  target: string;
  /** Reason for this recovery action */
  reason: string;
}

/** A single recorded attempt */
interface AttemptRecord {
  timestamp: string;
  error: string;
  failureType: FailureType;
  /** Short hash of the error for circular fix detection */
  errorHash: string;
}

/** Persisted attempt history */
interface AttemptHistory {
  subtasks: Record<string, AttemptRecord[]>;
  stuckSubtasks: string[];
  metadata: {
    createdAt: string;
    lastUpdated: string;
  };
}

/** Checkpoint data written to build-progress.txt */
export interface BuildCheckpoint {
  /** Spec number or ID */
  specId: string;
  /** Current phase */
  phase: string;
  /** Last completed subtask ID */
  lastCompletedSubtaskId: string | null;
  /** Total subtasks */
  totalSubtasks: number;
  /** Completed subtask count */
  completedSubtasks: number;
  /** Stuck subtask IDs */
  stuckSubtasks: string[];
  /** Timestamp */
  timestamp: string;
  /** Whether the build is complete */
  isComplete: boolean;
}

// =============================================================================
// Recovery Manager
// =============================================================================

/**
 * Manages recovery from build failures and checkpoint/resume logic.
 *
 * See apps/desktop/src/main/ai/orchestration/recovery-manager.ts RecoveryManager.
 */
export class RecoveryManager {
  private specDir: string;
  private projectDir: string;
  private memoryDir: string;
  private attemptHistoryPath: string;

  constructor(specDir: string, projectDir: string) {
    this.specDir = specDir;
    this.projectDir = projectDir;
    this.memoryDir = join(specDir, 'memory');
    this.attemptHistoryPath = join(this.memoryDir, 'attempt_history.json');
  }

  /**
   * Initialize the recovery manager — ensure memory directory exists.
   */
  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });

    // Initialize attempt history if not present
    try {
      await readFile(this.attemptHistoryPath, 'utf-8');
    } catch {
      await this.saveAttemptHistory(this.createEmptyHistory());
    }
  }

  // ===========================================================================
  // Failure Classification
  // ===========================================================================

  /**
   * Classify the type of failure from an error message.
   */
  classifyFailure(error: string, subtaskId: string): FailureType {
    const lower = error.toLowerCase();

    // Build errors
    const buildErrors = [
      'syntax error', 'compilation error', 'module not found',
      'import error', 'cannot find module', 'unexpected token',
      'indentation error', 'parse error',
    ];
    if (buildErrors.some((e) => lower.includes(e))) {
      return 'broken_build';
    }

    // Verification failures
    const verificationErrors = [
      'verification failed', 'expected', 'assertion',
      'test failed', 'status code',
    ];
    if (verificationErrors.some((e) => lower.includes(e))) {
      return 'verification_failed';
    }

    // Context exhaustion
    if (lower.includes('context') || lower.includes('token limit') || lower.includes('maximum length')) {
      return 'context_exhausted';
    }

    // Rate limiting
    if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
      return 'rate_limited';
    }

    // Auth failure
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
      return 'auth_failure';
    }

    // Check for circular fixes asynchronously — caller should use isCircularFix() separately
    return 'unknown';
  }

  // ===========================================================================
  // Attempt Tracking
  // ===========================================================================

  /**
   * Record an attempt for a subtask.
   */
  async recordAttempt(subtaskId: string, error: string): Promise<void> {
    const history = await this.loadAttemptHistory();
    const failureType = this.classifyFailure(error, subtaskId);
    const record: AttemptRecord = {
      timestamp: new Date().toISOString(),
      error: error.slice(0, 500), // Truncate long errors
      failureType,
      errorHash: simpleHash(error),
    };

    if (!history.subtasks[subtaskId]) {
      history.subtasks[subtaskId] = [];
    }

    history.subtasks[subtaskId].push(record);

    // Cap stored attempts
    if (history.subtasks[subtaskId].length > MAX_ATTEMPTS_PER_SUBTASK) {
      history.subtasks[subtaskId] = history.subtasks[subtaskId].slice(-MAX_ATTEMPTS_PER_SUBTASK);
    }

    await this.saveAttemptHistory(history);
  }

  /**
   * Get the number of recent attempts for a subtask (within the time window).
   */
  async getAttemptCount(subtaskId: string): Promise<number> {
    const history = await this.loadAttemptHistory();
    const attempts = history.subtasks[subtaskId] ?? [];
    const cutoff = Date.now() - ATTEMPT_WINDOW_MS;

    return attempts.filter((a) => new Date(a.timestamp).getTime() > cutoff).length;
  }

  /**
   * Detect if a subtask is in a circular fix loop.
   * Returns true if the same error hash appears >= CIRCULAR_FIX_THRESHOLD times.
   */
  async isCircularFix(subtaskId: string): Promise<boolean> {
    const history = await this.loadAttemptHistory();
    const attempts = history.subtasks[subtaskId] ?? [];
    const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
    const recent = attempts.filter((a) => new Date(a.timestamp).getTime() > cutoff);

    // Count occurrences of each error hash
    const hashCounts = new Map<string, number>();
    for (const attempt of recent) {
      const count = (hashCounts.get(attempt.errorHash) ?? 0) + 1;
      hashCounts.set(attempt.errorHash, count);
      if (count >= CIRCULAR_FIX_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  /**
   * Mark a subtask as stuck.
   */
  async markStuck(subtaskId: string): Promise<void> {
    const history = await this.loadAttemptHistory();
    if (!history.stuckSubtasks.includes(subtaskId)) {
      history.stuckSubtasks.push(subtaskId);
    }
    await this.saveAttemptHistory(history);
  }

  /**
   * Check if a subtask is marked as stuck.
   */
  async isStuck(subtaskId: string): Promise<boolean> {
    const history = await this.loadAttemptHistory();
    return history.stuckSubtasks.includes(subtaskId);
  }

  // ===========================================================================
  // Recovery Actions
  // ===========================================================================

  /**
   * Determine the recovery action for a failed subtask.
   */
  async determineRecoveryAction(
    subtaskId: string,
    error: string,
    maxRetries: number,
  ): Promise<RecoveryAction> {
    const failureType = this.classifyFailure(error, subtaskId);
    const attemptCount = await this.getAttemptCount(subtaskId);
    const circular = await this.isCircularFix(subtaskId);

    // Circular fix → escalate immediately
    if (circular) {
      return {
        action: 'escalate',
        target: subtaskId,
        reason: `Circular fix detected for ${subtaskId} — same error repeated ${CIRCULAR_FIX_THRESHOLD}+ times`,
      };
    }

    // Exceeded max retries → skip or escalate
    if (attemptCount >= maxRetries) {
      return {
        action: 'skip',
        target: subtaskId,
        reason: `Exceeded max retries (${maxRetries}) for ${subtaskId}`,
      };
    }

    // Rate limited → retry after delay
    if (failureType === 'rate_limited') {
      return {
        action: 'retry',
        target: subtaskId,
        reason: 'Rate limited — will retry after back-off',
      };
    }

    // Auth failure → escalate (needs user intervention)
    if (failureType === 'auth_failure') {
      return {
        action: 'escalate',
        target: subtaskId,
        reason: 'Authentication failure — requires credential refresh',
      };
    }

    // Context exhausted → retry (session runner handles splitting)
    if (failureType === 'context_exhausted') {
      return {
        action: 'retry',
        target: subtaskId,
        reason: 'Context exhausted — retrying with fresh context',
      };
    }

    // Default: retry
    return {
      action: 'retry',
      target: subtaskId,
      reason: `Failure type: ${failureType}, attempt ${attemptCount + 1}/${maxRetries}`,
    };
  }

  // ===========================================================================
  // Checkpointing
  // ===========================================================================

  /**
   * Save a build checkpoint to build-progress.txt.
   * This allows resuming from the last completed subtask on restart.
   */
  async saveCheckpoint(checkpoint: BuildCheckpoint): Promise<void> {
    const progressPath = join(this.specDir, 'build-progress.txt');
    const lines = [
      `# Build Progress Checkpoint`,
      `# Generated: ${checkpoint.timestamp}`,
      ``,
      `spec_id: ${checkpoint.specId}`,
      `phase: ${checkpoint.phase}`,
      `last_completed_subtask: ${checkpoint.lastCompletedSubtaskId ?? 'none'}`,
      `total_subtasks: ${checkpoint.totalSubtasks}`,
      `completed_subtasks: ${checkpoint.completedSubtasks}`,
      `stuck_subtasks: ${checkpoint.stuckSubtasks.length > 0 ? checkpoint.stuckSubtasks.join(', ') : 'none'}`,
      `is_complete: ${checkpoint.isComplete}`,
      ``,
    ];

    await writeFile(progressPath, lines.join('\n'), 'utf-8');
  }

  /**
   * Load the last checkpoint from build-progress.txt.
   * Returns null if no checkpoint exists or the file is unparseable.
   */
  async loadCheckpoint(): Promise<BuildCheckpoint | null> {
    const progressPath = join(this.specDir, 'build-progress.txt');

    try {
      const content = await readFile(progressPath, 'utf-8');
      return parseCheckpoint(content);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private async loadAttemptHistory(): Promise<AttemptHistory> {
    try {
      const raw = await readFile(this.attemptHistoryPath, 'utf-8');
      const parsed = safeParseJson<AttemptHistory>(raw);
      if (parsed) return parsed;
      // Fall through to create empty history
    } catch {
      // Fall through to create empty history
    }
    const empty = this.createEmptyHistory();
    await this.saveAttemptHistory(empty);
    return empty;
  }

  private async saveAttemptHistory(history: AttemptHistory): Promise<void> {
    history.metadata.lastUpdated = new Date().toISOString();
    await writeFile(this.attemptHistoryPath, JSON.stringify(history, null, 2), 'utf-8');
  }

  private createEmptyHistory(): AttemptHistory {
    const now = new Date().toISOString();
    return {
      subtasks: {},
      stuckSubtasks: [],
      metadata: {
        createdAt: now,
        lastUpdated: now,
      },
    };
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Simple string hash for circular fix detection.
 * Not cryptographic — just for deduplication.
 */
function simpleHash(str: string): string {
  let hash = 0;
  const normalized = str.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Parse a build-progress.txt checkpoint file.
 */
function parseCheckpoint(content: string): BuildCheckpoint | null {
  const getValue = (key: string): string | undefined => {
    const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim();
  };

  const specId = getValue('spec_id');
  const phase = getValue('phase');
  if (!specId || !phase) {
    return null;
  }

  const lastCompleted = getValue('last_completed_subtask');
  const stuckRaw = getValue('stuck_subtasks');

  return {
    specId,
    phase,
    lastCompletedSubtaskId: lastCompleted === 'none' ? null : (lastCompleted ?? null),
    totalSubtasks: Number.parseInt(getValue('total_subtasks') ?? '0', 10),
    completedSubtasks: Number.parseInt(getValue('completed_subtasks') ?? '0', 10),
    stuckSubtasks: stuckRaw && stuckRaw !== 'none' ? stuckRaw.split(',').map((s) => s.trim()) : [],
    timestamp: new Date().toISOString(),
    isComplete: getValue('is_complete') === 'true',
  };
}
