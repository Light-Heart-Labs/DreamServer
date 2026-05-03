/**
 * Code Search Functionality
 *
 * Searches the codebase for relevant files based on keywords.
 * See apps/desktop/src/main/ai/context/search.ts for the TypeScript implementation.
 * Uses Node.js fs — no AI SDK dependency.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { FileMatch } from './types.js';

/** Directories that should never be searched. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.next', '.nuxt', 'target', 'vendor', '.idea', '.vscode', 'auto-claude',
  '.auto-claude', '.pytest_cache', '.mypy_cache', 'coverage', '.turbo', '.cache',
  'out',
]);

/** File extensions considered code files. */
const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.go', '.rs', '.rb', '.php',
]);

/** Recursively yield all code file paths under a directory. */
function* iterCodeFiles(directory: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* iterCodeFiles(fullPath);
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

/**
 * Search a directory for files that match any of the given keywords.
 *
 * @param serviceDir   Absolute path to the directory to search.
 * @param serviceName  Label used in returned FileMatch objects.
 * @param keywords     Keywords to look for inside file content.
 * @param projectDir   Project root used to compute relative paths.
 * @returns Up to 20 matches, sorted by descending relevance score.
 */
export function searchService(
  serviceDir: string,
  serviceName: string,
  keywords: string[],
  projectDir: string,
): FileMatch[] {
  const matches: FileMatch[] = [];

  if (!fs.existsSync(serviceDir)) return matches;

  for (const filePath of iterCodeFiles(serviceDir)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const contentLower = content.toLowerCase();
    let score = 0;
    const matchingKeywords: string[] = [];
    const matchingLines: Array<[number, string]> = [];

    for (const keyword of keywords) {
      if (!contentLower.includes(keyword)) continue;

      // Count occurrences, capped at 10 per keyword
      let count = 0;
      let idx = 0;
      while ((idx = contentLower.indexOf(keyword, idx)) !== -1) {
        count++;
        idx += keyword.length;
      }
      score += Math.min(count, 10);
      matchingKeywords.push(keyword);

      // Collect up to 3 matching lines per keyword
      const lines = content.split('\n');
      let found = 0;
      for (let i = 0; i < lines.length && found < 3; i++) {
        if (lines[i].toLowerCase().includes(keyword)) {
          matchingLines.push([i + 1, lines[i].trim().slice(0, 100)]);
          found++;
        }
      }
    }

    if (score > 0) {
      const relPath = path.relative(projectDir, filePath);
      matches.push({
        path: relPath,
        service: serviceName,
        reason: `Contains: ${matchingKeywords.join(', ')}`,
        relevanceScore: score,
        matchingLines: matchingLines.slice(0, 5),
      });
    }
  }

  matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return matches.slice(0, 20);
}
