/**
 * Command Parsing Utilities
 *
 * Functions for parsing and extracting commands from shell command strings.
 * Handles compound commands, pipes, subshells, and various shell constructs.
 *
 * Windows Compatibility Note:
 * Commands containing paths with backslashes can cause shlex-style splitting
 * to fail (e.g., incomplete commands with unclosed quotes). This module includes
 * a fallback parser that extracts command names even from malformed commands,
 * ensuring security validation can still proceed.
 */

import * as path from 'node:path';

const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
]);

const SHELL_OPERATORS = new Set(['|', '||', '&&', '&']);

const SHELL_STRUCTURE_TOKENS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  '!',
  '{',
  '}',
  '(',
  ')',
  'function',
]);

const REDIRECT_TOKENS = new Set(['<<', '<<<', '>>', '>', '<', '2>', '2>&1', '&>']);

/**
 * Extract the basename from a path in a cross-platform way.
 *
 * Handles both Windows paths (C:\dir\cmd.exe) and POSIX paths (/dir/cmd)
 * regardless of the current platform.
 */
export function crossPlatformBasename(filePath: string): string {
  // Strip surrounding quotes if present
  filePath = filePath.replace(/^['"]|['"]$/g, '');

  // Check if this looks like a Windows path (contains backslash or drive letter)
  if (filePath.includes('\\') || (filePath.length >= 2 && filePath[1] === ':')) {
    // Use path.win32.basename for Windows paths on any platform
    return path.win32.basename(filePath);
  }

  // For POSIX paths or simple command names
  return path.posix.basename(filePath);
}

/**
 * Check if a command string contains Windows-style paths.
 *
 * Windows paths with backslashes cause issues with shlex-style splitting because
 * backslashes are interpreted as escape characters in POSIX mode.
 */
export function containsWindowsPath(commandString: string): boolean {
  // Pattern matches:
  // - Drive letter paths: C:\, D:\, etc.
  // - Backslash followed by a path component (2+ chars to avoid escape sequences like \n, \t)
  return /[A-Za-z]:\\|\\[A-Za-z][A-Za-z0-9_\\/]/.test(commandString);
}

/**
 * shlex-style split for shell command strings.
 *
 * Splits a command string respecting single/double quotes and escape characters.
 * Throws on unclosed quotes (similar to Python's shlex.split).
 */
function shlexSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < input.length) {
        const next = input[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          current += next;
          i += 2;
          continue;
        }
        current += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    // Not inside quotes
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (inSingle || inDouble) {
    throw new Error('Unclosed quote');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Fallback command extraction when shlexSplit fails.
 *
 * Uses regex to extract command names from potentially malformed commands.
 * More permissive than shlex but ensures we can identify commands for security validation.
 */
function fallbackExtractCommands(commandString: string): string[] {
  const commands: string[] = [];

  // Split by common shell operators
  const parts = commandString.split(/\s*(?:&&|\|\||\|)\s*|;\s*/);

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    // Skip variable assignments at the start (VAR=value cmd)
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(part)) {
      part = part.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
    }

    if (!part) continue;

    // Extract first token, handling quoted strings with spaces
    const firstTokenMatch = part.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
    if (!firstTokenMatch) continue;

    const firstToken = firstTokenMatch[1] ?? firstTokenMatch[2] ?? firstTokenMatch[3];
    if (!firstToken) continue;

    // Extract basename using cross-platform handler
    let cmd = crossPlatformBasename(firstToken);

    // Remove Windows extensions
    cmd = cmd.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '');

    // Clean up any remaining quotes or special chars at the start
    cmd = cmd.replace(/^["'\\/]+/, '');

    // Skip tokens that look like function calls or code fragments
    if (cmd.includes('(') || cmd.includes(')') || cmd.includes('.')) {
      continue;
    }

    if (cmd && !SHELL_KEYWORDS.has(cmd.toLowerCase())) {
      commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Split a compound command into individual command segments.
 *
 * Handles command chaining (&&, ||, ;) but not pipes (those are single commands).
 */
export function splitCommandSegments(commandString: string): string[] {
  // Split on && and ||
  const segments = commandString.split(/\s*(?:&&|\|\|)\s*/);

  // Further split on semicolons not inside quotes
  const result: string[] = [];
  for (const segment of segments) {
    const subSegments = segment.split(/(?<!["'])\s*;\s*(?!["'])/);
    for (const sub of subSegments) {
      const trimmed = sub.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Extract command names from a shell command string.
 *
 * Handles pipes, command chaining (&&, ||, ;), and subshells.
 * Returns the base command names (without paths).
 *
 * On Windows or when commands contain malformed quoting, falls back to
 * regex-based extraction to ensure security validation can proceed.
 */
export function extractCommands(commandString: string): string[] {
  // If command contains Windows paths, use fallback parser directly
  // because shlex-style splitting interprets backslashes as escape characters
  if (containsWindowsPath(commandString)) {
    const fallbackCommands = fallbackExtractCommands(commandString);
    if (fallbackCommands.length > 0) {
      return fallbackCommands;
    }
    // Continue with shlex if fallback found nothing
  }

  const commands: string[] = [];

  // Split on semicolons that aren't inside quotes
  const segments = commandString.split(/(?<!["'])\s*;\s*(?!["'])/);

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    let tokens: string[];
    try {
      tokens = shlexSplit(segment);
    } catch {
      // Malformed command (unclosed quotes, etc.)
      // Use fallback parser instead of blocking
      const fallbackCommands = fallbackExtractCommands(commandString);
      if (fallbackCommands.length > 0) {
        return fallbackCommands;
      }
      return [];
    }

    if (tokens.length === 0) continue;

    // Track when we expect a command vs arguments
    let expectCommand = true;

    for (const token of tokens) {
      // Shell operators indicate a new command follows
      if (SHELL_OPERATORS.has(token)) {
        expectCommand = true;
        continue;
      }

      // Skip shell keywords/structure tokens
      if (SHELL_STRUCTURE_TOKENS.has(token)) {
        continue;
      }

      // Skip flags/options
      if (token.startsWith('-')) {
        continue;
      }

      // Skip variable assignments (VAR=value)
      if (token.includes('=') && !token.startsWith('=')) {
        continue;
      }

      // Skip redirect/here-doc markers
      if (REDIRECT_TOKENS.has(token)) {
        continue;
      }

      if (expectCommand) {
        // Extract the base command name (handle paths like /usr/bin/python)
        const cmd = crossPlatformBasename(token);
        commands.push(cmd);
        expectCommand = false;
      }
    }
  }

  return commands;
}

/**
 * Find the specific command segment that contains the given command.
 */
export function getCommandForValidation(cmd: string, segments: string[]): string {
  for (const segment of segments) {
    const segmentCommands = extractCommands(segment);
    if (segmentCommands.includes(cmd)) {
      return segment;
    }
  }
  return '';
}
