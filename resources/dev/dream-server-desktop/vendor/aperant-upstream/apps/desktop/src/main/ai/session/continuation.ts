/**
 * Session Continuation
 * ====================
 *
 * Wraps `runAgentSession()` to enable context-window-aware continuation.
 * When a session hits the 90% context window threshold, the conversation is
 * compacted into a summary and a fresh session resumes where the previous left off.
 *
 * Architecture:
 * - `runContinuableSession()` loops over `runAgentSession()` calls
 * - On `context_window` outcome: compact messages → inject summary → re-run
 * - On any other outcome: return merged result
 * - `maxContinuations` (default 5) prevents infinite loops
 *
 * The orchestration layer (`BuildOrchestrator`, `QALoop`) doesn't know about
 * continuations — they call `runSingleSession()` which uses this wrapper.
 */

import { generateText } from 'ai';

import { runAgentSession } from './runner';
import type { RunnerOptions } from './runner';
import type { SessionConfig, SessionResult, SessionMessage, TokenUsage } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of continuations before hard-stopping */
const DEFAULT_MAX_CONTINUATIONS = 5;

/** Maximum characters of conversation to send for summarization */
const MAX_SUMMARY_INPUT_CHARS = 30_000;

/** Target summary length in words */
const SUMMARY_TARGET_WORDS = 800;

/** Fallback: raw truncation length if summarization fails */
const RAW_TRUNCATION_CHARS = 3000;

const SUMMARIZER_SYSTEM_PROMPT =
  'You are a concise technical summarizer. Given a conversation between an AI agent ' +
  'and its tools, extract the key information needed to continue the work. Focus on: ' +
  'what has been accomplished, what files were modified, what remains to be done, ' +
  'and any critical decisions or findings. Use bullet points. Be thorough but concise.';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the continuation wrapper.
 */
export interface ContinuationConfig {
  /** Maximum number of continuations (default 5) */
  maxContinuations?: number;
  /** Context window limit in tokens (from model metadata) */
  contextWindowLimit: number;
  /** API key for creating the summarization model */
  apiKey?: string;
  /** Base URL for the summarization model */
  baseURL?: string;
  /** OAuth token file path (for token refresh) */
  oauthTokenFilePath?: string;
}

/**
 * Extended result from a continuable session.
 */
export interface ContinuationResult extends SessionResult {
  /** Number of continuations performed (0 = no continuation needed) */
  continuationCount: number;
  /** Cumulative token usage across all continuations */
  cumulativeUsage: TokenUsage;
}

// =============================================================================
// Core Function
// =============================================================================

/**
 * Run an agent session with automatic continuation on context window exhaustion.
 *
 * When the underlying session returns `outcome: 'context_window'`, this wrapper:
 * 1. Compacts the conversation messages into a summary
 * 2. Creates a continuation message with the summary
 * 3. Starts a fresh session with the summary as initial context
 * 4. Repeats until the session completes or max continuations is reached
 *
 * @param config - Session configuration (model, prompts, tools, limits)
 * @param options - Runner options (event callback, auth refresh, tools)
 * @param continuationConfig - Continuation-specific settings
 * @returns ContinuationResult with merged usage and continuation count
 */
export async function runContinuableSession(
  config: SessionConfig,
  options: RunnerOptions = {},
  continuationConfig: ContinuationConfig,
): Promise<ContinuationResult> {
  const maxContinuations = continuationConfig.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;

  let currentConfig = config;
  let continuationCount = 0;
  let totalStepsExecuted = 0;
  let totalToolCallCount = 0;
  let totalDurationMs = 0;
  const cumulativeUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // Continuation loop
  for (let i = 0; i <= maxContinuations; i++) {
    const result = await runAgentSession(currentConfig, options);

    // Accumulate metrics
    totalStepsExecuted += result.stepsExecuted;
    totalToolCallCount += result.toolCallCount;
    totalDurationMs += result.durationMs;
    addUsage(cumulativeUsage, result.usage);

    // If not a context window outcome, we're done
    if (result.outcome !== 'context_window') {
      return {
        ...result,
        stepsExecuted: totalStepsExecuted,
        toolCallCount: totalToolCallCount,
        durationMs: totalDurationMs,
        usage: cumulativeUsage,
        continuationCount,
        cumulativeUsage,
      };
    }

    // Don't continue if we've reached the limit
    if (i >= maxContinuations) {
      return {
        ...result,
        outcome: 'completed', // Treat as completed — agent did useful work
        stepsExecuted: totalStepsExecuted,
        toolCallCount: totalToolCallCount,
        durationMs: totalDurationMs,
        usage: cumulativeUsage,
        continuationCount,
        cumulativeUsage,
      };
    }

    // Check abort signal before starting compaction
    if (config.abortSignal?.aborted) {
      return {
        ...result,
        outcome: 'cancelled',
        stepsExecuted: totalStepsExecuted,
        toolCallCount: totalToolCallCount,
        durationMs: totalDurationMs,
        usage: cumulativeUsage,
        continuationCount,
        cumulativeUsage,
      };
    }

    // Compact and continue
    continuationCount++;
    const summary = await compactSessionMessages(
      result.messages,
      continuationConfig,
      config.abortSignal,
    );

    const continuationMessage: SessionMessage = {
      role: 'user',
      content: buildContinuationPrompt(summary, continuationCount),
    };

    // Create a fresh config with the continuation message
    currentConfig = {
      ...config,
      initialMessages: [continuationMessage],
    };
  }

  // Should not reach here, but guard against it
  return {
    outcome: 'completed',
    stepsExecuted: totalStepsExecuted,
    toolCallCount: totalToolCallCount,
    durationMs: totalDurationMs,
    usage: cumulativeUsage,
    messages: [],
    error: undefined,
    continuationCount,
    cumulativeUsage,
  };
}

// =============================================================================
// Message Compaction
// =============================================================================

/**
 * Compact session messages into a summary for continuation.
 * Uses Haiku via `generateText()` for fast, cheap summarization.
 * Falls back to raw truncation if the summarization call fails.
 */
async function compactSessionMessages(
  messages: SessionMessage[],
  continuationConfig: ContinuationConfig,
  abortSignal?: AbortSignal,
): Promise<string> {
  // Serialize messages to text
  let serialized = serializeMessages(messages);
  if (serialized.length > MAX_SUMMARY_INPUT_CHARS) {
    serialized = serialized.slice(0, MAX_SUMMARY_INPUT_CHARS) + '\n\n[... conversation truncated ...]';
  }

  // Check abort before making the summarization call
  if (abortSignal?.aborted) {
    return rawTruncation(messages);
  }

  try {
    // Use Haiku for summarization — fast and cheap
    const { createProviderFromModelId } = await import('../providers/factory');
    const summarizerModel = createProviderFromModelId('claude-haiku-4-5-20251001', {
      apiKey: continuationConfig.apiKey,
      baseURL: continuationConfig.baseURL,
      oauthTokenFilePath: continuationConfig.oauthTokenFilePath,
    });

    const prompt =
      `Summarize this AI agent conversation in approximately ${SUMMARY_TARGET_WORDS} words.\n\n` +
      `Focus on:\n` +
      `- What tasks/subtasks have been completed\n` +
      `- What files were created, modified, or read\n` +
      `- Key decisions made and their rationale\n` +
      `- What work remains to be done\n` +
      `- Any errors encountered and how they were resolved\n\n` +
      `## Conversation:\n${serialized}\n\n## Summary:`;

    const result = await generateText({
      model: summarizerModel,
      system: SUMMARIZER_SYSTEM_PROMPT,
      prompt,
      abortSignal,
    });

    if (result.text.trim()) {
      return result.text.trim();
    }
  } catch {
    // Summarization failed — fall back to raw truncation
  }

  return rawTruncation(messages);
}

/**
 * Serialize session messages to a human-readable text format.
 */
function serializeMessages(messages: SessionMessage[]): string {
  return messages
    .map((msg) => `[${msg.role.toUpperCase()}]\n${msg.content}`)
    .join('\n\n---\n\n');
}

/**
 * Fallback: extract the last N characters from the final messages.
 */
function rawTruncation(messages: SessionMessage[]): string {
  // Take the last few messages and truncate
  const lastMessages = messages.slice(-5);
  const text = serializeMessages(lastMessages);
  if (text.length <= RAW_TRUNCATION_CHARS) {
    return text;
  }
  return text.slice(-RAW_TRUNCATION_CHARS) + '\n\n[... truncated ...]';
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build the continuation prompt injected as the initial user message.
 */
function buildContinuationPrompt(summary: string, continuationNumber: number): string {
  return (
    `## Session Continuation (${continuationNumber})\n\n` +
    `You are continuing a previous session that ran out of context window space. ` +
    `Here is a summary of your prior work:\n\n` +
    `${summary}\n\n` +
    `Continue where you left off. Do NOT repeat completed work. ` +
    `Focus on what remains to be done.`
  );
}

/**
 * Add usage from one result into a cumulative total.
 */
function addUsage(cumulative: TokenUsage, addition: TokenUsage): void {
  cumulative.promptTokens += addition.promptTokens;
  cumulative.completionTokens += addition.completionTokens;
  cumulative.totalTokens += addition.totalTokens;
  if (addition.thinkingTokens) {
    cumulative.thinkingTokens = (cumulative.thinkingTokens ?? 0) + addition.thinkingTokens;
  }
  if (addition.cacheReadTokens) {
    cumulative.cacheReadTokens = (cumulative.cacheReadTokens ?? 0) + addition.cacheReadTokens;
  }
  if (addition.cacheCreationTokens) {
    cumulative.cacheCreationTokens = (cumulative.cacheCreationTokens ?? 0) + addition.cacheCreationTokens;
  }
}
