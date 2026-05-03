/**
 * QA Session Context Builder
 *
 * Builds a formatted memory context block to inject into QA agent sessions
 * before they start. QA sessions receive e2e_observation, error_pattern,
 * and requirement memories to guide targeted validation.
 */

import type { Memory, MemoryService } from '../types';

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build a formatted memory context string for a QA agent session.
 *
 * @param specDescription - Description or title of the spec being validated
 * @param relevantModules - Module names relevant to the current task
 * @param memoryService - Memory service instance
 * @param projectId - Project identifier
 * @returns Formatted context string, or empty string if no memories found
 */
export async function buildQaSessionContext(
  specDescription: string,
  relevantModules: string[],
  memoryService: MemoryService,
  projectId: string,
): Promise<string> {
  try {
    const [e2eObservations, errorPatterns, requirements, recipes] = await Promise.all([
      memoryService.search({
        types: ['e2e_observation'],
        relatedModules: relevantModules,
        limit: 8,
        sort: 'recency',
        projectId,
      }),
      memoryService.search({
        types: ['error_pattern'],
        relatedModules: relevantModules,
        limit: 6,
        minConfidence: 0.6,
        projectId,
      }),
      memoryService.search({
        types: ['requirement'],
        relatedModules: relevantModules,
        limit: 5,
        projectId,
      }),
      memoryService.searchWorkflowRecipe(specDescription, { limit: 1 }),
    ]);

    return formatQaSections({ e2eObservations, errorPatterns, requirements, recipes });
  } catch {
    return '';
  }
}

// ============================================================
// PRIVATE FORMATTING
// ============================================================

interface QaSections {
  e2eObservations: Memory[];
  errorPatterns: Memory[];
  requirements: Memory[];
  recipes: Memory[];
}

function formatQaSections(sections: QaSections): string {
  const parts: string[] = [];

  if (sections.requirements.length > 0) {
    const items = sections.requirements.map((m) => `- ${m.content}`).join('\n');
    parts.push(`KNOWN REQUIREMENTS — Constraints to validate against:\n${items}`);
  }

  if (sections.errorPatterns.length > 0) {
    const items = sections.errorPatterns
      .map((m) => {
        const fileRef =
          m.relatedFiles.length > 0
            ? ` [${m.relatedFiles.map((f) => f.split('/').pop()).join(', ')}]`
            : '';
        return `- ${m.content}${fileRef}`;
      })
      .join('\n');
    parts.push(`ERROR PATTERNS — Known failure modes to check for:\n${items}`);
  }

  if (sections.e2eObservations.length > 0) {
    const items = sections.e2eObservations.map((m) => `- ${m.content}`).join('\n');
    parts.push(`E2E OBSERVATIONS — Historical test behavior to verify:\n${items}`);
  }

  if (sections.recipes.length > 0) {
    const items = sections.recipes.map((m) => `- ${m.content}`).join('\n');
    parts.push(`VALIDATION WORKFLOW — Proven QA approach:\n${items}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `=== MEMORY CONTEXT FOR QA ===\n${parts.join('\n\n')}\n=== END MEMORY CONTEXT ===`;
}
