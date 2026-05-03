/**
 * Write File Tool
 * ===============
 *
 * Writes content to a file on the local filesystem.
 * Creates parent directories if needed.
 * Integrates with path-containment security.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { assertPathContained } from '../../security/path-containment';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z
    .string()
    .describe('The absolute path to the file to write (must be absolute, not relative)'),
  content: z.string().describe('The content to write to the file'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const writeTool = Tool.define({
  metadata: {
    name: 'Write',
    description:
      'Writes a file to the local filesystem. This tool will overwrite the existing file if there is one at the provided path. ALWAYS prefer editing existing files with the Edit tool. NEVER write new files unless explicitly required.',
    permission: ToolPermission.RequiresApproval,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context) => {
    const { file_path, content } = input;

    // Security: ensure path is within project boundary
    const { resolvedPath } = assertPathContained(file_path, context.projectDir);

    // Ensure parent directory exists
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Write the file
    fs.writeFileSync(resolvedPath, content, 'utf-8');

    const lineCount = content.split(/\r?\n/).length;
    return `Successfully wrote ${lineCount} lines to ${file_path}`;
  },
});
