/**
 * Planner Memory Context Builder
 *
 * Builds a formatted memory context block to inject into planner agent sessions
 * before they start, drawing from historical calibrations, dead-ends, causal
 * dependencies, outcomes, and workflow recipes.
 */

import type { Memory, MemoryService } from '../types';

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build a formatted memory context string for a planner agent session.
 *
 * @param taskDescription - The high-level task description (used to match workflow recipes)
 * @param relevantModules - Module names relevant to the current task
 * @param memoryService - Memory service instance
 * @param projectId - Project identifier
 * @returns Formatted context string, or empty string if no memories found
 */
export async function buildPlannerMemoryContext(
  taskDescription: string,
  relevantModules: string[],
  memoryService: MemoryService,
  projectId: string,
): Promise<string> {
  try {
    const [calibrations, deadEnds, causalDeps, outcomes, recipes] = await Promise.all([
      memoryService.search({
        types: ['task_calibration'],
        relatedModules: relevantModules,
        limit: 5,
        projectId,
      }),
      memoryService.search({
        types: ['dead_end'],
        relatedModules: relevantModules,
        limit: 8,
        projectId,
      }),
      memoryService.search({
        types: ['causal_dependency'],
        relatedModules: relevantModules,
        limit: 10,
        projectId,
      }),
      memoryService.search({
        types: ['work_unit_outcome'],
        relatedModules: relevantModules,
        limit: 5,
        sort: 'recency',
        projectId,
      }),
      memoryService.searchWorkflowRecipe(taskDescription, { limit: 2 }),
    ]);

    return formatPlannerSections({ calibrations, deadEnds, causalDeps, outcomes, recipes });
  } catch {
    // Gracefully return empty string on any failure
    return '';
  }
}

// ============================================================
// PRIVATE FORMATTING
// ============================================================

interface PlannerSections {
  calibrations: Memory[];
  deadEnds: Memory[];
  causalDeps: Memory[];
  outcomes: Memory[];
  recipes: Memory[];
}

function formatPlannerSections(sections: PlannerSections): string {
  const parts: string[] = [];

  if (sections.recipes.length > 0) {
    const items = sections.recipes.map((m) => `- ${m.content}`).join('\n');
    parts.push(`WORKFLOW RECIPES — Proven approaches for similar tasks:\n${items}`);
  }

  if (sections.calibrations.length > 0) {
    const items = sections.calibrations
      .map((m) => {
        try {
          const data = JSON.parse(m.content) as { ratio?: number; module?: string };
          const ratio = data.ratio != null ? ` (step ratio: ${data.ratio.toFixed(2)}x)` : '';
          return `- ${data.module ?? m.content}${ratio}`;
        } catch {
          return `- ${m.content}`;
        }
      })
      .join('\n');
    parts.push(`TASK CALIBRATIONS — Historical step count data:\n${items}`);
  }

  if (sections.deadEnds.length > 0) {
    const items = sections.deadEnds.map((m) => `- ${m.content}`).join('\n');
    parts.push(`DEAD ENDS — Approaches that have failed before:\n${items}`);
  }

  if (sections.causalDeps.length > 0) {
    const items = sections.causalDeps.map((m) => `- ${m.content}`).join('\n');
    parts.push(`CAUSAL DEPENDENCIES — Known ordering constraints:\n${items}`);
  }

  if (sections.outcomes.length > 0) {
    const items = sections.outcomes.map((m) => `- ${m.content}`).join('\n');
    parts.push(`RECENT OUTCOMES — What happened in similar past work:\n${items}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `=== MEMORY CONTEXT FOR PLANNER ===\n${parts.join('\n\n')}\n=== END MEMORY CONTEXT ===`;
}
