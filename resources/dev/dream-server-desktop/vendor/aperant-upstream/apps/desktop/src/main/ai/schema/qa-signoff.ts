/**
 * QA Signoff Schema
 * =================
 *
 * Zod schema for validating qa_signoff data embedded in implementation_plan.json.
 * Written by the QA reviewer/fixer agents and read by the QA loop.
 *
 * Handles LLM variations like:
 * - "passed" instead of "approved"
 * - "failed" instead of "rejected"
 * - issues as string instead of array
 */

import { z } from 'zod';

// =============================================================================
// QA Status Normalization
// =============================================================================

const QA_STATUS_VALUES = ['approved', 'rejected', 'fixes_applied', 'in_review', 'unknown'] as const;

function normalizeQAStatus(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const lower = value.toLowerCase().trim();

  const statusMap: Record<string, string> = {
    approved: 'approved',
    passed: 'approved',
    pass: 'approved',
    accepted: 'approved',
    rejected: 'rejected',
    failed: 'rejected',
    fail: 'rejected',
    denied: 'rejected',
    needs_changes: 'rejected',
    fixes_applied: 'fixes_applied',
    fixed: 'fixes_applied',
    in_review: 'in_review',
    reviewing: 'in_review',
    pending: 'in_review',
  };

  return statusMap[lower] ?? 'unknown';
}

// =============================================================================
// QA Issue Schema
// =============================================================================

function coerceIssue(input: unknown): unknown {
  if (typeof input === 'string') {
    return { description: input };
  }
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce description: accept message, text, detail as aliases
    description: raw.description ?? raw.message ?? raw.text ?? raw.detail ?? raw.title ?? '',
    // Coerce type: accept severity, level as aliases
    type: raw.type ?? raw.severity ?? raw.level ?? undefined,
  };
}

export const QAIssueSchema = z.preprocess(coerceIssue, z.object({
  description: z.string(),
  type: z.string().optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  fix_required: z.string().optional(),
}).passthrough());

// =============================================================================
// QA Signoff Schema
// =============================================================================

function coerceSignoff(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  // Coerce issues: handle string, single object, or array
  let issues = raw.issues_found ?? raw.issues ?? raw.findings ?? undefined;
  if (typeof issues === 'string') {
    issues = [{ description: issues }];
  } else if (issues && !Array.isArray(issues)) {
    issues = [issues];
  }

  return {
    ...raw,
    status: normalizeQAStatus(raw.status),
    issues_found: issues,
    // Coerce tests_passed: accept test_results as alias
    tests_passed: raw.tests_passed ?? raw.test_results ?? undefined,
  };
}

export const QASignoffSchema = z.preprocess(coerceSignoff, z.object({
  status: z.enum(QA_STATUS_VALUES).default('unknown'),
  qa_session: z.number().optional(),
  issues_found: z.array(QAIssueSchema).optional(),
  tests_passed: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
  ready_for_qa_revalidation: z.boolean().optional(),
}).passthrough());

export type ValidatedQASignoff = z.infer<typeof QASignoffSchema>;
export type ValidatedQAIssue = z.infer<typeof QAIssueSchema>;
