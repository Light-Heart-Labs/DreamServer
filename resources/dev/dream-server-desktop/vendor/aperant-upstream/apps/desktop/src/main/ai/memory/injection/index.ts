/**
 * Memory Injection Module — Barrel Export
 *
 * Active injection layer for the agent loop. Provides:
 * - StepInjectionDecider: decides whether to inject memory between steps
 * - StepMemoryState: per-session state tracker for injection decisions
 * - buildPlannerMemoryContext: pre-session context for planner agents
 * - buildQaSessionContext: pre-session context for QA agents
 * - buildPrefetchPlan: file prefetch plan from historical access patterns
 * - buildMemoryAwareStopCondition / getCalibrationFactor: calibrated step limits
 */

export { StepInjectionDecider } from './step-injection-decider';
export type { RecentToolCallContext, StepInjection } from './step-injection-decider';

export { StepMemoryState } from './step-memory-state';

export { buildPlannerMemoryContext } from './planner-memory-context';

export { buildPrefetchPlan } from './prefetch-builder';
export type { PrefetchPlan } from './prefetch-builder';

export { buildMemoryAwareStopCondition, getCalibrationFactor } from './memory-stop-condition';

export { buildQaSessionContext } from './qa-context';
