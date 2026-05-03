/**
 * Clean QA Signoff Output Schema
 * ===============================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * For file-based validation with LLM field coercion, use
 * QASignoffSchema from '../qa-signoff' instead.
 */

import { z } from 'zod';

const QAIssueOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(['critical', 'warning']),
  location: z.string(),
  fix_required: z.string(),
});

export const QASignoffOutputSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  issues_found: z.array(QAIssueOutputSchema),
});

export type QASignoffOutput = z.infer<typeof QASignoffOutputSchema>;
export type QAIssueOutput = z.infer<typeof QAIssueOutputSchema>;
