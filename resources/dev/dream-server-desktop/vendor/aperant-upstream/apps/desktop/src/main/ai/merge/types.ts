/**
 * Merge System Types
 * ==================
 *
 * Core data structures for the intent-aware merge system.
 * See apps/desktop/src/main/ai/merge/types.ts for the TypeScript implementation.
 */

import { createHash } from 'crypto';

// =============================================================================
// Enums
// =============================================================================

/** Semantic classification of code changes. */
export enum ChangeType {
  // Import changes
  ADD_IMPORT = 'add_import',
  REMOVE_IMPORT = 'remove_import',
  MODIFY_IMPORT = 'modify_import',

  // Function/method changes
  ADD_FUNCTION = 'add_function',
  REMOVE_FUNCTION = 'remove_function',
  MODIFY_FUNCTION = 'modify_function',
  RENAME_FUNCTION = 'rename_function',

  // React/JSX specific
  ADD_HOOK_CALL = 'add_hook_call',
  REMOVE_HOOK_CALL = 'remove_hook_call',
  WRAP_JSX = 'wrap_jsx',
  UNWRAP_JSX = 'unwrap_jsx',
  ADD_JSX_ELEMENT = 'add_jsx_element',
  MODIFY_JSX_PROPS = 'modify_jsx_props',

  // Variable/constant changes
  ADD_VARIABLE = 'add_variable',
  REMOVE_VARIABLE = 'remove_variable',
  MODIFY_VARIABLE = 'modify_variable',
  ADD_CONSTANT = 'add_constant',

  // Class changes
  ADD_CLASS = 'add_class',
  REMOVE_CLASS = 'remove_class',
  MODIFY_CLASS = 'modify_class',
  ADD_METHOD = 'add_method',
  REMOVE_METHOD = 'remove_method',
  MODIFY_METHOD = 'modify_method',
  ADD_PROPERTY = 'add_property',

  // Type changes (TypeScript)
  ADD_TYPE = 'add_type',
  MODIFY_TYPE = 'modify_type',
  ADD_INTERFACE = 'add_interface',
  MODIFY_INTERFACE = 'modify_interface',

  // Python specific
  ADD_DECORATOR = 'add_decorator',
  REMOVE_DECORATOR = 'remove_decorator',

  // Generic
  ADD_COMMENT = 'add_comment',
  MODIFY_COMMENT = 'modify_comment',
  FORMATTING_ONLY = 'formatting_only',
  UNKNOWN = 'unknown',
}

/** Severity levels for detected conflicts. */
export enum ConflictSeverity {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** Strategies for merging compatible changes. */
export enum MergeStrategy {
  // Import strategies
  COMBINE_IMPORTS = 'combine_imports',

  // Function body strategies
  HOOKS_FIRST = 'hooks_first',
  HOOKS_THEN_WRAP = 'hooks_then_wrap',
  APPEND_STATEMENTS = 'append_statements',

  // Structural strategies
  APPEND_FUNCTIONS = 'append_functions',
  APPEND_METHODS = 'append_methods',
  COMBINE_PROPS = 'combine_props',

  // Ordering strategies
  ORDER_BY_DEPENDENCY = 'order_by_dependency',
  ORDER_BY_TIME = 'order_by_time',

  // Fallback
  AI_REQUIRED = 'ai_required',
  HUMAN_REQUIRED = 'human_required',
}

/** Decision outcomes from the merge system. */
export enum MergeDecision {
  AUTO_MERGED = 'auto_merged',
  AI_MERGED = 'ai_merged',
  NEEDS_HUMAN_REVIEW = 'needs_human_review',
  FAILED = 'failed',
  DIRECT_COPY = 'direct_copy',
}

// =============================================================================
// Core Interfaces
// =============================================================================

/** A single semantic change within a file. */
export interface SemanticChange {
  changeType: ChangeType;
  target: string;
  location: string;
  lineStart: number;
  lineEnd: number;
  contentBefore?: string;
  contentAfter?: string;
  metadata: Record<string, unknown>;
}

export function isAdditiveChange(change: SemanticChange): boolean {
  const additiveTypes = new Set([
    ChangeType.ADD_IMPORT,
    ChangeType.ADD_FUNCTION,
    ChangeType.ADD_HOOK_CALL,
    ChangeType.ADD_VARIABLE,
    ChangeType.ADD_CONSTANT,
    ChangeType.ADD_CLASS,
    ChangeType.ADD_METHOD,
    ChangeType.ADD_PROPERTY,
    ChangeType.ADD_TYPE,
    ChangeType.ADD_INTERFACE,
    ChangeType.ADD_DECORATOR,
    ChangeType.ADD_JSX_ELEMENT,
    ChangeType.ADD_COMMENT,
  ]);
  return additiveTypes.has(change.changeType);
}

export function overlapsWithChange(a: SemanticChange, b: SemanticChange): boolean {
  if (a.location === b.location) return true;
  if (a.lineEnd >= b.lineStart && b.lineEnd >= a.lineStart) return true;
  return false;
}

export function semanticChangeToDict(change: SemanticChange): Record<string, unknown> {
  return {
    change_type: change.changeType,
    target: change.target,
    location: change.location,
    line_start: change.lineStart,
    line_end: change.lineEnd,
    content_before: change.contentBefore ?? null,
    content_after: change.contentAfter ?? null,
    metadata: change.metadata,
  };
}

export function semanticChangeFromDict(data: Record<string, unknown>): SemanticChange {
  return {
    changeType: data['change_type'] as ChangeType,
    target: data['target'] as string,
    location: data['location'] as string,
    lineStart: data['line_start'] as number,
    lineEnd: data['line_end'] as number,
    contentBefore: (data['content_before'] as string | null | undefined) ?? undefined,
    contentAfter: (data['content_after'] as string | null | undefined) ?? undefined,
    metadata: (data['metadata'] as Record<string, unknown>) ?? {},
  };
}

/** Complete semantic analysis of changes to a single file. */
export interface FileAnalysis {
  filePath: string;
  changes: SemanticChange[];
  functionsModified: Set<string>;
  functionsAdded: Set<string>;
  importsAdded: Set<string>;
  importsRemoved: Set<string>;
  classesModified: Set<string>;
  totalLinesChanged: number;
}

export function createFileAnalysis(filePath: string): FileAnalysis {
  return {
    filePath,
    changes: [],
    functionsModified: new Set(),
    functionsAdded: new Set(),
    importsAdded: new Set(),
    importsRemoved: new Set(),
    classesModified: new Set(),
    totalLinesChanged: 0,
  };
}

export function isAdditiveOnly(analysis: FileAnalysis): boolean {
  return analysis.changes.every(isAdditiveChange);
}

export function locationsChanged(analysis: FileAnalysis): Set<string> {
  return new Set(analysis.changes.map((c) => c.location));
}

export function getChangesAtLocation(analysis: FileAnalysis, location: string): SemanticChange[] {
  return analysis.changes.filter((c) => c.location === location);
}

/** A detected conflict between multiple task changes. */
export interface ConflictRegion {
  filePath: string;
  location: string;
  tasksInvolved: string[];
  changeTypes: ChangeType[];
  severity: ConflictSeverity;
  canAutoMerge: boolean;
  mergeStrategy?: MergeStrategy;
  reason: string;
}

export function conflictRegionToDict(conflict: ConflictRegion): Record<string, unknown> {
  return {
    file_path: conflict.filePath,
    location: conflict.location,
    tasks_involved: conflict.tasksInvolved,
    change_types: conflict.changeTypes,
    severity: conflict.severity,
    can_auto_merge: conflict.canAutoMerge,
    merge_strategy: conflict.mergeStrategy ?? null,
    reason: conflict.reason,
  };
}

/** A snapshot of a task's changes to a file. */
export interface TaskSnapshot {
  taskId: string;
  taskIntent: string;
  startedAt: Date;
  completedAt?: Date;
  contentHashBefore: string;
  contentHashAfter: string;
  semanticChanges: SemanticChange[];
  rawDiff?: string;
}

export function taskSnapshotHasModifications(snapshot: TaskSnapshot): boolean {
  if (snapshot.semanticChanges.length > 0) return true;
  if (!snapshot.contentHashBefore && snapshot.contentHashAfter) return true;
  if (snapshot.contentHashBefore && snapshot.contentHashAfter) {
    return snapshot.contentHashBefore !== snapshot.contentHashAfter;
  }
  return false;
}

export function taskSnapshotToDict(snapshot: TaskSnapshot): Record<string, unknown> {
  return {
    task_id: snapshot.taskId,
    task_intent: snapshot.taskIntent,
    started_at: snapshot.startedAt.toISOString(),
    completed_at: snapshot.completedAt?.toISOString() ?? null,
    content_hash_before: snapshot.contentHashBefore,
    content_hash_after: snapshot.contentHashAfter,
    semantic_changes: snapshot.semanticChanges.map(semanticChangeToDict),
    raw_diff: snapshot.rawDiff ?? null,
  };
}

export function taskSnapshotFromDict(data: Record<string, unknown>): TaskSnapshot {
  return {
    taskId: data['task_id'] as string,
    taskIntent: data['task_intent'] as string,
    startedAt: new Date(data['started_at'] as string),
    completedAt: data['completed_at'] ? new Date(data['completed_at'] as string) : undefined,
    contentHashBefore: (data['content_hash_before'] as string) ?? '',
    contentHashAfter: (data['content_hash_after'] as string) ?? '',
    semanticChanges: ((data['semantic_changes'] as Record<string, unknown>[]) ?? []).map(
      semanticChangeFromDict,
    ),
    rawDiff: (data['raw_diff'] as string | null | undefined) ?? undefined,
  };
}

/** Complete evolution history of a single file. */
export interface FileEvolution {
  filePath: string;
  baselineCommit: string;
  baselineCapturedAt: Date;
  baselineContentHash: string;
  baselineSnapshotPath: string;
  taskSnapshots: TaskSnapshot[];
}

export function fileEvolutionToDict(evolution: FileEvolution): Record<string, unknown> {
  return {
    file_path: evolution.filePath,
    baseline_commit: evolution.baselineCommit,
    baseline_captured_at: evolution.baselineCapturedAt.toISOString(),
    baseline_content_hash: evolution.baselineContentHash,
    baseline_snapshot_path: evolution.baselineSnapshotPath,
    task_snapshots: evolution.taskSnapshots.map(taskSnapshotToDict),
  };
}

export function fileEvolutionFromDict(data: Record<string, unknown>): FileEvolution {
  return {
    filePath: data['file_path'] as string,
    baselineCommit: data['baseline_commit'] as string,
    baselineCapturedAt: new Date(data['baseline_captured_at'] as string),
    baselineContentHash: data['baseline_content_hash'] as string,
    baselineSnapshotPath: data['baseline_snapshot_path'] as string,
    taskSnapshots: ((data['task_snapshots'] as Record<string, unknown>[]) ?? []).map(
      taskSnapshotFromDict,
    ),
  };
}

export function getTaskSnapshot(evolution: FileEvolution, taskId: string): TaskSnapshot | undefined {
  return evolution.taskSnapshots.find((ts) => ts.taskId === taskId);
}

export function addTaskSnapshot(evolution: FileEvolution, snapshot: TaskSnapshot): void {
  evolution.taskSnapshots = evolution.taskSnapshots.filter((ts) => ts.taskId !== snapshot.taskId);
  evolution.taskSnapshots.push(snapshot);
  evolution.taskSnapshots.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

export function getTasksInvolved(evolution: FileEvolution): string[] {
  return evolution.taskSnapshots.map((ts) => ts.taskId);
}

/** Result of a merge operation. */
export interface MergeResult {
  decision: MergeDecision;
  filePath: string;
  mergedContent?: string;
  conflictsResolved: ConflictRegion[];
  conflictsRemaining: ConflictRegion[];
  aiCallsMade: number;
  tokensUsed: number;
  explanation: string;
  error?: string;
}

export function mergeResultSuccess(result: MergeResult): boolean {
  return [MergeDecision.AUTO_MERGED, MergeDecision.AI_MERGED, MergeDecision.DIRECT_COPY].includes(
    result.decision,
  );
}

export function mergeResultNeedsHumanReview(result: MergeResult): boolean {
  return result.conflictsRemaining.length > 0 || result.decision === MergeDecision.NEEDS_HUMAN_REVIEW;
}

// =============================================================================
// Utility functions
// =============================================================================

/** Compute a short content hash for comparison. */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/** Convert a file path to a safe storage name. */
export function sanitizePathForStorage(filePath: string): string {
  return filePath.replace(/[/\\]/g, '_').replace(/\./g, '_');
}
