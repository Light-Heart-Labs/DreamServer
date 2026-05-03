/**
 * Conversation Compactor
 * ======================
 *
 * Summarizes phase outputs to maintain continuity between phases while
 * reducing token usage. After each phase completes, key findings are
 * summarized and passed as context to subsequent phases.
 *
 * See apps/desktop/src/main/ai/spec/conversation-compactor.ts for the TypeScript implementation.
 */

import { generateText } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum input chars to send for summarization */
const MAX_INPUT_CHARS = 15000;

/** Maximum chars per file before truncation */
const MAX_FILE_CHARS = 10000;

/** Default target summary length in words */
const DEFAULT_TARGET_WORDS = 500;

/** Maps phases to the output files they produce */
const PHASE_OUTPUT_FILES: Record<string, string[]> = {
  discovery: ['context.json'],
  requirements: ['requirements.json'],
  research: ['research.json'],
  context: ['context.json'],
  quick_spec: ['spec.md'],
  spec_writing: ['spec.md'],
  self_critique: ['spec.md', 'critique_notes.md'],
  planning: ['implementation_plan.json'],
  validation: [],
};

const COMPACTOR_SYSTEM_PROMPT =
  'You are a concise technical summarizer. Extract only the most ' +
  'critical information from phase outputs. Use bullet points. ' +
  'Focus on decisions, discoveries, and actionable insights.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gather output files from a completed phase for summarization.
 * Ported from: `gather_phase_outputs()` in compaction.py
 */
export function gatherPhaseOutputs(specDir: string, phaseName: string): string {
  const outputFiles = PHASE_OUTPUT_FILES[phaseName] ?? [];
  const outputs: string[] = [];

  for (const filename of outputFiles) {
    const filePath = join(specDir, filename);
    if (!existsSync(filePath)) continue;

    try {
      let content = readFileSync(filePath, 'utf-8');
      if (content.length > MAX_FILE_CHARS) {
        content = `${content.slice(0, MAX_FILE_CHARS)}\n\n[... file truncated ...]`;
      }
      outputs.push(`**${filename}**:\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      // Skip unreadable files
    }
  }

  return outputs.join('\n\n');
}

/**
 * Format accumulated phase summaries for injection into agent context.
 * Ported from: `format_phase_summaries()` in compaction.py
 */
export function formatPhaseSummaries(summaries: Record<string, string>): string {
  if (Object.keys(summaries).length === 0) {
    return '';
  }

  const parts = ['## Context from Previous Phases\n'];
  for (const [phaseName, summary] of Object.entries(summaries)) {
    const title = phaseName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    parts.push(`### ${title}\n${summary}\n`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Summarize phase output to a concise summary for subsequent phases.
 * Ported from: `summarize_phase_output()` in compaction.py
 *
 * Uses a lightweight model for cost efficiency (Haiku default).
 *
 * @param phaseName - Name of the completed phase (e.g., 'discovery', 'requirements')
 * @param phaseOutput - Full output content from the phase (file contents, decisions)
 * @param targetWords - Target summary length in words (~500-1000 recommended)
 * @returns Concise summary of key findings, decisions, and insights from the phase
 */
export async function summarizePhaseOutput(
  phaseName: string,
  phaseOutput: string,
  targetWords = DEFAULT_TARGET_WORDS,
): Promise<string> {
  // Truncate input if too large
  let truncatedOutput = phaseOutput;
  if (phaseOutput.length > MAX_INPUT_CHARS) {
    truncatedOutput = `${phaseOutput.slice(0, MAX_INPUT_CHARS)}\n\n[... output truncated for summarization ...]`;
  }

  const prompt = `Summarize the key findings from the "${phaseName}" phase in ${targetWords} words or less.

Focus on extracting ONLY the most critical information that subsequent phases need:
- Key decisions made and their rationale
- Critical files, components, or patterns identified
- Important constraints or requirements discovered
- Actionable insights for implementation

Be concise and use bullet points. Skip boilerplate and meta-commentary.

## Phase Output:
${truncatedOutput}

## Summary:
`;

  try {
    const client = await createSimpleClient({
      systemPrompt: COMPACTOR_SYSTEM_PROMPT,
      modelShorthand: 'haiku',
      thinkingLevel: 'low',
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt,
    });

    if (result.text.trim()) {
      return result.text.trim();
    }
  } catch (error: unknown) {
    // Fallback: return truncated raw output on error
    const fallback = phaseOutput.slice(0, 2000);
    const suffix = phaseOutput.length > 2000 ? '\n\n[... truncated ...]' : '';
    const errMsg = error instanceof Error ? error.message : String(error);
    return `[Summarization failed: ${errMsg}]\n\n${fallback}${suffix}`;
  }

  // Empty response fallback
  return phaseOutput.slice(0, 1000);
}

/**
 * Compact a completed phase by gathering its outputs and summarizing them.
 *
 * This is the main entry point used by the spec orchestrator after each phase.
 *
 * @param specDir - Path to the spec directory
 * @param phaseName - Name of the completed phase
 * @param targetWords - Target summary length in words
 * @returns Summary string (empty string if phase has no outputs to summarize)
 */
export async function compactPhase(
  specDir: string,
  phaseName: string,
  targetWords = DEFAULT_TARGET_WORDS,
): Promise<string> {
  const phaseOutput = gatherPhaseOutputs(specDir, phaseName);

  if (!phaseOutput) {
    return '';
  }

  return summarizePhaseOutput(phaseName, phaseOutput, targetWords);
}
