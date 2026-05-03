/**
 * Pattern Discovery
 *
 * Discovers code patterns from reference files to guide implementation.
 * See apps/desktop/src/main/ai/context/pattern-discovery.ts for the TypeScript implementation.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { FileMatch } from './types.js';

/**
 * Discover code snippets that demonstrate how a keyword is used in the project.
 *
 * For each keyword, the first occurrence found across the top `maxFiles`
 * reference files is extracted with ±3 lines of context.
 *
 * @param projectDir     Absolute path to the project root.
 * @param referenceFiles Reference FileMatch objects to analyze.
 * @param keywords       Keywords to search for within those files.
 * @param maxFiles       Maximum number of files to analyse.
 * @returns Map of `<keyword>_pattern` → code snippet string.
 */
export function discoverPatterns(
  projectDir: string,
  referenceFiles: FileMatch[],
  keywords: string[],
  maxFiles = 5,
): Record<string, string> {
  const patterns: Record<string, string> = {};

  for (const match of referenceFiles.slice(0, maxFiles)) {
    const filePath = path.join(projectDir, match.path);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const contentLower = content.toLowerCase();

    for (const keyword of keywords) {
      const patternKey = `${keyword}_pattern`;
      if (patternKey in patterns) continue;
      if (!contentLower.includes(keyword)) continue;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(keyword)) {
          const start = Math.max(0, i - 3);
          const end = Math.min(lines.length, i + 4);
          const snippet = lines.slice(start, end).join('\n');
          patterns[patternKey] = `From ${match.path}:\n${snippet.slice(0, 300)}`;
          break;
        }
      }
    }
  }

  return patterns;
}
