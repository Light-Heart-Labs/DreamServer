/**
 * Complexity Assessment Schema
 * ============================
 *
 * Zod schema for validating complexity_assessment.json written by the
 * spec_gatherer agent during the spec creation pipeline.
 *
 * Handles LLM variations like:
 * - "level" instead of "complexity"
 * - "high" instead of "complex"
 * - confidence as percentage (85) instead of fraction (0.85)
 */

import { z } from 'zod';

// =============================================================================
// Complexity Tier Normalization
// =============================================================================

const COMPLEXITY_VALUES = ['simple', 'standard', 'complex'] as const;

function normalizeComplexity(value: unknown): string {
  if (typeof value !== 'string') return 'standard';
  const lower = value.toLowerCase().trim();

  const complexityMap: Record<string, string> = {
    // Direct matches
    simple: 'simple',
    standard: 'standard',
    complex: 'complex',
    // Common LLM variations
    easy: 'simple',
    basic: 'simple',
    trivial: 'simple',
    low: 'simple',
    medium: 'standard',
    moderate: 'standard',
    normal: 'standard',
    hard: 'complex',
    high: 'complex',
    difficult: 'complex',
    advanced: 'complex',
  };

  return complexityMap[lower] ?? 'standard';
}

// =============================================================================
// Schema
// =============================================================================

function coerceAssessment(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  // Normalize confidence: convert percentage (85) to fraction (0.85)
  let confidence = raw.confidence;
  if (typeof confidence === 'number' && confidence > 1) {
    confidence = confidence / 100;
  }

  return {
    ...raw,
    // Coerce complexity: accept level, tier, difficulty as aliases
    complexity: normalizeComplexity(raw.complexity ?? raw.level ?? raw.tier ?? raw.difficulty),
    confidence,
    // Coerce reasoning: accept explanation, rationale, justification as aliases
    reasoning: raw.reasoning ?? raw.explanation ?? raw.rationale ?? raw.justification ?? '',
  };
}

export const ComplexityAssessmentSchema = z.preprocess(coerceAssessment, z.object({
  complexity: z.enum(COMPLEXITY_VALUES),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().default(''),
  needs_research: z.boolean().optional(),
  needs_self_critique: z.boolean().optional(),
}).passthrough());

export type ValidatedComplexityAssessment = z.infer<typeof ComplexityAssessmentSchema>;
