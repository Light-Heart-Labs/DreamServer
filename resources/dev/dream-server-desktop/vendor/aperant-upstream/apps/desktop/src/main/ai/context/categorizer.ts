/**
 * File Categorization
 *
 * Categorizes matched files into those to modify vs those to reference.
 * See apps/desktop/src/main/ai/context/categorizer.ts for the TypeScript implementation.
 */

import type { FileMatch } from './types.js';

/** Keywords in the task description that indicate the agent will modify files. */
const MODIFY_KEYWORDS = [
  'add', 'create', 'implement', 'fix', 'update', 'change', 'modify', 'new',
];

export interface CategorizedFiles {
  toModify: FileMatch[];
  toReference: FileMatch[];
}

/**
 * Split matches into files the agent will likely modify vs reference.
 *
 * @param matches    All file matches from search.
 * @param task       Task description (used to decide modify vs reference intent).
 * @param maxModify  Cap on number of modify files returned.
 * @param maxRef     Cap on number of reference files returned.
 */
export function categorizeMatches(
  matches: FileMatch[],
  task: string,
  maxModify = 10,
  maxRef = 15,
): CategorizedFiles {
  const taskLower = task.toLowerCase();
  const isModification = MODIFY_KEYWORDS.some(kw => taskLower.includes(kw));

  const toModify: FileMatch[] = [];
  const toReference: FileMatch[] = [];

  for (const match of matches) {
    const pathLower = match.path.toLowerCase();
    const isTest = pathLower.includes('test') || pathLower.includes('spec');
    const isExample = pathLower.includes('example') || pathLower.includes('sample');
    const isConfig = pathLower.includes('config') && match.relevanceScore < 5;

    if (isTest || isExample || isConfig) {
      toReference.push({ ...match, reason: `Reference pattern: ${match.reason}` });
    } else if (match.relevanceScore >= 5 && isModification) {
      toModify.push({ ...match, reason: `Likely to modify: ${match.reason}` });
    } else {
      toReference.push({ ...match, reason: `Related: ${match.reason}` });
    }
  }

  return {
    toModify: toModify.slice(0, maxModify),
    toReference: toReference.slice(0, maxRef),
  };
}
