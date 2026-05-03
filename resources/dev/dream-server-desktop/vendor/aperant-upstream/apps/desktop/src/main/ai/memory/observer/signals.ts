/**
 * Memory Observer — Signal Type Definitions
 *
 * All 17 behavioral signal interfaces and the signal value table.
 * Signals are detected from agent tool calls, reasoning, and step events.
 */

import type { SignalType, MemoryType } from '../types';

// ============================================================
// BASE SIGNAL INTERFACE
// ============================================================

export interface BaseSignal {
  type: SignalType;
  stepNumber: number;
  capturedAt: number; // process.hrtime.bigint() epoch ms
}

// ============================================================
// ALL 17 SIGNAL INTERFACES
// ============================================================

export interface FileAccessSignal extends BaseSignal {
  type: 'file_access';
  filePath: string;
  toolName: 'Read' | 'Glob' | 'Edit' | 'Write';
  accessType: 'read' | 'write' | 'glob';
}

export interface CoAccessSignal extends BaseSignal {
  type: 'co_access';
  fileA: string;
  fileB: string;
  timeDeltaMs: number;
  stepDelta: number;
  sessionId: string;
  directional: boolean;
  taskTypes: string[];
}

export interface ErrorRetrySignal extends BaseSignal {
  type: 'error_retry';
  toolName: string;
  errorMessage: string;
  errorFingerprint: string; // hash(errorType + normalizedContext)
  retryCount: number;
  resolvedHow?: string;
  stepsToResolve: number;
}

export interface BacktrackSignal extends BaseSignal {
  type: 'backtrack';
  filePath: string;
  originalContent: string;
  revertedAfterSteps: number;
  likelyReason?: string;
}

export interface ReadAbandonSignal extends BaseSignal {
  type: 'read_abandon';
  filePath: string;
  readAtStep: number;
  neverReferencedAfter: boolean;
  suspectedReason: 'wrong_file' | 'no_match' | 'already_known';
}

export interface RepeatedGrepSignal extends BaseSignal {
  type: 'repeated_grep';
  pattern: string;
  occurrenceCount: number;
  stepNumbers: number[];
  resultsConsistent: boolean;
}

export interface ToolSequenceSignal extends BaseSignal {
  type: 'tool_sequence';
  sequence: string[]; // e.g. ['Read', 'Edit', 'Bash']
  windowSize: number;
  occurrenceCount: number;
}

export interface TimeAnomalySignal extends BaseSignal {
  type: 'time_anomaly';
  toolName: string;
  durationMs: number;
  expectedMs: number;
  anomalyFactor: number; // durationMs / expectedMs
}

export interface SelfCorrectionSignal extends BaseSignal {
  type: 'self_correction';
  triggeringText: string;
  correctionType: 'factual' | 'approach' | 'api' | 'config' | 'path';
  confidence: number;
  correctedAssumption: string;
  actualFact: string;
  relatedFile?: string;
  matchedPattern: string;
}

export interface ExternalReferenceSignal extends BaseSignal {
  type: 'external_reference';
  url: string;
  toolName: 'WebFetch' | 'WebSearch';
  queryOrPath: string;
  reason: 'docs' | 'stackoverflow' | 'github' | 'other';
}

export interface GlobIgnoreSignal extends BaseSignal {
  type: 'glob_ignore';
  globPattern: string;
  matchedFiles: string[];
  ignoredFiles: string[];
  suspectedPattern: string;
}

export interface ImportChaseSignal extends BaseSignal {
  type: 'import_chase';
  startFile: string;
  importDepth: number;
  filesTraversed: string[];
  targetSymbol?: string;
}

export interface TestOrderSignal extends BaseSignal {
  type: 'test_order';
  testFile: string;
  runAtStep: number;
  ranBeforeImplementation: boolean;
  testResult: 'pass' | 'fail' | 'error';
}

export interface ConfigTouchSignal extends BaseSignal {
  type: 'config_touch';
  configFile: string;
  changedKeys?: string[];
  associatedEditFiles: string[];
  editHappenedWithin: number; // steps
}

export interface StepOverrunSignal extends BaseSignal {
  type: 'step_overrun';
  module: string;
  plannedSteps: number;
  actualSteps: number;
  overrunRatio: number;
  taskType: string;
}

export interface ParallelConflictSignal extends BaseSignal {
  type: 'parallel_conflict';
  filePath: string;
  conflictType: 'merge_conflict' | 'concurrent_write' | 'stale_read';
  agentIds: string[];
  resolvedHow?: string;
}

export interface ContextTokenSpikeSignal extends BaseSignal {
  type: 'context_token_spike';
  module: string;
  inputTokens: number;
  expectedTokens: number;
  spikeRatio: number;
  filesAccessedCount: number;
}

// ============================================================
// UNION TYPE
// ============================================================

export type ObserverSignal =
  | FileAccessSignal
  | CoAccessSignal
  | ErrorRetrySignal
  | BacktrackSignal
  | ReadAbandonSignal
  | RepeatedGrepSignal
  | ToolSequenceSignal
  | TimeAnomalySignal
  | SelfCorrectionSignal
  | ExternalReferenceSignal
  | GlobIgnoreSignal
  | ImportChaseSignal
  | TestOrderSignal
  | ConfigTouchSignal
  | StepOverrunSignal
  | ParallelConflictSignal
  | ContextTokenSpikeSignal;

// ============================================================
// SIGNAL VALUE TABLE
// ============================================================

export interface SignalValueEntry {
  score: number;
  promotesTo: MemoryType[];
  minSessions: number;
}

/**
 * Signal value formula: (diagnostic_value × 0.5) + (cross_session_relevance × 0.3) + (1.0 - false_positive_rate) × 0.2
 * Signals below 0.4 are discarded before promotion filtering.
 */
export const SIGNAL_VALUES: Record<SignalType, SignalValueEntry> = {
  co_access: { score: 0.91, promotesTo: ['causal_dependency', 'prefetch_pattern'], minSessions: 3 },
  self_correction: { score: 0.88, promotesTo: ['gotcha', 'module_insight'], minSessions: 1 },
  error_retry: { score: 0.85, promotesTo: ['error_pattern', 'gotcha'], minSessions: 2 },
  parallel_conflict: { score: 0.82, promotesTo: ['gotcha'], minSessions: 1 },
  read_abandon: { score: 0.79, promotesTo: ['gotcha'], minSessions: 3 },
  repeated_grep: { score: 0.76, promotesTo: ['module_insight', 'gotcha'], minSessions: 2 },
  test_order: { score: 0.74, promotesTo: ['task_calibration'], minSessions: 3 },
  tool_sequence: { score: 0.73, promotesTo: ['workflow_recipe'], minSessions: 3 },
  file_access: { score: 0.72, promotesTo: ['prefetch_pattern'], minSessions: 3 },
  step_overrun: { score: 0.71, promotesTo: ['task_calibration'], minSessions: 3 },
  backtrack: { score: 0.68, promotesTo: ['gotcha'], minSessions: 2 },
  config_touch: { score: 0.66, promotesTo: ['causal_dependency'], minSessions: 2 },
  glob_ignore: { score: 0.64, promotesTo: ['gotcha'], minSessions: 2 },
  context_token_spike: { score: 0.63, promotesTo: ['context_cost'], minSessions: 3 },
  external_reference: { score: 0.61, promotesTo: ['module_insight'], minSessions: 3 },
  import_chase: { score: 0.52, promotesTo: ['causal_dependency'], minSessions: 4 },
  time_anomaly: { score: 0.48, promotesTo: [], minSessions: 3 },
};

// ============================================================
// SELF-CORRECTION DETECTION PATTERNS
// ============================================================

export const SELF_CORRECTION_PATTERNS: RegExp[] = [
  /I was wrong about (.+?)\. (.+?) is actually/i,
  /Let me reconsider[.:]? (.+)/i,
  /Actually,? (.+?) (not|instead of|rather than) (.+)/i,
  /I initially thought (.+?) but (.+)/i,
  /Correction: (.+)/i,
  /Wait[,.]? (.+)/i,
];
