/**
 * Impact Analyzer
 *
 * Agent tool for "what breaks if I change X?" analysis.
 * Uses the closure table for O(1) impact analysis.
 *
 * Usage:
 *   const result = await analyzeImpact('auth/tokens.ts:verifyJwt', projectId, graphDb);
 */

import type { GraphDatabase } from './graph-database';
import type { ImpactResult } from '../types';

export type { ImpactResult };

/**
 * Analyze the impact of changing a target symbol.
 *
 * @param target - Symbol to analyze. Can be:
 *   - "auth/tokens.ts:verifyJwt" (file:symbol format)
 *   - "verifyJwt" (symbol only — searches by label suffix)
 *   - "auth/tokens.ts" (file only — finds the file node)
 * @param projectId - Project ID
 * @param graphDb - GraphDatabase instance
 * @param maxDepth - Maximum transitive dependency depth (default: 3, cap: 5)
 */
export async function analyzeImpact(
  target: string,
  projectId: string,
  graphDb: GraphDatabase,
  maxDepth: number = 3,
): Promise<ImpactResult> {
  const cappedDepth = Math.min(maxDepth, 5);
  return graphDb.analyzeImpact(target, projectId, cappedDepth);
}

/**
 * Format impact result as a human-readable string for agent injection.
 */
export function formatImpactResult(result: ImpactResult): string {
  if (!result.target.nodeId) {
    return `No node found for target: "${result.target.label}"`;
  }

  const lines: string[] = [
    `Impact Analysis: ${result.target.label}`,
    `File: ${result.target.filePath || '(external)'}`,
    '',
  ];

  if (result.directDependents.length > 0) {
    lines.push(`Direct dependents (${result.directDependents.length}):`);
    for (const dep of result.directDependents) {
      lines.push(`  - ${dep.label} [${dep.edgeType}] in ${dep.filePath}`);
    }
    lines.push('');
  }

  if (result.transitiveDependents.length > 0) {
    lines.push(`Transitive dependents (${result.transitiveDependents.length}):`);
    for (const dep of result.transitiveDependents.slice(0, 20)) {
      lines.push(`  - [depth=${dep.depth}] ${dep.label} in ${dep.filePath}`);
    }
    if (result.transitiveDependents.length > 20) {
      lines.push(`  ... and ${result.transitiveDependents.length - 20} more`);
    }
    lines.push('');
  }

  if (result.affectedTests.length > 0) {
    lines.push(`Affected test files (${result.affectedTests.length}):`);
    for (const test of result.affectedTests) {
      lines.push(`  - ${test.filePath}`);
    }
    lines.push('');
  }

  if (result.affectedMemories.length > 0) {
    lines.push(`Related memories (${result.affectedMemories.length}):`);
    for (const mem of result.affectedMemories) {
      lines.push(`  - [${mem.type}] ${mem.content.slice(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
    }
  }

  if (
    result.directDependents.length === 0 &&
    result.transitiveDependents.length === 0 &&
    result.affectedTests.length === 0
  ) {
    lines.push('No dependents found. This symbol appears to be a leaf node.');
  }

  return lines.join('\n');
}
