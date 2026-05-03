/**
 * Shell Interpreter Validators
 * =============================
 *
 * Validators for shell interpreter commands (bash, sh, zsh) that execute
 * inline commands via the -c flag.
 *
 * This closes a security bypass where `bash -c "sudo ..."` could execute
 * commands that are in the denylist. Under the denylist model the validator
 * checks commands inside -c against BLOCKED_COMMANDS (via isCommandBlocked)
 * rather than an allowlist profile.
 */

import type { ValidationResult } from '../denylist';
import { isCommandBlocked } from '../denylist';
import {
  crossPlatformBasename,
  extractCommands,
  splitCommandSegments,
} from '../command-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shell interpreters that can execute nested commands */
const SHELL_INTERPRETERS = new Set(['bash', 'sh', 'zsh']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shellSplit(input: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      else current += ch;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (ch === '"') { inDouble = true; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.length > 0) { tokens.push(current); current = ''; }
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (inSingle || inDouble) return null;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Extract the command string from a shell -c invocation.
 *
 * Handles various formats:
 * - bash -c 'command'
 * - bash -c "command"
 * - sh -c 'cmd1 && cmd2'
 * - zsh -c "complex command"
 * - Combined flags: -xc, -ec, -ic, etc.
 *
 * Returns null if not a -c invocation.
 */
/** Sentinel to distinguish "shellSplit parse failure" from "no -c flag found" */
const PARSE_FAILURE = Symbol('PARSE_FAILURE');

function extractCArgument(commandString: string): string | null | typeof PARSE_FAILURE {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return PARSE_FAILURE;
  }
  if (tokens.length < 3) {
    return null;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Check for standalone -c or combined flags containing 'c' (e.g., -xc, -ec)
    const isCFlag =
      token === '-c' ||
      (token.startsWith('-') &&
        !token.startsWith('--') &&
        token.slice(1).includes('c'));

    if (isCFlag && i + 1 < tokens.length) {
      return tokens[i + 1];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main validator (shared by bash, sh, zsh)
// ---------------------------------------------------------------------------

/**
 * Validate commands inside bash/sh/zsh -c '...' strings.
 *
 * Under the denylist model: all commands inside -c are checked against
 * BLOCKED_COMMANDS. Anything not in the denylist is allowed.
 * This prevents using shell interpreters to run blocked commands
 * (e.g. `bash -c "sudo rm -rf /"`).
 */
export function validateShellCCommand(commandString: string): ValidationResult {
  const innerCommand = extractCArgument(commandString);

  if (innerCommand === PARSE_FAILURE) {
    // shellSplit failed — deny to avoid permissive fallback on malformed input
    return [false, 'Could not parse shell command'];
  }

  if (innerCommand === null) {
    // Not a -c invocation — block dangerous shell constructs
    const dangerousPatterns = ['<(', '>('];
    for (const pattern of dangerousPatterns) {
      if (commandString.includes(pattern)) {
        return [
          false,
          `Process substitution '${pattern}' not allowed in shell commands`,
        ];
      }
    }
    // Allow simple shell invocations (e.g., "bash script.sh")
    return [true, ''];
  }

  // Extract command names from the -c string
  const innerCommandNames = extractCommands(innerCommand);

  if (innerCommandNames.length === 0) {
    // Could not parse — be permissive for empty commands
    if (!innerCommand.trim()) {
      return [true, ''];
    }
    return [
      false,
      `Could not parse commands inside shell -c: ${innerCommand}`,
    ];
  }

  // Check each command name against the denylist
  for (const cmdName of innerCommandNames) {
    const [notBlocked, blockReason] = isCommandBlocked(cmdName);
    if (!notBlocked) {
      return [
        false,
        `Command '${cmdName}' inside shell -c is blocked: ${blockReason}`,
      ];
    }
  }

  // Recursively validate nested shell invocations (e.g., bash -c "sh -c '...'")
  const innerSegments = splitCommandSegments(innerCommand);
  for (const segment of innerSegments) {
    const segmentCommands = extractCommands(segment);
    if (segmentCommands.length > 0) {
      const firstCmd = segmentCommands[0];
      const baseCmd = crossPlatformBasename(firstCmd);
      if (SHELL_INTERPRETERS.has(baseCmd)) {
        const [valid, err] = validateShellCCommand(segment);
        if (!valid) {
          return [false, `Nested shell command not allowed: ${err}`];
        }
      }
    }
  }

  return [true, ''];
}

// ---------------------------------------------------------------------------
// Aliases (all use same validation)
// ---------------------------------------------------------------------------

/** Validate bash -c '...' commands */
export const validateBashSubshell = validateShellCCommand;

/** Validate sh -c '...' commands */
export const validateShSubshell = validateShellCCommand;

/** Validate zsh -c '...' commands */
export const validateZshSubshell = validateShellCCommand;
