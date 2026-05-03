/**
 * Phase Configuration Module
 *
 * See apps/desktop/src/main/ai/config/phase-config.ts for the full TypeScript implementation.
 * Handles model and thinking level configuration for different execution phases.
 * Reads configuration from task_metadata.json and provides resolved model IDs.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type Phase,
  type ThinkingLevel,
  type ModelShorthand,
  MODEL_ID_MAP,
  MODEL_BETAS_MAP,
  THINKING_BUDGET_MAP,
  EFFORT_LEVEL_MAP,
  ADAPTIVE_THINKING_MODELS,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
} from './types';

// ============================================
// Spec Phase Thinking Levels
// ============================================

/**
 * Spec runner phase-specific thinking levels.
 * Heavy phases use high for deep analysis.
 * Light phases use medium after compaction.
 */
export const SPEC_PHASE_THINKING_LEVELS: Record<string, ThinkingLevel> = {
  // Heavy phases
  discovery: 'high',
  spec_writing: 'high',
  self_critique: 'high',
  // Light phases
  requirements: 'medium',
  research: 'medium',
  context: 'medium',
  planning: 'medium',
  validation: 'medium',
  quick_spec: 'medium',
  historical_context: 'medium',
  complexity_assessment: 'medium',
};

// ============================================
// Thinking Level Validation
// ============================================

const VALID_THINKING_LEVELS = new Set<string>(['low', 'medium', 'high', 'xhigh']);

const LEGACY_THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  ultrathink: 'high',
  none: 'low',
};

/**
 * Validate and sanitize a thinking level string.
 * Maps legacy values (e.g., 'ultrathink') to valid equivalents and falls
 * back to 'medium' for completely unknown values.
 */
export function sanitizeThinkingLevel(thinkingLevel: string): ThinkingLevel {
  if (VALID_THINKING_LEVELS.has(thinkingLevel)) {
    return thinkingLevel as ThinkingLevel;
  }
  return LEGACY_THINKING_LEVEL_MAP[thinkingLevel] ?? 'medium';
}

// ============================================
// Model Resolution
// ============================================

/** Environment variable names for model overrides (from API Profile) */
const ENV_VAR_MAP: Partial<Record<ModelShorthand, string>> = {
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'opus-1m': 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  // opus-4.5 intentionally omitted — always resolves to its hardcoded model ID
};

/**
 * Resolve a model shorthand (haiku, sonnet, opus) to a full model ID.
 * If the model is already a full ID, return it unchanged.
 *
 * Priority:
 * 1. Environment variable override (from API Profile)
 * 2. Hardcoded MODEL_ID_MAP
 * 3. Pass through unchanged (assume full model ID)
 */
export function resolveModelId(model: string): string {
  if (model in MODEL_ID_MAP) {
    const shorthand = model as ModelShorthand;
    const envVar = ENV_VAR_MAP[shorthand];
    if (envVar) {
      const envValue = process.env[envVar];
      if (envValue) {
        return envValue;
      }
    }
    return MODEL_ID_MAP[shorthand];
  }
  return model;
}

/**
 * Get required SDK beta headers for a model shorthand.
 */
export function getModelBetas(modelShort: string): string[] {
  return MODEL_BETAS_MAP[modelShort as ModelShorthand] ?? [];
}

// ============================================
// Thinking Budget
// ============================================

/**
 * Get the thinking budget (token count) for a thinking level.
 */
export function getThinkingBudget(thinkingLevel: string): number {
  const level = thinkingLevel as ThinkingLevel;
  if (level in THINKING_BUDGET_MAP) {
    return THINKING_BUDGET_MAP[level];
  }
  return THINKING_BUDGET_MAP.medium;
}

// ============================================
// Task Metadata
// ============================================

/** Structure of model-related fields in task_metadata.json */
export interface TaskMetadataConfig {
  isAutoProfile?: boolean;
  phaseModels?: Partial<Record<Phase, string>>;
  phaseThinking?: Partial<Record<Phase, string>>;
  model?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  /** Per-phase provider override for cross-provider (Custom) profile */
  phaseProviders?: Partial<Record<Phase, string>>;
}

/**
 * Load task_metadata.json from the spec directory.
 * Returns null if not found or invalid.
 */
export async function loadTaskMetadata(
  specDir: string,
): Promise<TaskMetadataConfig | null> {
  const metadataPath = join(specDir, 'task_metadata.json');
  try {
    const raw = await readFile(metadataPath, 'utf-8');
    return JSON.parse(raw) as TaskMetadataConfig;
  } catch {
    return null;
  }
}

// ============================================
// Phase Configuration Functions
// ============================================

/**
 * Get the resolved model ID for a specific execution phase.
 *
 * Priority:
 * 1. CLI argument (if provided)
 * 2. Phase-specific config from task_metadata.json (if auto profile)
 * 3. Single model from task_metadata.json (if not auto profile)
 * 4. Default phase configuration
 */
export async function getPhaseModel(
  specDir: string,
  phase: Phase,
  cliModel?: string | null,
): Promise<string> {
  if (cliModel) {
    return resolveModelId(cliModel);
  }

  const metadata = await loadTaskMetadata(specDir);

  if (metadata) {
    if (metadata.isAutoProfile && metadata.phaseModels) {
      const model = metadata.phaseModels[phase] ?? DEFAULT_PHASE_MODELS[phase];
      return resolveModelId(model);
    }
    if (metadata.model) {
      return resolveModelId(metadata.model);
    }
  }

  return resolveModelId(DEFAULT_PHASE_MODELS[phase]);
}

/**
 * Get the thinking level for a specific execution phase.
 *
 * Priority:
 * 1. CLI argument (if provided)
 * 2. Phase-specific config from task_metadata.json (if auto profile)
 * 3. Single thinking level from task_metadata.json (if not auto profile)
 * 4. Default phase configuration
 */
export async function getPhaseThinking(
  specDir: string,
  phase: Phase,
  cliThinking?: string | null,
): Promise<string> {
  if (cliThinking) {
    return cliThinking;
  }

  const metadata = await loadTaskMetadata(specDir);

  if (metadata) {
    if (metadata.isAutoProfile && metadata.phaseThinking) {
      return metadata.phaseThinking[phase] ?? DEFAULT_PHASE_THINKING[phase];
    }
    if (metadata.thinkingLevel) {
      return metadata.thinkingLevel;
    }
  }

  return DEFAULT_PHASE_THINKING[phase];
}

/**
 * Check if a model supports adaptive thinking via effort level.
 */
export function isAdaptiveModel(modelId: string): boolean {
  return ADAPTIVE_THINKING_MODELS.has(modelId);
}

/** Thinking kwargs returned for model configuration */
export interface ThinkingKwargs {
  maxThinkingTokens: number;
  effortLevel?: string;
}

/**
 * Get thinking-related kwargs based on model type.
 *
 * For adaptive models (Opus 4.6): returns both maxThinkingTokens and effortLevel.
 * For other models: returns only maxThinkingTokens.
 */
export function getThinkingKwargsForModel(
  modelId: string,
  thinkingLevel: string,
): ThinkingKwargs {
  const kwargs: ThinkingKwargs = {
    maxThinkingTokens: getThinkingBudget(thinkingLevel),
  };
  if (isAdaptiveModel(modelId)) {
    kwargs.effortLevel =
      EFFORT_LEVEL_MAP[thinkingLevel as ThinkingLevel] ?? 'medium';
  }
  return kwargs;
}

/**
 * Get the full configuration for a specific execution phase.
 *
 * Returns a tuple of [modelId, thinkingLevel, thinkingBudget].
 */
export async function getPhaseConfig(
  specDir: string,
  phase: Phase,
  cliModel?: string | null,
  cliThinking?: string | null,
): Promise<[string, string, number]> {
  const modelId = await getPhaseModel(specDir, phase, cliModel);
  const thinkingLevel = await getPhaseThinking(specDir, phase, cliThinking);
  const thinkingBudget = getThinkingBudget(thinkingLevel);
  return [modelId, thinkingLevel, thinkingBudget];
}

/**
 * Get thinking kwargs for a specific execution phase.
 */
export async function getPhaseClientThinkingKwargs(
  specDir: string,
  phase: Phase,
  phaseModel: string,
  cliThinking?: string | null,
): Promise<ThinkingKwargs> {
  const thinkingLevel = await getPhaseThinking(specDir, phase, cliThinking);
  return getThinkingKwargsForModel(phaseModel, thinkingLevel);
}

/**
 * Get the thinking budget for a specific spec runner phase.
 */
export function getSpecPhaseThinkingBudget(phaseName: string): number {
  const thinkingLevel = SPEC_PHASE_THINKING_LEVELS[phaseName] ?? 'medium';
  return getThinkingBudget(thinkingLevel);
}

/**
 * Check if Fast Mode is enabled for this task.
 */
export async function getFastMode(specDir: string): Promise<boolean> {
  const metadata = await loadTaskMetadata(specDir);
  return metadata?.fastMode === true;
}

/**
 * Get required SDK beta headers for the model selected for a specific phase.
 */
export async function getPhaseModelBetas(
  specDir: string,
  phase: Phase,
  cliModel?: string | null,
): Promise<string[]> {
  if (cliModel) {
    return getModelBetas(cliModel);
  }

  const metadata = await loadTaskMetadata(specDir);

  if (metadata) {
    if (metadata.isAutoProfile && metadata.phaseModels) {
      const modelShort = metadata.phaseModels[phase] ?? DEFAULT_PHASE_MODELS[phase];
      return getModelBetas(modelShort);
    }
    if (metadata.model) {
      return getModelBetas(metadata.model);
    }
  }

  return getModelBetas(DEFAULT_PHASE_MODELS[phase]);
}
