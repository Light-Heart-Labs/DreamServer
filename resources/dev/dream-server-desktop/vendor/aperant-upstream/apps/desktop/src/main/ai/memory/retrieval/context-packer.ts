/**
 * Phase-Aware Context Packer
 *
 * Packs retrieved memories into a formatted string respecting:
 *   - Per-phase token budgets
 *   - Per-type allocation ratios
 *   - MMR diversity filtering (skip near-duplicates with cosine > 0.85)
 *   - Citation chips: [^ Memory: citationText]
 */

import type { Memory, MemoryType, UniversalPhase } from '../types';

// ============================================================
// TYPES & CONFIG
// ============================================================

export interface ContextPackingConfig {
  totalBudget: number;
  allocation: Partial<Record<MemoryType, number>>;
}

export const DEFAULT_PACKING_CONFIG: Record<UniversalPhase, ContextPackingConfig> = {
  define: {
    totalBudget: 2500,
    allocation: {
      workflow_recipe: 0.30,
      requirement: 0.20,
      decision: 0.20,
      dead_end: 0.15,
      task_calibration: 0.10,
    },
  },
  implement: {
    totalBudget: 3000,
    allocation: {
      gotcha: 0.30,
      error_pattern: 0.25,
      causal_dependency: 0.15,
      pattern: 0.15,
      dead_end: 0.10,
    },
  },
  validate: {
    totalBudget: 2500,
    allocation: {
      error_pattern: 0.30,
      requirement: 0.25,
      e2e_observation: 0.25,
      work_unit_outcome: 0.15,
    },
  },
  refine: {
    totalBudget: 2000,
    allocation: {
      error_pattern: 0.35,
      gotcha: 0.25,
      dead_end: 0.20,
      pattern: 0.15,
    },
  },
  explore: {
    totalBudget: 2000,
    allocation: {
      module_insight: 0.40,
      decision: 0.25,
      pattern: 0.20,
      causal_dependency: 0.15,
    },
  },
  reflect: {
    totalBudget: 1500,
    allocation: {
      work_unit_outcome: 0.40,
      task_calibration: 0.35,
      dead_end: 0.15,
    },
  },
};

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Pack memories into a formatted context string respecting token budgets.
 *
 * @param memories - Retrieved and reranked memories (already in priority order)
 * @param phase - Current agent phase for budget/allocation selection
 * @param config - Override default config for testing
 */
export function packContext(
  memories: Memory[],
  phase: UniversalPhase,
  config?: ContextPackingConfig,
): string {
  const packingConfig = config ?? DEFAULT_PACKING_CONFIG[phase];
  const { totalBudget, allocation } = packingConfig;

  // Group memories by type
  const byType = groupByType(memories);

  // Compute per-type token budgets
  const typeBudgets = computeTypeBudgets(totalBudget, allocation);

  // Pack each type's memories within its budget
  const sections: string[] = [];
  let totalUsed = 0;

  for (const [memoryType, budget] of typeBudgets) {
    const typeMemories = byType.get(memoryType) ?? [];
    if (typeMemories.length === 0) continue;

    const remaining = totalBudget - totalUsed;
    const effectiveBudget = Math.min(budget, remaining);
    if (effectiveBudget <= 0) break;

    const { packed, tokensUsed } = packTypeMemories(
      typeMemories,
      effectiveBudget,
      memoryType,
    );

    if (packed.length > 0) {
      sections.push(...packed);
      totalUsed += tokensUsed;
    }

    if (totalUsed >= totalBudget) break;
  }

  // Include any memory types not in the allocation map (use remaining budget)
  const allocatedTypes = new Set(typeBudgets.keys());
  for (const [memoryType, typeMemories] of byType) {
    if (allocatedTypes.has(memoryType)) continue;

    const remaining = totalBudget - totalUsed;
    if (remaining <= 0) break;

    const { packed, tokensUsed } = packTypeMemories(
      typeMemories,
      remaining,
      memoryType,
    );

    if (packed.length > 0) {
      sections.push(...packed);
      totalUsed += tokensUsed;
    }
  }

  if (sections.length === 0) return '';

  return `## Relevant Context from Memory\n\n${sections.join('\n\n')}`;
}

// ============================================================
// PRIVATE HELPERS
// ============================================================

function groupByType(memories: Memory[]): Map<MemoryType, Memory[]> {
  const map = new Map<MemoryType, Memory[]>();
  for (const m of memories) {
    const group = map.get(m.type) ?? [];
    group.push(m);
    map.set(m.type, group);
  }
  return map;
}

function computeTypeBudgets(
  totalBudget: number,
  allocation: Partial<Record<MemoryType, number>>,
): Map<MemoryType, number> {
  const budgets = new Map<MemoryType, number>();
  for (const [type, ratio] of Object.entries(allocation) as [MemoryType, number][]) {
    budgets.set(type, Math.floor(totalBudget * ratio));
  }
  return budgets;
}

interface PackResult {
  packed: string[];
  tokensUsed: number;
}

function packTypeMemories(
  memories: Memory[],
  budget: number,
  memoryType: MemoryType,
): PackResult {
  const packed: string[] = [];
  let tokensUsed = 0;
  const included: string[] = []; // content strings for MMR dedup

  for (const memory of memories) {
    const formatted = formatMemory(memory, memoryType);
    const tokens = estimateTokens(formatted);

    if (tokensUsed + tokens > budget) break;

    // MMR diversity: skip if too similar to already-included memories
    if (isTooSimilar(memory.content, included)) continue;

    packed.push(formatted);
    included.push(memory.content);
    tokensUsed += tokens;
  }

  return { packed, tokensUsed };
}

function formatMemory(memory: Memory, memoryType: MemoryType): string {
  const typeLabel = formatTypeLabel(memoryType);
  const citation = memory.citationText
    ? `[^ Memory: ${memory.citationText}]`
    : '';

  const fileContext =
    memory.relatedFiles.length > 0
      ? ` (${memory.relatedFiles.slice(0, 2).join(', ')})`
      : '';

  const confidence =
    memory.confidence < 0.7 ? ` [confidence: ${(memory.confidence * 100).toFixed(0)}%]` : '';

  return [
    `**${typeLabel}**${fileContext}${confidence}`,
    memory.content,
    citation,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatTypeLabel(type: MemoryType): string {
  const labels: Record<MemoryType, string> = {
    gotcha: 'Gotcha',
    decision: 'Decision',
    preference: 'Preference',
    pattern: 'Pattern',
    requirement: 'Requirement',
    error_pattern: 'Error Pattern',
    module_insight: 'Module Insight',
    prefetch_pattern: 'Prefetch Pattern',
    work_state: 'Work State',
    causal_dependency: 'Causal Dependency',
    task_calibration: 'Task Calibration',
    e2e_observation: 'E2E Observation',
    dead_end: 'Dead End',
    work_unit_outcome: 'Work Unit Outcome',
    workflow_recipe: 'Workflow Recipe',
    context_cost: 'Context Cost',
  };
  return labels[type] ?? type;
}

/**
 * Check if new content is too similar to any already-included content.
 * Uses simple Jaccard similarity on word sets as a lightweight MMR proxy.
 * Threshold: 0.85 similarity triggers skip.
 */
function isTooSimilar(content: string, included: string[]): boolean {
  if (included.length === 0) return false;

  const newWords = new Set(tokenize(content));
  if (newWords.size === 0) return false;

  for (const existingContent of included) {
    const existingWords = new Set(tokenize(existingContent));
    const intersection = [...newWords].filter((w) => existingWords.has(w)).length;
    const union = new Set([...newWords, ...existingWords]).size;
    const jaccard = union === 0 ? 0 : intersection / union;

    if (jaccard > 0.85) return true;
  }

  return false;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
}

/**
 * Rough token estimation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
