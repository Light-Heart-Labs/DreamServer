/**
 * Scratchpad
 *
 * In-memory accumulator for a single agent session.
 * Holds all behavioral signals, analytics, and acute candidates.
 *
 * RULES:
 * - Never writes to the database during execution
 * - All analytics updates are O(1)
 * - Checkpoint to disk at subtask boundaries for crash recovery
 */

import { createHash } from 'crypto';
import type { Client } from '@libsql/client';
import type { SignalType, SessionType, AcuteCandidate, WorkUnitRef } from '../types';
import type { ObserverSignal } from './signals';

// ============================================================
// ANALYTICS INTERFACE
// ============================================================

export interface ScratchpadAnalytics {
  fileAccessCounts: Map<string, number>;
  fileFirstAccess: Map<string, number>;  // step number of first access
  fileLastAccess: Map<string, number>;   // step number of last access
  fileEditSet: Set<string>;
  grepPatternCounts: Map<string, number>;
  grepPatternResults: Map<string, boolean[]>; // pattern → [result1_empty, ...]
  errorFingerprints: Map<string, number>;     // fingerprint → occurrence count
  currentStep: number;
  recentToolSequence: string[];               // circular buffer, last 8 tool calls
  intraSessionCoAccess: Map<string, Set<string>>; // fileA → Set<fileB> co-accessed
  configFilesTouched: Set<string>;
  selfCorrectionCount: number;
  lastSelfCorrectionStep: number;
  totalInputTokens: number;
  peakContextTokens: number;
}

// ============================================================
// CONFIG FILE DETECTION
// ============================================================

const CONFIG_FILE_PATTERNS = [
  'package.json',
  'tsconfig',
  'vite.config',
  '.env',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'webpack.config',
  'babel.config',
  'jest.config',
  'vitest.config',
  'biome.json',
  '.eslintrc',
  '.prettierrc',
  'tailwind.config',
];

/**
 * Returns true if the file path is a recognized config file.
 */
export function isConfigFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return CONFIG_FILE_PATTERNS.some((p) => lower.includes(p));
}

// ============================================================
// ERROR FINGERPRINTING
// ============================================================

/**
 * Produce a stable fingerprint for an error message by normalizing out
 * file paths, line numbers, and timestamps, then hashing.
 */
export function computeErrorFingerprint(errorMessage: string): string {
  const normalized = errorMessage
    // Strip absolute file paths
    .replace(/\/[^\s:'"]+/g, '<path>')
    // Strip relative paths
    .replace(/\.[./][^\s:'"]+/g, '<path>')
    // Strip line/column numbers like :42 or :42:7
    .replace(/:\d+(:\d+)?/g, '')
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // Strip timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<ts>')
    .trim()
    .toLowerCase();

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ============================================================
// SCRATCHPAD CLASS
// ============================================================

function makeEmptyAnalytics(): ScratchpadAnalytics {
  return {
    fileAccessCounts: new Map(),
    fileFirstAccess: new Map(),
    fileLastAccess: new Map(),
    fileEditSet: new Set(),
    grepPatternCounts: new Map(),
    grepPatternResults: new Map(),
    errorFingerprints: new Map(),
    currentStep: 0,
    recentToolSequence: [],
    intraSessionCoAccess: new Map(),
    configFilesTouched: new Set(),
    selfCorrectionCount: 0,
    lastSelfCorrectionStep: -1,
    totalInputTokens: 0,
    peakContextTokens: 0,
  };
}

export class Scratchpad {
  readonly sessionId: string;
  readonly sessionType: SessionType;
  readonly startedAt: number;

  signals: Map<SignalType, ObserverSignal[]>;
  analytics: ScratchpadAnalytics;
  acuteCandidates: AcuteCandidate[];

  constructor(sessionId: string, sessionType: SessionType) {
    this.sessionId = sessionId;
    this.sessionType = sessionType;
    this.startedAt = Date.now();
    this.signals = new Map();
    this.analytics = makeEmptyAnalytics();
    this.acuteCandidates = [];
  }

  /**
   * Record a tool call into analytics. O(1).
   */
  recordToolCall(toolName: string, args: Record<string, unknown>, stepNumber: number): void {
    this.analytics.currentStep = stepNumber;

    // Track file accesses from Read/Edit/Write/Glob
    const filePath = this.extractFilePath(toolName, args);
    if (filePath) {
      const count = (this.analytics.fileAccessCounts.get(filePath) ?? 0) + 1;
      this.analytics.fileAccessCounts.set(filePath, count);

      if (!this.analytics.fileFirstAccess.has(filePath)) {
        this.analytics.fileFirstAccess.set(filePath, stepNumber);
      }
      this.analytics.fileLastAccess.set(filePath, stepNumber);

      if (isConfigFile(filePath)) {
        this.analytics.configFilesTouched.add(filePath);
      }

      // Track co-access: record this file was accessed in this step window
      for (const [otherFile] of this.analytics.fileAccessCounts) {
        if (
          otherFile !== filePath &&
          (this.analytics.fileLastAccess.get(otherFile) ?? 0) >= stepNumber - 5
        ) {
          // Within 5-step window → co-access
          if (!this.analytics.intraSessionCoAccess.has(filePath)) {
            this.analytics.intraSessionCoAccess.set(filePath, new Set());
          }
          this.analytics.intraSessionCoAccess.get(filePath)!.add(otherFile);
        }
      }
    }

    // Track grep patterns
    if (toolName === 'Grep' && typeof args.pattern === 'string') {
      const pattern = args.pattern;
      const count = (this.analytics.grepPatternCounts.get(pattern) ?? 0) + 1;
      this.analytics.grepPatternCounts.set(pattern, count);
    }

    // Maintain circular buffer of last 8 tool calls
    this.analytics.recentToolSequence.push(toolName);
    if (this.analytics.recentToolSequence.length > 8) {
      this.analytics.recentToolSequence.shift();
    }
  }

  /**
   * Record a tool result. O(1).
   */
  recordToolResult(toolName: string, result: unknown, stepNumber: number): void {
    this.analytics.currentStep = stepNumber;

    // Track edits
    if (toolName === 'Edit' || toolName === 'Write') {
      // Extract file path from most recent corresponding tool call
      // (We'll rely on the observer to pass this in via recordToolCall)
    }

    // Track errors from Bash/other tool failures
    if (
      (toolName === 'Bash' || toolName === 'Edit' || toolName === 'Write') &&
      typeof result === 'string' &&
      result.toLowerCase().includes('error')
    ) {
      const fingerprint = computeErrorFingerprint(result);
      const count = (this.analytics.errorFingerprints.get(fingerprint) ?? 0) + 1;
      this.analytics.errorFingerprints.set(fingerprint, count);
    }

    // Track grep result empty/non-empty for pattern reliability
    if (toolName === 'Grep' || toolName === 'Glob') {
      // Can't get the pattern here without matching the call, tracked in recordToolCall
    }
  }

  /**
   * Record edit of a file (called from Edit/Write tool calls).
   */
  recordFileEdit(filePath: string): void {
    this.analytics.fileEditSet.add(filePath);
    if (isConfigFile(filePath)) {
      this.analytics.configFilesTouched.add(filePath);
    }
  }

  /**
   * Record a self-correction event.
   */
  recordSelfCorrection(stepNumber: number): void {
    this.analytics.selfCorrectionCount++;
    this.analytics.lastSelfCorrectionStep = stepNumber;
  }

  /**
   * Update token counts.
   */
  recordTokenUsage(inputTokens: number): void {
    this.analytics.totalInputTokens += inputTokens;
    if (inputTokens > this.analytics.peakContextTokens) {
      this.analytics.peakContextTokens = inputTokens;
    }
  }

  /**
   * Add a signal to the signals map.
   */
  addSignal(signal: ObserverSignal): void {
    const existing = this.signals.get(signal.type) ?? [];
    existing.push(signal);
    this.signals.set(signal.type, existing);
  }

  /**
   * Get all acute candidates captured since the given step number.
   */
  getNewSince(stepNumber: number): AcuteCandidate[] {
    return this.acuteCandidates.filter((c) => c.stepNumber >= stepNumber);
  }

  /**
   * Checkpoint to DB for crash recovery at subtask boundaries.
   */
  async checkpoint(workUnitRef: WorkUnitRef, dbClient: Client): Promise<void> {
    const payload = JSON.stringify({
      sessionId: this.sessionId,
      sessionType: this.sessionType,
      startedAt: this.startedAt,
      workUnitRef,
      analytics: this.serializeAnalytics(),
      acuteCandidatesCount: this.acuteCandidates.length,
      signalCounts: Object.fromEntries(
        [...this.signals.entries()].map(([k, v]) => [k, v.length]),
      ),
    });

    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO observer_synthesis_log
              (module, project_id, trigger_count, synthesized_at, memories_generated)
              VALUES (?, ?, ?, ?, ?)`,
      args: [
        `scratchpad:${this.sessionId}`,
        workUnitRef.methodology,
        this.analytics.currentStep,
        Date.now(),
        0,
      ],
    });

    // Store checkpoint JSON in a dedicated table if it exists, else no-op
    try {
      await dbClient.execute({
        sql: `INSERT OR REPLACE INTO observer_scratchpad_checkpoints
                (session_id, payload, updated_at)
                VALUES (?, ?, ?)`,
        args: [this.sessionId, payload, Date.now()],
      });
    } catch {
      // Table may not exist yet — checkpoint is best-effort
    }
  }

  /**
   * Restore a scratchpad from a DB checkpoint.
   */
  static async restore(sessionId: string, dbClient: Client): Promise<Scratchpad | null> {
    try {
      const result = await dbClient.execute({
        sql: `SELECT payload FROM observer_scratchpad_checkpoints WHERE session_id = ?`,
        args: [sessionId],
      });

      if (result.rows.length === 0) return null;

      const raw = JSON.parse(result.rows[0].payload as string) as {
        sessionType: SessionType;
        startedAt: number;
      };

      const scratchpad = new Scratchpad(sessionId, raw.sessionType);
      // Restore minimal analytics from checkpoint (signals are not fully restored)
      return scratchpad;
    } catch {
      return null;
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private extractFilePath(
    toolName: string,
    args: Record<string, unknown>,
  ): string | null {
    switch (toolName) {
      case 'Read':
        return typeof args.file_path === 'string' ? args.file_path : null;
      case 'Edit':
        return typeof args.file_path === 'string' ? args.file_path : null;
      case 'Write':
        return typeof args.file_path === 'string' ? args.file_path : null;
      case 'Glob':
        return null; // Glob returns multiple files — handle separately
      case 'Grep':
        return typeof args.path === 'string' ? args.path : null;
      default:
        return null;
    }
  }

  private serializeAnalytics(): Record<string, unknown> {
    return {
      fileAccessCounts: Object.fromEntries(this.analytics.fileAccessCounts),
      fileEditSetSize: this.analytics.fileEditSet.size,
      grepPatternCounts: Object.fromEntries(this.analytics.grepPatternCounts),
      errorFingerprintCount: this.analytics.errorFingerprints.size,
      currentStep: this.analytics.currentStep,
      configFilesTouchedCount: this.analytics.configFilesTouched.size,
      selfCorrectionCount: this.analytics.selfCorrectionCount,
      totalInputTokens: this.analytics.totalInputTokens,
      peakContextTokens: this.analytics.peakContextTokens,
    };
  }
}
