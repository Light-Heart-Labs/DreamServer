/**
 * Rate Limiter for GitHub Automation
 * ====================================
 *
 * Protects against GitHub API rate limits using a token bucket algorithm.
 * See apps/desktop/src/main/ai/runners/github/rate-limiter.ts for the TypeScript implementation.
 *
 * Components:
 * - TokenBucket: Classic token bucket algorithm for rate limiting
 * - CostTracker: AI API cost tracking with budget enforcement
 * - RateLimiter: Singleton managing GitHub and AI cost limits
 */

// =============================================================================
// Errors
// =============================================================================

export class RateLimitExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceeded';
  }
}

export class CostLimitExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostLimitExceeded';
  }
}

// =============================================================================
// Token Bucket
// =============================================================================

/**
 * Classic token bucket algorithm for rate limiting.
 *
 * The bucket has a maximum capacity and refills at a constant rate.
 * Each operation consumes one token. If bucket is empty, operations
 * must wait for refill or be rejected.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number; // milliseconds (Date.now())

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSec * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /** Try to acquire tokens without waiting. Returns true if successful. */
  tryAcquire(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  /**
   * Acquire tokens, waiting if necessary.
   * Returns true if acquired, false if timeout reached.
   */
  async acquire(tokens = 1, timeoutMs?: number): Promise<boolean> {
    const start = Date.now();

    while (true) {
      if (this.tryAcquire(tokens)) return true;

      if (timeoutMs !== undefined && Date.now() - start >= timeoutMs) {
        return false;
      }

      // Calculate time until we have enough tokens
      const tokensNeeded = tokens - this.tokens;
      const waitMs = Math.min((tokensNeeded / this.refillRate) * 1000, 1000);
      await sleep(waitMs);
    }
  }

  /** Get number of currently available tokens. */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Calculate milliseconds until requested tokens available. Returns 0 if immediate. */
  timeUntilAvailableMs(tokens = 1): number {
    this.refill();
    if (this.tokens >= tokens) return 0;
    const tokensNeeded = tokens - this.tokens;
    return (tokensNeeded / this.refillRate) * 1000;
  }
}

// =============================================================================
// AI Cost Tracker
// =============================================================================

/** AI model pricing per 1M tokens (USD) */
const AI_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  default: { input: 3.0, output: 15.0 },
};

interface CostOperation {
  timestamp: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/** Track AI API costs and enforce a per-run budget. */
export class CostTracker {
  private totalCost = 0;
  private operations: CostOperation[] = [];

  constructor(private readonly costLimit: number = 10.0) {}

  /** Calculate cost for a model call without recording it. */
  static calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const pricing = AI_PRICING[model] ?? AI_PRICING.default;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Record an AI operation and check budget.
   * Throws CostLimitExceeded if the operation would exceed the budget.
   */
  addOperation(
    inputTokens: number,
    outputTokens: number,
    model: string,
    operationName = 'unknown',
  ): number {
    const cost = CostTracker.calculateCost(inputTokens, outputTokens, model);

    if (this.totalCost + cost > this.costLimit) {
      throw new CostLimitExceeded(
        `Operation would exceed cost limit: $${(this.totalCost + cost).toFixed(2)} > $${this.costLimit.toFixed(2)}`,
      );
    }

    this.totalCost += cost;
    this.operations.push({
      timestamp: new Date().toISOString(),
      operation: operationName,
      model,
      inputTokens,
      outputTokens,
      cost,
    });

    return cost;
  }

  get total(): number {
    return this.totalCost;
  }

  get remainingBudget(): number {
    return Math.max(0, this.costLimit - this.totalCost);
  }

  usageReport(): string {
    const lines = [
      'Cost Usage Report',
      '='.repeat(50),
      `Total Cost: $${this.totalCost.toFixed(4)}`,
      `Budget: $${this.costLimit.toFixed(2)}`,
      `Remaining: $${this.remainingBudget.toFixed(4)}`,
      `Usage: ${((this.totalCost / this.costLimit) * 100).toFixed(1)}%`,
      '',
      `Operations: ${this.operations.length}`,
    ];

    if (this.operations.length > 0) {
      lines.push('', 'Top 5 Most Expensive Operations:');
      const sorted = [...this.operations].sort((a, b) => b.cost - a.cost);
      for (const op of sorted.slice(0, 5)) {
        lines.push(
          `  $${op.cost.toFixed(4)} - ${op.operation} (${op.inputTokens} in, ${op.outputTokens} out)`,
        );
      }
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Rate Limiter (Singleton)
// =============================================================================

/** Configuration for the rate limiter. */
export interface RateLimiterConfig {
  /** Maximum GitHub API calls per window (default: 5000) */
  githubLimit?: number;
  /** Tokens per second refill rate (default: ~5000/hour ≈ 1.4/s) */
  githubRefillRate?: number;
  /** Maximum AI cost in dollars per run (default: $10) */
  costLimit?: number;
  /** Maximum exponential backoff delay in ms (default: 300_000) */
  maxRetryDelayMs?: number;
}

/**
 * Singleton rate limiter for GitHub automation.
 *
 * Manages:
 * - GitHub API rate limits (token bucket)
 * - AI cost limits (budget tracking)
 * - Request queuing and backoff
 */
export class RateLimiter {
  private static instance: RateLimiter | null = null;

  private readonly githubBucket: TokenBucket;
  readonly costTracker: CostTracker;
  private readonly maxRetryDelayMs: number;

  private githubRequests = 0;
  private githubRateLimited = 0;
  private readonly startTime = new Date();

  private constructor(config: Required<RateLimiterConfig>) {
    this.githubBucket = new TokenBucket(config.githubLimit, config.githubRefillRate);
    this.costTracker = new CostTracker(config.costLimit);
    this.maxRetryDelayMs = config.maxRetryDelayMs;
  }

  /** Get or create the singleton instance. */
  static getInstance(config: RateLimiterConfig = {}): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter({
        githubLimit: config.githubLimit ?? 5000,
        githubRefillRate: config.githubRefillRate ?? 1.4,
        costLimit: config.costLimit ?? 10.0,
        maxRetryDelayMs: config.maxRetryDelayMs ?? 300_000,
      });
    }
    return RateLimiter.instance;
  }

  /** Reset singleton (for testing). */
  static resetInstance(): void {
    RateLimiter.instance = null;
  }

  /**
   * Acquire permission for a GitHub API call.
   * Returns true if granted, false if timeout reached.
   */
  async acquireGithub(timeoutMs?: number): Promise<boolean> {
    this.githubRequests++;
    const success = await this.githubBucket.acquire(1, timeoutMs);
    if (!success) this.githubRateLimited++;
    return success;
  }

  /** Check if GitHub API is available without consuming a token. */
  checkGithubAvailable(): { available: boolean; message: string } {
    const tokens = this.githubBucket.available();
    if (tokens > 0) {
      return { available: true, message: `${tokens} requests available` };
    }
    const waitMs = this.githubBucket.timeUntilAvailableMs();
    return {
      available: false,
      message: `Rate limited. Wait ${(waitMs / 1000).toFixed(1)}s for next request`,
    };
  }

  /**
   * Track AI cost for an operation.
   * Throws CostLimitExceeded if budget would be exceeded.
   */
  trackAiCost(
    inputTokens: number,
    outputTokens: number,
    model: string,
    operationName?: string,
  ): number {
    return this.costTracker.addOperation(inputTokens, outputTokens, model, operationName);
  }

  /**
   * Execute a GitHub API operation with automatic retry and backoff.
   *
   * @param operation - The async operation to execute
   * @param maxRetries - Maximum number of retries (default: 3)
   * @returns The operation result
   */
  async withGithubRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | undefined;
    let delay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const acquired = await this.acquireGithub(10_000);
      if (!acquired) {
        throw new RateLimitExceeded('GitHub API rate limit: timeout waiting for token');
      }

      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxRetries) break;

        // Exponential backoff with jitter
        const jitter = Math.random() * 0.3 * delay;
        const waitMs = Math.min(delay + jitter, this.maxRetryDelayMs);
        await sleep(waitMs);
        delay = Math.min(delay * 2, this.maxRetryDelayMs);
      }
    }

    throw lastError ?? new Error('GitHub operation failed after retries');
  }

  /** Get usage statistics. */
  getStats(): {
    githubRequests: number;
    githubRateLimited: number;
    githubAvailable: number;
    aiCostTotal: number;
    aiCostRemaining: number;
    elapsedSeconds: number;
  } {
    return {
      githubRequests: this.githubRequests,
      githubRateLimited: this.githubRateLimited,
      githubAvailable: this.githubBucket.available(),
      aiCostTotal: this.costTracker.total,
      aiCostRemaining: this.costTracker.remainingBudget,
      elapsedSeconds: (Date.now() - this.startTime.getTime()) / 1000,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
