/**
 * Merge Resolver Runner
 * =====================
 *
 * AI-powered merge conflict resolution using Vercel AI SDK.
 * See apps/desktop/src/main/ai/runners/merge-resolver.ts for the TypeScript implementation.
 *
 * Simple single-turn text generation — takes a system prompt describing
 * the merge context and a user prompt with the conflict, returns the resolution.
 *
 * Uses `createSimpleClient()` with no tools.
 */

import { generateText } from 'ai';

import { createSimpleClient } from '../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../config/types';

// =============================================================================
// Types
// =============================================================================

/** Configuration for merge conflict resolution */
export interface MergeResolverConfig {
  /** System prompt describing the merge resolution context */
  systemPrompt: string;
  /** User prompt with the conflict to resolve */
  userPrompt: string;
  /** Model shorthand (defaults to 'haiku') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (defaults to 'low') */
  thinkingLevel?: ThinkingLevel;
}

/** Result of a merge resolution */
export interface MergeResolverResult {
  /** Whether the resolution succeeded */
  success: boolean;
  /** Resolved text (empty string if failed) */
  text: string;
  /** Error message if failed */
  error?: string;
}

/** Factory function type for creating a resolver call function */
export type MergeResolverCallFn = (system: string, user: string) => Promise<string>;

// =============================================================================
// Merge Resolver
// =============================================================================

/**
 * Resolve a merge conflict using AI.
 *
 * @param config - Merge resolver configuration
 * @returns Resolution result with the resolved text
 */
export async function resolveMergeConflict(
  config: MergeResolverConfig,
): Promise<MergeResolverResult> {
  const {
    systemPrompt,
    userPrompt,
    modelShorthand = 'haiku',
    thinkingLevel = 'low',
  } = config;

  try {
    const client = await createSimpleClient({
      systemPrompt,
      modelShorthand,
      thinkingLevel,
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt: userPrompt,
    });

    if (result.text.trim()) {
      return { success: true, text: result.text.trim() };
    }

    return { success: false, text: '', error: 'Empty response from AI' };
  } catch (error) {
    return {
      success: false,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create a merge resolver call function.
 *
 * Returns a function matching the `(system, user) => string` signature
 * used by the AIResolver class. This mirrors Python's `create_claude_resolver()`.
 *
 * @param modelShorthand - Model to use (defaults to 'haiku')
 * @param thinkingLevel - Thinking level (defaults to 'low')
 * @returns Async function that resolves conflicts
 */
export function createMergeResolverFn(
  modelShorthand: ModelShorthand = 'haiku',
  thinkingLevel: ThinkingLevel = 'low',
): MergeResolverCallFn {
  return async (system: string, user: string): Promise<string> => {
    const result = await resolveMergeConflict({
      systemPrompt: system,
      userPrompt: user,
      modelShorthand,
      thinkingLevel,
    });
    return result.text;
  };
}
