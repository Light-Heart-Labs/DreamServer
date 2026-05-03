/**
 * Insight Extractor Schema
 * ========================
 *
 * Zod schemas for validating LLM-generated insight extraction output
 * and task suggestions from the insights chat runner.
 *
 * Handles LLM variations like:
 * - snake_case vs camelCase field names (file_insights vs fileInsights, etc.)
 * - Missing optional fields filled with safe defaults
 */

import { z } from 'zod';

// =============================================================================
// FileInsight Schema
// =============================================================================

function coerceFileInsight(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    file: raw.file ?? '',
    insight: raw.insight ?? '',
  };
}

const FileInsightSchema = z.preprocess(coerceFileInsight, z.object({
  file: z.string().default(''),
  insight: z.string().default(''),
  category: z.string().optional(),
}).passthrough());

// =============================================================================
// ApproachOutcome Schema
// =============================================================================

function coerceApproachOutcome(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    success: raw.success ?? false,
    approach_used: raw.approach_used ?? '',
    why_it_worked: raw.why_it_worked ?? null,
    why_it_failed: raw.why_it_failed ?? null,
    alternatives_tried: raw.alternatives_tried ?? [],
  };
}

const ApproachOutcomeSchema = z.preprocess(coerceApproachOutcome, z.object({
  success: z.boolean().default(false),
  approach_used: z.string().default(''),
  why_it_worked: z.string().nullable().default(null),
  why_it_failed: z.string().nullable().default(null),
  alternatives_tried: z.array(z.string()).default([]),
}).passthrough());

// =============================================================================
// ExtractedInsights Schema
// =============================================================================

function coerceInsights(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    file_insights: raw.file_insights ?? raw.fileInsights ?? [],
    patterns_discovered: raw.patterns_discovered ?? raw.patternsDiscovered ?? [],
    gotchas_discovered: raw.gotchas_discovered ?? raw.gotchasDiscovered ?? [],
    approach_outcome: raw.approach_outcome ?? raw.approachOutcome ?? {},
    recommendations: raw.recommendations ?? [],
  };
}

export const ExtractedInsightsSchema = z.preprocess(coerceInsights, z.object({
  file_insights: z.array(FileInsightSchema).default([]),
  patterns_discovered: z.array(z.string()).default([]),
  gotchas_discovered: z.array(z.string()).default([]),
  approach_outcome: ApproachOutcomeSchema.default({
    success: false,
    approach_used: '',
    why_it_worked: null,
    why_it_failed: null,
    alternatives_tried: [],
  }),
  recommendations: z.array(z.string()).default([]),
}).passthrough());

export type ValidatedExtractedInsights = z.infer<typeof ExtractedInsightsSchema>;

// =============================================================================
// TaskSuggestion Schema
// =============================================================================

const TaskMetadataSchema = z.object({
  category: z.string().default('feature'),
  complexity: z.string().default('medium'),
  impact: z.string().default('medium'),
}).passthrough();

export const TaskSuggestionSchema = z.object({
  title: z.string(),
  description: z.string(),
  metadata: TaskMetadataSchema.default({ category: 'feature', complexity: 'medium', impact: 'medium' }),
}).passthrough();

export type ValidatedTaskSuggestion = z.infer<typeof TaskSuggestionSchema>;
