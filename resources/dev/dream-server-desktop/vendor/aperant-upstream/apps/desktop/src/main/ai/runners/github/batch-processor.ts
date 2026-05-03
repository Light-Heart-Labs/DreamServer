/**
 * Batch Processor for GitHub Issues
 * ====================================
 *
 * Groups similar issues together for combined processing with configurable
 * concurrency limits. See apps/desktop/src/main/ai/runners/github/batch-processor.ts for the TypeScript implementation.
 *
 * Uses a single AI call (generateText) to analyze and group issues, then
 * processes each batch with bounded concurrency via a semaphore.
 */

import { generateText } from 'ai';

import { createSimpleClient } from '../../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import type { GitHubIssue } from './duplicate-detector';

// =============================================================================
// Types
// =============================================================================

/** A suggestion for grouping issues into a batch. */
export interface BatchSuggestion {
  issueNumbers: number[];
  theme: string;
  reasoning: string;
  confidence: number;
}

/** Status of a batch being processed. */
export type BatchStatus =
  | 'pending'
  | 'analyzing'
  | 'processing'
  | 'completed'
  | 'failed';

/** A batch of related issues. */
export interface IssueBatch {
  batchId: string;
  issues: GitHubIssue[];
  theme: string;
  reasoning: string;
  confidence: number;
  status: BatchStatus;
  error?: string;
}

/** Result of processing a single batch. */
export interface BatchResult<T> {
  batchId: string;
  issues: number[];
  result?: T;
  error?: string;
  success: boolean;
}

/** Configuration for the batch processor. */
export interface BatchProcessorConfig {
  /** Maximum issues per batch (default: 5) */
  maxBatchSize?: number;
  /** Maximum concurrent batches being processed (default: 3) */
  concurrency?: number;
  /** Model for AI-assisted grouping (default: 'sonnet') */
  model?: ModelShorthand;
  /** Thinking level for AI analysis (default: 'low') */
  thinkingLevel?: ThinkingLevel;
}

/** Progress update from batch processing. */
export interface BatchProgressUpdate {
  phase: string;
  processed: number;
  total: number;
  message: string;
}

export type BatchProgressCallback = (update: BatchProgressUpdate) => void;

// =============================================================================
// AI-Assisted Issue Grouping
// =============================================================================

/** Fallback: each issue gets its own batch. */
function fallbackBatches(issues: GitHubIssue[]): BatchSuggestion[] {
  return issues.map((issue) => ({
    issueNumbers: [issue.number],
    theme: issue.title ?? `Issue #${issue.number}`,
    reasoning: 'Fallback: individual batch',
    confidence: 0.5,
  }));
}

/** Parse JSON from AI response, handling markdown code fences. */
function parseJsonResponse(text: string): unknown {
  let content = text.trim();

  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    content = fenceMatch[1];
  } else if (content.includes('{')) {
    // Extract the outermost JSON object
    const start = content.indexOf('{');
    let depth = 0;
    for (let i = start; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) {
          content = content.slice(start, i + 1);
          break;
        }
      }
    }
  }

  return JSON.parse(content);
}

/**
 * Use AI to analyze issues and suggest optimal batching.
 *
 * Makes a single generateText() call for all issues, replacing the
 * Python claude-agent-sdk implementation.
 */
async function analyzeAndBatchIssues(
  issues: GitHubIssue[],
  config: Required<BatchProcessorConfig>,
): Promise<BatchSuggestion[]> {
  if (issues.length === 0) return [];

  if (issues.length === 1) {
    return [
      {
        issueNumbers: [issues[0].number],
        theme: issues[0].title ?? 'Single issue',
        reasoning: 'Single issue in group',
        confidence: 1.0,
      },
    ];
  }

  const issueList = issues
    .map(
      (issue) =>
        `- #${issue.number}: ${issue.title ?? 'No title'}\n` +
        `  Labels: ${(issue.labels ?? []).map((l) => l.name).join(', ') || 'none'}\n` +
        `  Body: ${(issue.body ?? '').slice(0, 200)}...`,
    )
    .join('\n');

  const prompt = `Analyze these GitHub issues and group them into batches that should be fixed together.

ISSUES TO ANALYZE:
${issueList}

RULES:
1. Group issues that share a common root cause or affect the same component
2. Maximum ${config.maxBatchSize} issues per batch
3. Issues that are unrelated should be in separate batches (even single-issue batches)
4. Be conservative - only batch issues that clearly belong together

Respond with JSON only:
{
  "batches": [
    {
      "issue_numbers": [1, 2, 3],
      "theme": "Authentication issues",
      "reasoning": "All related to login flow",
      "confidence": 0.85
    },
    {
      "issue_numbers": [4],
      "theme": "UI bug",
      "reasoning": "Unrelated to other issues",
      "confidence": 0.95
    }
  ]
}`;

  try {
    const client = await createSimpleClient({
      systemPrompt:
        'You are an expert at analyzing GitHub issues and grouping related ones. Respond ONLY with valid JSON. Do NOT use any tools.',
      modelShorthand: config.model,
      thinkingLevel: config.thinkingLevel,
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt,
    });

    const parsed = parseJsonResponse(result.text) as {
      batches?: Array<{
        issue_numbers?: number[];
        theme?: string;
        reasoning?: string;
        confidence?: number;
      }>;
    };

    if (!Array.isArray(parsed.batches)) {
      return fallbackBatches(issues);
    }

    return parsed.batches.map((b) => ({
      issueNumbers: b.issue_numbers ?? [],
      theme: b.theme ?? '',
      reasoning: b.reasoning ?? '',
      confidence: b.confidence ?? 0.5,
    }));
  } catch {
    return fallbackBatches(issues);
  }
}

// =============================================================================
// Semaphore for Concurrency Control
// =============================================================================

class Semaphore {
  private count: number;
  private waitQueue: Array<() => void> = [];

  constructor(limit: number) {
    this.count = limit;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.count--;
  }

  release(): void {
    this.count++;
    const next = this.waitQueue.shift();
    if (next) {
      this.count--;
      next();
    }
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// =============================================================================
// Batch Processor
// =============================================================================

/**
 * Processes GitHub issues in batches with configurable concurrency.
 *
 * Workflow:
 * 1. Uses AI to suggest optimal groupings of related issues
 * 2. Processes each batch concurrently up to the configured concurrency limit
 * 3. Reports progress via callback
 */
export class BatchProcessor {
  private readonly config: Required<BatchProcessorConfig>;

  constructor(config: BatchProcessorConfig = {}) {
    this.config = {
      maxBatchSize: config.maxBatchSize ?? 5,
      concurrency: config.concurrency ?? 3,
      model: config.model ?? 'sonnet',
      thinkingLevel: config.thinkingLevel ?? 'low',
    };
  }

  /**
   * Group issues using AI-assisted analysis.
   *
   * @param issues - Issues to group
   * @returns Array of batch suggestions
   */
  async groupIssues(issues: GitHubIssue[]): Promise<BatchSuggestion[]> {
    return analyzeAndBatchIssues(issues, this.config);
  }

  /**
   * Build IssueBatch objects from a list of issues and batch suggestions.
   */
  buildBatches(issues: GitHubIssue[], suggestions: BatchSuggestion[]): IssueBatch[] {
    const issueMap = new Map(issues.map((i) => [i.number, i]));

    return suggestions.map((suggestion, idx) => {
      const batchIssues = suggestion.issueNumbers
        .map((n) => issueMap.get(n))
        .filter((i): i is GitHubIssue => i !== undefined);

      return {
        batchId: `batch-${String(idx + 1).padStart(3, '0')}`,
        issues: batchIssues,
        theme: suggestion.theme,
        reasoning: suggestion.reasoning,
        confidence: suggestion.confidence,
        status: 'pending' as BatchStatus,
      };
    });
  }

  /**
   * Process all issues in batches with concurrency control.
   *
   * @param issues - Issues to process
   * @param processor - Async function to call for each batch
   * @param onProgress - Optional progress callback
   * @returns Results for each batch
   */
  async processBatches<T>(
    issues: GitHubIssue[],
    processor: (batch: IssueBatch) => Promise<T>,
    onProgress?: BatchProgressCallback,
  ): Promise<BatchResult<T>[]> {
    if (issues.length === 0) return [];

    // Step 1: Group issues
    onProgress?.({
      phase: 'grouping',
      processed: 0,
      total: issues.length,
      message: 'Analyzing and grouping issues...',
    });

    const suggestions = await this.groupIssues(issues);
    const batches = this.buildBatches(issues, suggestions);

    // Step 2: Process batches with concurrency limit
    const semaphore = new Semaphore(this.config.concurrency);
    let processed = 0;
    const total = batches.length;

    const results: BatchResult<T>[] = await Promise.all(
      batches.map((batch) =>
        semaphore.use(async (): Promise<BatchResult<T>> => {
          batch.status = 'processing';

          try {
            const result = await processor(batch);
            batch.status = 'completed';
            processed++;

            onProgress?.({
              phase: 'processing',
              processed,
              total,
              message: `Processed batch ${batch.batchId} (${batch.issues.length} issues)`,
            });

            return {
              batchId: batch.batchId,
              issues: batch.issues.map((i) => i.number),
              result,
              success: true,
            };
          } catch (error) {
            batch.status = 'failed';
            const errorMsg = error instanceof Error ? error.message : String(error);
            batch.error = errorMsg;
            processed++;

            onProgress?.({
              phase: 'processing',
              processed,
              total,
              message: `Batch ${batch.batchId} failed: ${errorMsg}`,
            });

            return {
              batchId: batch.batchId,
              issues: batch.issues.map((i) => i.number),
              error: errorMsg,
              success: false,
            };
          }
        }),
      ),
    );

    onProgress?.({
      phase: 'complete',
      processed: total,
      total,
      message: `Processed ${total} batches (${results.filter((r) => r.success).length} succeeded)`,
    });

    return results;
  }

  /**
   * Process issues one-by-one (no batching) with concurrency control.
   * Useful when each issue should be handled independently.
   */
  async processIndividually<T>(
    issues: GitHubIssue[],
    processor: (issue: GitHubIssue) => Promise<T>,
    onProgress?: BatchProgressCallback,
  ): Promise<BatchResult<T>[]> {
    const semaphore = new Semaphore(this.config.concurrency);
    let processed = 0;
    const total = issues.length;

    return Promise.all(
      issues.map((issue) =>
        semaphore.use(async (): Promise<BatchResult<T>> => {
          try {
            const result = await processor(issue);
            processed++;

            onProgress?.({
              phase: 'processing',
              processed,
              total,
              message: `Processed issue #${issue.number}`,
            });

            return {
              batchId: `issue-${issue.number}`,
              issues: [issue.number],
              result,
              success: true,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            processed++;

            return {
              batchId: `issue-${issue.number}`,
              issues: [issue.number],
              error: errorMsg,
              success: false,
            };
          }
        }),
      ),
    );
  }
}
