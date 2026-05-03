/**
 * PR/MR Review Schemas
 * ====================
 *
 * Zod schemas for validating and coercing LLM-generated PR/MR review data.
 *
 * LLMs produce field name variations (snake_case vs camelCase, etc.).
 * All schemas use `z.preprocess()` to coerce known aliases and `.passthrough()`
 * to preserve unknown fields added by different models.
 */

import { z } from 'zod';

// =============================================================================
// ScanResultSchema — Quick scan output
// =============================================================================

function coerceScanResult(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce riskAreas: accept risk_areas or risks as aliases
    riskAreas: raw.riskAreas ?? raw.risk_areas ?? raw.risks ?? [],
  };
}

export const ScanResultSchema = z.preprocess(
  coerceScanResult,
  z.object({
    complexity: z.string().default('low'),
    riskAreas: z.array(z.string()).default([]),
    verdict: z.string().optional(),
  }).passthrough(),
);

export type ValidatedScanResult = z.infer<typeof ScanResultSchema>;

// =============================================================================
// ReviewFindingSchema — Individual finding from any pass
// =============================================================================

function coerceReviewFinding(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce suggestedFix: accept suggested_fix as alias
    suggestedFix: raw.suggestedFix ?? raw.suggested_fix,
    // Coerce endLine: accept end_line as alias
    endLine: raw.endLine ?? raw.end_line,
    // Coerce verificationNote: accept verification_note as alias
    verificationNote: raw.verificationNote ?? raw.verification_note,
  };
}

export const ReviewFindingSchema = z.preprocess(
  coerceReviewFinding,
  z.object({
    id: z.string().default(''),
    severity: z.string().default('low'),
    category: z.string().default('quality'),
    title: z.string().default(''),
    description: z.string().default(''),
    file: z.string().default(''),
    line: z.number().default(0),
    endLine: z.number().optional(),
    suggestedFix: z.string().optional(),
    fixable: z.boolean().default(false),
    evidence: z.string().optional(),
    verificationNote: z.string().optional(),
  }).passthrough(),
);

export type ValidatedReviewFinding = z.infer<typeof ReviewFindingSchema>;

// =============================================================================
// ReviewFindingsArraySchema — Array of findings with single-object coercion
// =============================================================================

/**
 * Handles the common case where an LLM returns a single object instead of
 * an array, or wraps the array in an object with a "findings" key.
 */
export const ReviewFindingsArraySchema = z.preprocess(
  (input: unknown) => {
    if (Array.isArray(input)) return input;
    // Single object — wrap in array
    if (input && typeof input === 'object') {
      const raw = input as Record<string, unknown>;
      // Check if it's a wrapper object with a findings key
      if (Array.isArray(raw.findings)) return raw.findings;
      // Otherwise treat as single finding
      return [input];
    }
    return [];
  },
  z.array(ReviewFindingSchema).default([]),
);

export type ValidatedReviewFindingsArray = z.infer<typeof ReviewFindingsArraySchema>;

// =============================================================================
// StructuralIssueSchema
// =============================================================================

function coerceStructuralIssue(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce issueType: accept issue_type as alias
    issueType: raw.issueType ?? raw.issue_type ?? '',
  };
}

export const StructuralIssueSchema = z.preprocess(
  coerceStructuralIssue,
  z.object({
    id: z.string().default(''),
    issueType: z.string().default(''),
    severity: z.string().default('low'),
    title: z.string().default(''),
    description: z.string().default(''),
    impact: z.string().default(''),
    suggestion: z.string().default(''),
  }).passthrough(),
);

export type ValidatedStructuralIssue = z.infer<typeof StructuralIssueSchema>;

// =============================================================================
// AICommentTriageSchema
// =============================================================================

function coerceAICommentTriage(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce commentId: accept comment_id as alias
    commentId: raw.commentId ?? raw.comment_id ?? 0,
    // Coerce toolName: accept tool_name as alias
    toolName: raw.toolName ?? raw.tool_name ?? '',
    // Coerce originalComment: accept original_comment as alias
    originalComment: raw.originalComment ?? raw.original_comment ?? '',
    // Coerce responseComment: accept response_comment as alias
    responseComment: raw.responseComment ?? raw.response_comment,
  };
}

export const AICommentTriageSchema = z.preprocess(
  coerceAICommentTriage,
  z.object({
    commentId: z.number().default(0),
    toolName: z.string().default(''),
    originalComment: z.string().default(''),
    verdict: z.string().default('trivial'),
    reasoning: z.string().default(''),
    responseComment: z.string().optional(),
  }).passthrough(),
);

export type ValidatedAICommentTriage = z.infer<typeof AICommentTriageSchema>;

// =============================================================================
// MRReviewResultSchema — Full MR review response
// =============================================================================

function coerceMRReviewResult(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  // Coerce findings: accept array or single object
  let findings = raw.findings;
  if (!Array.isArray(findings)) {
    findings = findings ? [findings] : [];
  }

  return {
    ...raw,
    // Coerce verdictReasoning: accept verdict_reasoning as alias
    verdictReasoning: raw.verdictReasoning ?? raw.verdict_reasoning ?? '',
    findings,
  };
}

export const MRReviewResultSchema = z.preprocess(
  coerceMRReviewResult,
  z.object({
    summary: z.string().default(''),
    verdict: z.string().default('ready_to_merge'),
    verdictReasoning: z.string().default(''),
    findings: z.array(ReviewFindingSchema).default([]),
  }).passthrough(),
);

export type ValidatedMRReviewResult = z.infer<typeof MRReviewResultSchema>;

// =============================================================================
// SynthesisResultSchema — Parallel orchestrator synthesis output
// =============================================================================

function coerceSynthesisResult(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce verdictReasoning: accept verdict_reasoning as alias
    verdictReasoning: raw.verdictReasoning ?? raw.verdict_reasoning ?? '',
    // Coerce keptFindingIds: accept kept_finding_ids as alias
    keptFindingIds: raw.keptFindingIds ?? raw.kept_finding_ids ?? [],
    // Coerce removedFindingIds: accept removed_finding_ids as alias
    removedFindingIds: raw.removedFindingIds ?? raw.removed_finding_ids ?? [],
    // Coerce removalReasons: accept removal_reasons as alias
    removalReasons: raw.removalReasons ?? raw.removal_reasons ?? {},
  };
}

export const SynthesisResultSchema = z.preprocess(
  coerceSynthesisResult,
  z.object({
    verdict: z.string().default('needs_revision'),
    verdictReasoning: z.string().default(''),
    keptFindingIds: z.array(z.string()).default([]),
    removedFindingIds: z.array(z.string()).default([]),
    removalReasons: z.record(z.string(), z.string()).default({}),
  }).passthrough(),
);

export type ValidatedSynthesisResult = z.infer<typeof SynthesisResultSchema>;

// =============================================================================
// ResolutionVerificationSchema — Follow-up resolution verifier output
// =============================================================================

function coerceVerificationItem(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce findingId: accept finding_id as alias
    findingId: raw.findingId ?? raw.finding_id ?? '',
  };
}

export const VerificationItemSchema = z.preprocess(
  coerceVerificationItem,
  z.object({
    findingId: z.string().default(''),
    status: z.string().default('cant_verify'),
    evidence: z.string().default(''),
  }).passthrough(),
);

export type ValidatedVerificationItem = z.infer<typeof VerificationItemSchema>;

export const ResolutionVerificationSchema = z.object({
  verifications: z.array(VerificationItemSchema).default([]),
}).passthrough();

export type ValidatedResolutionVerification = z.infer<typeof ResolutionVerificationSchema>;

// =============================================================================
// SpecialistOutputSchema — Wrapper used by parallel-orchestrator specialists
// =============================================================================

export const SpecialistOutputSchema = z.preprocess(
  (input: unknown) => {
    // If already an array, wrap it
    if (Array.isArray(input)) return { findings: input };
    return input;
  },
  z.object({
    findings: z.array(ReviewFindingSchema).default([]),
    summary: z.string().optional(),
  }).passthrough(),
);

export type ValidatedSpecialistOutput = z.infer<typeof SpecialistOutputSchema>;

// =============================================================================
// FindingValidationResultSchema — Finding validator output per-finding
// =============================================================================

function coerceFindingValidationResult(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    findingId: raw.findingId ?? raw.finding_id ?? '',
    validationStatus: raw.validationStatus ?? raw.validation_status ?? 'needs_human_review',
    codeEvidence: raw.codeEvidence ?? raw.code_evidence ?? '',
  };
}

export const FindingValidationResultSchema = z.preprocess(
  coerceFindingValidationResult,
  z.object({
    findingId: z.string().default(''),
    validationStatus: z.enum(['confirmed_valid', 'dismissed_false_positive', 'needs_human_review']).default('needs_human_review'),
    codeEvidence: z.string().default(''),
    explanation: z.string().default(''),
  }).passthrough(),
);

export const FindingValidationArraySchema = z.preprocess(
  (input: unknown) => {
    if (Array.isArray(input)) return input;
    if (input && typeof input === 'object') {
      const raw = input as Record<string, unknown>;
      if (Array.isArray(raw.validations)) return raw.validations;
      if (Array.isArray(raw.results)) return raw.results;
      if (Array.isArray(raw.findings)) return raw.findings;
      return [input];
    }
    return [];
  },
  z.array(FindingValidationResultSchema).default([]),
);

export type ValidatedFindingValidation = z.infer<typeof FindingValidationResultSchema>;
export type ValidatedFindingValidationArray = z.infer<typeof FindingValidationArraySchema>;
