/**
 * Memory Observer — Barrel Export
 */

export { MemoryObserver } from './memory-observer';
export { Scratchpad, isConfigFile, computeErrorFingerprint } from './scratchpad';
export type { ScratchpadAnalytics } from './scratchpad';
export { detectDeadEnd, DEAD_END_LANGUAGE_PATTERNS } from './dead-end-detector';
export type { DeadEndDetectionResult } from './dead-end-detector';
export { applyTrustGate } from './trust-gate';
export { PromotionPipeline, SESSION_TYPE_PROMOTION_LIMITS, EARLY_TRIGGERS } from './promotion';
export type { EarlyTrigger } from './promotion';
export { ParallelScratchpadMerger } from './scratchpad-merger';
export type { MergedScratchpad, MergedScratchpadEntry } from './scratchpad-merger';
export { SIGNAL_VALUES, SELF_CORRECTION_PATTERNS } from './signals';
export type {
  ObserverSignal,
  SignalValueEntry,
  BaseSignal,
  FileAccessSignal,
  CoAccessSignal,
  ErrorRetrySignal,
  BacktrackSignal,
  ReadAbandonSignal,
  RepeatedGrepSignal,
  ToolSequenceSignal,
  TimeAnomalySignal,
  SelfCorrectionSignal,
  ExternalReferenceSignal,
  GlobIgnoreSignal,
  ImportChaseSignal,
  TestOrderSignal,
  ConfigTouchSignal,
  StepOverrunSignal,
  ParallelConflictSignal,
  ContextTokenSpikeSignal,
} from './signals';
