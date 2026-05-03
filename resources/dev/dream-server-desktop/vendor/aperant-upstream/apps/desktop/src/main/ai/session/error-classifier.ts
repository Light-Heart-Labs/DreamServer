/**
 * Error Classifier
 * ================
 *
 * Classifies errors from AI SDK streaming into structured SessionError objects.
 * Ported from apps/desktop/src/main/ai/session/error-classifier.ts (originally from Python error_utils).
 *
 * Classification categories:
 * - rate_limit: HTTP 429 or rate limit keywords
 * - auth_failure: HTTP 401 or authentication keywords
 * - concurrency: HTTP 400 + tool concurrency keywords
 * - tool_error: Tool execution failures
 * - generic: Everything else
 */

import type { SessionError, SessionOutcome } from './types';

// =============================================================================
// Error Code Constants
// =============================================================================

export const ErrorCode = {
  RATE_LIMITED: 'rate_limited',
  BILLING_ERROR: 'billing_error',
  AUTH_FAILURE: 'auth_failure',
  CONCURRENCY: 'concurrency_error',
  TOOL_ERROR: 'tool_execution_error',
  ABORTED: 'aborted',
  MAX_STEPS: 'max_steps_reached',
  GENERIC: 'generic_error',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// Classification Functions
// =============================================================================

const WORD_BOUNDARY_429 = /\b429\b/;
const WORD_BOUNDARY_401 = /\b401\b/;

/**
 * Billing/balance errors that use HTTP 429 but are NOT temporary rate limits.
 * These require user action (recharging credits) and should not be retried.
 * Checked BEFORE rate limit patterns so they don't get misclassified.
 *
 * Patterns are deliberately specific to avoid false positives on messages
 * like "limit reached for this billing period" (which IS a rate limit).
 */
const BILLING_ERROR_PATTERNS = [
  'insufficient balance',
  'no resource package',
  'please recharge',
  'payment required',
  'credits exhausted',
  'subscription expired',
  'billing error',
] as const;

const RATE_LIMIT_PATTERNS = [
  'limit reached',
  'rate limit',
  'too many requests',
  'usage limit',
  'quota exceeded',
] as const;

const AUTH_PATTERNS = [
  'authentication failed',
  'authentication error',
  'unauthorized',
  'invalid token',
  'token expired',
  'authentication_error',
  'invalid_token',
  'token_expired',
  'not authenticated',
  'http 401',
  'does not have access to claude',
  'please login again',
] as const;

/**
 * Check if an error is a billing/balance error.
 * Some providers (e.g., Z.AI) return HTTP 429 for billing errors,
 * which must be distinguished from temporary rate limits.
 */
export function isBillingError(error: unknown): boolean {
  const errorStr = errorToString(error);
  return BILLING_ERROR_PATTERNS.some((p) => errorStr.includes(p));
}

/**
 * Check if an error is a rate limit error (429 or similar).
 * Excludes billing errors which also use 429 but are not temporary.
 */
export function isRateLimitError(error: unknown): boolean {
  if (isBillingError(error)) return false;
  const errorStr = errorToString(error);
  if (WORD_BOUNDARY_429.test(errorStr)) return true;
  return RATE_LIMIT_PATTERNS.some((p) => errorStr.includes(p));
}

/**
 * Check if an error is an authentication error (401 or similar).
 */
export function isAuthenticationError(error: unknown): boolean {
  const errorStr = errorToString(error);
  if (WORD_BOUNDARY_401.test(errorStr)) return true;
  return AUTH_PATTERNS.some((p) => errorStr.includes(p));
}

/**
 * Check if an error is a 400 tool concurrency error from Claude API.
 */
export function isToolConcurrencyError(error: unknown): boolean {
  const errorStr = errorToString(error);
  return (
    /\b400\b/.test(errorStr) &&
    ((errorStr.includes('tool') && errorStr.includes('concurrency')) ||
      errorStr.includes('too many tools') ||
      errorStr.includes('concurrent tool'))
  );
}

/**
 * Check if an error is from an aborted request.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const errorStr = errorToString(error);
  return errorStr.includes('aborted') || errorStr.includes('abort');
}

// =============================================================================
// Main Classifier
// =============================================================================

export interface ClassifiedError {
  /** The structured session error */
  sessionError: SessionError;
  /** The session outcome to use */
  outcome: SessionOutcome;
}

/**
 * Classify an error into a structured SessionError with the appropriate outcome.
 *
 * Priority order:
 * 1. Abort (not retryable)
 * 2. Billing/balance error (not retryable — needs user action)
 * 3. Rate limit (retryable after backoff)
 * 4. Auth failure (not retryable without re-auth)
 * 5. Concurrency (retryable)
 * 6. Tool error (retryable)
 * 7. Generic (not retryable)
 */
export function classifyError(error: unknown): ClassifiedError {
  const message = sanitizeErrorMessage(errorToString(error));

  if (isAbortError(error)) {
    return {
      sessionError: {
        code: ErrorCode.ABORTED,
        message: 'Session was cancelled',
        retryable: false,
        cause: error,
      },
      outcome: 'cancelled',
    };
  }

  // Billing errors checked BEFORE rate limit — some providers (Z.AI) return
  // HTTP 429 for billing issues which should NOT be retried as rate limits.
  if (isBillingError(error)) {
    return {
      sessionError: {
        code: ErrorCode.BILLING_ERROR,
        message: `Billing error: ${message}`,
        retryable: false,
        cause: error,
      },
      outcome: 'error',
    };
  }

  if (isRateLimitError(error)) {
    return {
      sessionError: {
        code: ErrorCode.RATE_LIMITED,
        message: `Rate limit exceeded: ${message}`,
        retryable: true,
        cause: error,
      },
      outcome: 'rate_limited',
    };
  }

  if (isAuthenticationError(error)) {
    return {
      sessionError: {
        code: ErrorCode.AUTH_FAILURE,
        message: `Authentication failed: ${message}`,
        retryable: false,
        cause: error,
      },
      outcome: 'auth_failure',
    };
  }

  if (isToolConcurrencyError(error)) {
    return {
      sessionError: {
        code: ErrorCode.CONCURRENCY,
        message: `Tool concurrency limit: ${message}`,
        retryable: true,
        cause: error,
      },
      outcome: 'error',
    };
  }

  return {
    sessionError: {
      code: ErrorCode.GENERIC,
      message,
      retryable: false,
      cause: error,
    },
    outcome: 'error',
  };
}

/**
 * Classify a tool execution error specifically.
 */
export function classifyToolError(
  toolName: string,
  toolCallId: string,
  error: unknown,
): SessionError {
  return {
    code: ErrorCode.TOOL_ERROR,
    message: `Tool '${toolName}' (${toolCallId}) failed: ${sanitizeErrorMessage(errorToString(error))}`,
    retryable: true,
    cause: error,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert any error to a lowercase string for pattern matching.
 */
function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === 'string') return error.toLowerCase();
  return String(error).toLowerCase();
}

/**
 * Remove sensitive data from error messages (API keys, tokens).
 */
function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9-_]{20,}/g, 'sk-***')
    .replace(/Bearer [a-zA-Z0-9\-_.+/=]+/gi, 'Bearer ***')
    .replace(/token[=:]\s*[a-zA-Z0-9\-_.+/=]+/gi, 'token=***');
}
