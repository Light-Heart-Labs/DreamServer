import { describe, it, expect } from 'vitest';

import {
  isBillingError,
  isRateLimitError,
  isAuthenticationError,
  isToolConcurrencyError,
  isAbortError,
  classifyError,
  classifyToolError,
  ErrorCode,
} from '../error-classifier';

// =============================================================================
// isBillingError
// =============================================================================

describe('isBillingError', () => {
  it('should detect Z.AI insufficient balance error', () => {
    expect(isBillingError('Insufficient balance or no resource package. Please recharge.')).toBe(true);
  });

  it('should detect individual billing patterns', () => {
    expect(isBillingError('insufficient balance')).toBe(true);
    expect(isBillingError('no resource package')).toBe(true);
    expect(isBillingError('please recharge your account')).toBe(true);
    expect(isBillingError('payment required')).toBe(true);
    expect(isBillingError('credits exhausted')).toBe(true);
    expect(isBillingError('subscription expired')).toBe(true);
  });

  it('should not match rate limit messages that mention billing period', () => {
    expect(isBillingError('limit reached for this billing period')).toBe(false);
  });

  it('should not match unrelated errors', () => {
    expect(isBillingError('rate limit exceeded')).toBe(false);
    expect(isBillingError('connection refused')).toBe(false);
  });
});

// =============================================================================
// isRateLimitError
// =============================================================================

describe('isRateLimitError', () => {
  it('should detect HTTP 429', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('should detect rate limit keywords', () => {
    expect(isRateLimitError('rate limit exceeded')).toBe(true);
    expect(isRateLimitError('too many requests')).toBe(true);
    expect(isRateLimitError('usage limit reached')).toBe(true);
    expect(isRateLimitError('quota exceeded')).toBe(true);
    expect(isRateLimitError('limit reached for this billing period')).toBe(true);
  });

  it('should not match billing errors that use 429', () => {
    expect(isRateLimitError('429 Insufficient balance or no resource package')).toBe(false);
    expect(isRateLimitError('429 please recharge')).toBe(false);
  });

  it('should not match non-rate-limit errors', () => {
    expect(isRateLimitError('connection refused')).toBe(false);
    expect(isRateLimitError(new Error('timeout'))).toBe(false);
  });

  it('should not match 429 embedded in other numbers', () => {
    // \b429\b should not match 4290 or 1429
    expect(isRateLimitError('error code 4290')).toBe(false);
  });
});

// =============================================================================
// isAuthenticationError
// =============================================================================

describe('isAuthenticationError', () => {
  it('should detect HTTP 401', () => {
    expect(isAuthenticationError(new Error('HTTP 401 Unauthorized'))).toBe(true);
  });

  it('should detect auth keywords', () => {
    expect(isAuthenticationError('authentication failed')).toBe(true);
    expect(isAuthenticationError('unauthorized access')).toBe(true);
    expect(isAuthenticationError('invalid token provided')).toBe(true);
    expect(isAuthenticationError('token expired')).toBe(true);
    expect(isAuthenticationError('authentication_error')).toBe(true);
    expect(isAuthenticationError('does not have access to claude')).toBe(true);
    expect(isAuthenticationError('please login again')).toBe(true);
  });

  it('should not match non-auth errors', () => {
    expect(isAuthenticationError('connection timeout')).toBe(false);
  });
});

// =============================================================================
// isToolConcurrencyError
// =============================================================================

describe('isToolConcurrencyError', () => {
  it('should detect 400 + tool concurrency', () => {
    expect(isToolConcurrencyError('400 tool concurrency limit')).toBe(true);
    expect(isToolConcurrencyError('400 too many tools running')).toBe(true);
    expect(isToolConcurrencyError('400 concurrent tool limit')).toBe(true);
  });

  it('should not match 400 without concurrency keywords', () => {
    expect(isToolConcurrencyError('400 bad request')).toBe(false);
  });

  it('should not match concurrency without 400', () => {
    expect(isToolConcurrencyError('tool concurrency limit')).toBe(false);
  });
});

// =============================================================================
// isAbortError
// =============================================================================

describe('isAbortError', () => {
  it('should detect DOMException AbortError', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('should detect abort keyword in string', () => {
    expect(isAbortError('request aborted')).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isAbortError('timeout')).toBe(false);
  });
});

// =============================================================================
// classifyError
// =============================================================================

describe('classifyError', () => {
  it('should classify abort errors with cancelled outcome', () => {
    const err = new DOMException('aborted', 'AbortError');
    const result = classifyError(err);
    expect(result.sessionError.code).toBe(ErrorCode.ABORTED);
    expect(result.outcome).toBe('cancelled');
    expect(result.sessionError.retryable).toBe(false);
  });

  it('should classify billing errors as non-retryable', () => {
    const result = classifyError(new Error('429 Insufficient balance or no resource package'));
    expect(result.sessionError.code).toBe(ErrorCode.BILLING_ERROR);
    expect(result.outcome).toBe('error');
    expect(result.sessionError.retryable).toBe(false);
  });

  it('should classify 429 as rate_limited', () => {
    const result = classifyError(new Error('429 rate limit'));
    expect(result.sessionError.code).toBe(ErrorCode.RATE_LIMITED);
    expect(result.outcome).toBe('rate_limited');
    expect(result.sessionError.retryable).toBe(true);
  });

  it('should classify 401 as auth_failure', () => {
    const result = classifyError(new Error('401 unauthorized'));
    expect(result.sessionError.code).toBe(ErrorCode.AUTH_FAILURE);
    expect(result.outcome).toBe('auth_failure');
    expect(result.sessionError.retryable).toBe(false);
  });

  it('should classify 400 concurrency as retryable error', () => {
    const result = classifyError(new Error('400 tool concurrency exceeded'));
    expect(result.sessionError.code).toBe(ErrorCode.CONCURRENCY);
    expect(result.outcome).toBe('error');
    expect(result.sessionError.retryable).toBe(true);
  });

  it('should classify unknown errors as generic', () => {
    const result = classifyError(new Error('something went wrong'));
    expect(result.sessionError.code).toBe(ErrorCode.GENERIC);
    expect(result.outcome).toBe('error');
    expect(result.sessionError.retryable).toBe(false);
  });

  it('should prioritize abort over rate limit', () => {
    // An error message that matches both abort and rate limit
    const err = new DOMException('aborted 429', 'AbortError');
    const result = classifyError(err);
    expect(result.sessionError.code).toBe(ErrorCode.ABORTED);
  });

  it('should sanitize API keys from error messages', () => {
    const result = classifyError(new Error('failed with key sk-ant-abc123456789012345678'));
    expect(result.sessionError.message).not.toContain('sk-ant-abc123456789012345678');
    expect(result.sessionError.message).toContain('sk-***');
  });

  it('should sanitize Bearer tokens from error messages', () => {
    const result = classifyError(new Error('Bearer eyJhbGciOiJIUzI1NiJ9.test'));
    expect(result.sessionError.message).toContain('Bearer ***');
  });

  it('should sanitize token= values from error messages', () => {
    const result = classifyError(new Error('token=secret123abc'));
    expect(result.sessionError.message).toContain('token=***');
  });

  it('should preserve cause in error', () => {
    const original = new Error('test');
    const result = classifyError(original);
    expect(result.sessionError.cause).toBe(original);
  });
});

// =============================================================================
// classifyToolError
// =============================================================================

describe('classifyToolError', () => {
  it('should create tool error with correct code', () => {
    const result = classifyToolError('Bash', 'call-1', 'command not found');
    expect(result.code).toBe(ErrorCode.TOOL_ERROR);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("Tool 'Bash'");
    expect(result.message).toContain('call-1');
  });

  it('should sanitize tool error messages', () => {
    const result = classifyToolError('Bash', 'c1', 'failed with sk-ant-secret1234567890abcdef');
    expect(result.message).not.toContain('secret');
    expect(result.message).toContain('sk-***');
  });
});
