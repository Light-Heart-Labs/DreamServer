/**
 * Grep Search Tool
 * ================
 *
 * Ripgrep-style content search tool.
 * Supports regex patterns, file type/glob filtering, and multiple output modes.
 * Integrates with path-containment security.
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { findExecutable } from '../../../platform/index';
import { assertPathContained } from '../../security/path-containment';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT_MODE = 'files_with_matches';
const MAX_OUTPUT_LENGTH = 30_000;

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  pattern: z
    .string()
    .describe('The regular expression pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .describe('File or directory to search in. Defaults to current working directory.'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe(
      'Output mode: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts.',
    ),
  context: z
    .number()
    .optional()
    .describe('Number of lines to show before and after each match (rg -C). Requires output_mode: "content".'),
  type: z
    .string()
    .optional()
    .describe('File type to search (rg --type). Common types: js, py, rust, go, java, etc.'),
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") — maps to rg --glob'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRgArgs(
  input: z.infer<typeof inputSchema>,
  searchPath: string,
): string[] {
  const args: string[] = [];

  const mode = input.output_mode ?? DEFAULT_OUTPUT_MODE;

  switch (mode) {
    case 'files_with_matches':
      args.push('--files-with-matches');
      break;
    case 'count':
      args.push('--count');
      break;
    case 'content':
      args.push('--line-number');
      if (input.context !== undefined) {
        args.push('-C', String(input.context));
      }
      break;
  }

  if (input.type) {
    args.push('--type', input.type);
  }

  if (input.glob) {
    args.push('--glob', input.glob);
  }

  // Always add these defaults
  args.push('--no-heading', '--color', 'never');

  args.push(input.pattern, searchPath);

  return args;
}

function runRipgrep(
  args: string[],
  cwd: string,
  abortSignal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const rgPath = findExecutable('rg');
  if (!rgPath) {
    return Promise.resolve({
      stdout: '',
      stderr: 'ripgrep (rg) not found. Please install ripgrep: https://github.com/BurntSushi/ripgrep',
      exitCode: 127,
    });
  }

  return new Promise((resolve) => {
    execFile(
      rgPath,
      args,
      {
        cwd,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        signal: abortSignal,
      },
      (error, stdout, stderr) => {
        const exitCode = error
          ? ('code' in error && typeof error.code === 'number'
              ? error.code
              : 1)
          : 0;
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          exitCode,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const grepTool = Tool.define({
  metadata: {
    name: 'Grep',
    description:
      'A powerful search tool built on ripgrep. Supports full regex syntax, file type/glob filtering, and multiple output modes (content, files_with_matches, count).',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context) => {
    const searchPath = input.path ?? context.cwd;

    // Security: ensure search path is within project boundary
    assertPathContained(searchPath, context.projectDir);

    const resolvedPath = path.isAbsolute(searchPath)
      ? searchPath
      : path.resolve(context.projectDir, searchPath);

    const args = buildRgArgs(input, resolvedPath);
    const { stdout, stderr, exitCode } = await runRipgrep(
      args,
      context.cwd,
      context.abortSignal,
    );

    // Exit code 1 means no matches (not an error for rg)
    if (exitCode === 1 && !stderr) {
      return 'No matches found';
    }

    if (exitCode > 1 && stderr) {
      return `Error: ${stderr.trim()}`;
    }

    if (!stdout.trim()) {
      return 'No matches found';
    }

    if (stdout.length > MAX_OUTPUT_LENGTH) {
      return `${stdout.slice(0, MAX_OUTPUT_LENGTH)}\n\n[Output truncated — ${stdout.length} characters total]`;
    }

    return stdout.trimEnd();
  },
});
