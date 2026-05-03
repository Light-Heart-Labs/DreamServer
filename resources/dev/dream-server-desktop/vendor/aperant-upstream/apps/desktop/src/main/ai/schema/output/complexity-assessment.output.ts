/**
 * Clean Complexity Assessment Output Schema
 * ==========================================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * All fields required, no preprocessing or passthrough.
 * Providers with native structured output (Anthropic, OpenAI) enforce
 * this schema at the token level — the model physically cannot produce
 * non-compliant JSON.
 *
 * For file-based validation with LLM field coercion, use
 * ComplexityAssessmentSchema from '../complexity-assessment' instead.
 */

import { z } from 'zod';

export const ComplexityAssessmentOutputSchema = z.object({
  complexity: z.enum(['simple', 'standard', 'complex']),
  confidence: z.number(),
  reasoning: z.string(),
  needs_research: z.boolean(),
  needs_self_critique: z.boolean(),
});

export type ComplexityAssessmentOutput = z.infer<typeof ComplexityAssessmentOutputSchema>;
