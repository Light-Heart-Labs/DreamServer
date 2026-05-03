/**
 * Glob File Search Tool
 * =====================
 *
 * Fast file pattern matching tool using glob patterns.
 * Returns matching file paths sorted by modification time.
 * Integrates with path-containment security.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { assertPathContained } from '../../security/path-containment';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';
import { truncateToolOutput } from '../truncation';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe(
      'The directory to search in. If not specified, the current working directory will be used.',
    ),
});

/** Maximum number of file results to return before truncation */
const MAX_RESULTS = 2000;

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const globTool = Tool.define({
  metadata: {
    name: 'Glob',
    description:
      'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context) => {
    const searchDir = input.path ?? context.cwd;

    // Security: ensure search directory is within project boundary
    assertPathContained(searchDir, context.projectDir);

    // Resolve the search directory
    const resolvedDir = path.isAbsolute(searchDir)
      ? searchDir
      : path.resolve(context.projectDir, searchDir);

    if (!fs.existsSync(resolvedDir)) {
      return `Error: Directory not found: ${searchDir}`;
    }

    // Use Node.js built-in fs.globSync (available in Node 22+)
    const matches = fs.globSync(input.pattern, {
      cwd: resolvedDir,
      exclude: (fileName: string) => {
        return fileName === 'node_modules' || fileName === '.git';
      },
    });

    // Convert to absolute paths and filter out directories
    const absolutePaths: string[] = [];
    for (const match of matches) {
      const absPath = path.isAbsolute(match)
        ? match
        : path.resolve(resolvedDir, match);
      try {
        const stat = fs.statSync(absPath);
        if (stat.isFile()) {
          absolutePaths.push(absPath);
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    if (absolutePaths.length === 0) {
      return 'No files found';
    }

    // Sort by modification time (most recently modified first)
    const withMtime = absolutePaths.map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return { filePath, mtime: stat.mtimeMs };
      } catch {
        return { filePath, mtime: 0 };
      }
    });

    withMtime.sort((a, b) => b.mtime - a.mtime);

    // Cap results to prevent massive context window consumption
    const totalMatches = withMtime.length;
    const capped = totalMatches > MAX_RESULTS ? withMtime.slice(0, MAX_RESULTS) : withMtime;
    let output = capped.map((entry) => entry.filePath).join('\n');

    if (totalMatches > MAX_RESULTS) {
      output += `\n\n[Showing ${MAX_RESULTS} of ${totalMatches} matches. Narrow your glob pattern for more specific results.]`;
    }

    // Apply disk-spillover truncation for very large outputs
    const result = truncateToolOutput(output, 'Glob', context.projectDir);
    return result.content;
  },
});
