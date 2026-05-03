/**
 * Triage Result Schema
 * ====================
 *
 * Zod schema for validating triage result JSON from the LLM in triage-engine.ts.
 *
 * Handles LLM variations like:
 * - snake_case field names (labels_to_add, is_duplicate, etc.) vs camelCase
 * - confidence as percentage (85) instead of fraction (0.85)
 */

import { z } from 'zod';

// =============================================================================
// Field Name Coercion
// =============================================================================

/**
 * Coerce snake_case LLM output to camelCase and fill missing fields with defaults.
 */
function coerceTriageResult(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  // Normalize confidence: convert percentage (85) to fraction (0.85)
  let confidence = raw.confidence;
  if (typeof confidence === 'number' && confidence > 1) {
    confidence = confidence / 100;
  }

  return {
    ...raw,
    category: raw.category ?? 'feature',
    confidence: confidence ?? 0.5,
    labelsToAdd: raw.labelsToAdd ?? raw.labels_to_add ?? [],
    labelsToRemove: raw.labelsToRemove ?? raw.labels_to_remove ?? [],
    isDuplicate: raw.isDuplicate ?? raw.is_duplicate ?? false,
    duplicateOf: raw.duplicateOf ?? raw.duplicate_of ?? null,
    isSpam: raw.isSpam ?? raw.is_spam ?? false,
    isFeatureCreep: raw.isFeatureCreep ?? raw.is_feature_creep ?? false,
    suggestedBreakdown: raw.suggestedBreakdown ?? raw.suggested_breakdown ?? [],
    priority: raw.priority ?? 'medium',
    comment: raw.comment ?? null,
  };
}

// =============================================================================
// Schema
// =============================================================================

export const TriageResultSchema = z.preprocess(coerceTriageResult, z.object({
  category: z.string().default('feature'),
  confidence: z.number().min(0).max(1).default(0.5),
  labelsToAdd: z.array(z.string()).default([]),
  labelsToRemove: z.array(z.string()).default([]),
  isDuplicate: z.boolean().default(false),
  duplicateOf: z.number().nullable().default(null),
  isSpam: z.boolean().default(false),
  isFeatureCreep: z.boolean().default(false),
  suggestedBreakdown: z.array(z.string()).default([]),
  priority: z.string().default('medium'),
  comment: z.string().nullable().default(null),
}).passthrough());

export type ValidatedTriageResult = z.infer<typeof TriageResultSchema>;
