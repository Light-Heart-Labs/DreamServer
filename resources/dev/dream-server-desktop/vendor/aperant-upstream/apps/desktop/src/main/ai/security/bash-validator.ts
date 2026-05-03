/**
 * Bash Security Validator
 * =======================
 *
 * Pre-tool-use hook that validates bash commands for security.
 * Main enforcement point for the security system.
 *
 * Security model: DENYLIST-based (allow-by-default)
 * - All commands are allowed unless explicitly blocked
 * - A static set of truly dangerous commands (BLOCKED_COMMANDS) is always denied
 * - Per-command validators run for known sensitive commands to validate
 *   dangerous usage patterns within otherwise-allowed commands
 *
 * Flow:
 *   Command comes in →
 *     1. Is command name in BLOCKED_COMMANDS? → DENY with reason
 *     2. Does command have a validator in VALIDATORS? → Run validator → DENY or ALLOW
 *     3. Otherwise → ALLOW
 */

import {
  extractCommands,
  getCommandForValidation,
  splitCommandSegments,
} from './command-parser';
import { BLOCKED_COMMANDS, isCommandBlocked } from './denylist';
import { validateRmCommand, validateChmodCommand } from './validators/filesystem-validators';
import { validateGitCommand } from './validators/git-validators';
import { validatePkillCommand, validateKillCommand, validateKillallCommand } from './validators/process-validators';
import { validateShellCCommand } from './validators/shell-validators';
import {
  validatePsqlCommand,
  validateMysqlCommand,
  validateMysqladminCommand,
  validateRedisCliCommand,
  validateMongoshCommand,
  validateDropdbCommand,
  validateDropuserCommand,
} from './validators/database-validators';

// Re-export for consumers that import these from bash-validator
export { BLOCKED_COMMANDS, isCommandBlocked };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Validation result: [isAllowed, reason] */
export type ValidationResult = [boolean, string];

/** A validator function that checks a command segment */
export type ValidatorFunction = (commandSegment: string) => ValidationResult;

/**
 * Security profile interface — kept for backward compatibility with consumers
 * (agent-manager.ts, worker.ts, runners, etc.) that still serialize/pass
 * profiles. The denylist model no longer uses the profile's command sets for
 * allow/deny decisions, but the type is retained so existing callers compile.
 */
export interface SecurityProfile {
  baseCommands: Set<string>;
  stackCommands: Set<string>;
  scriptCommands: Set<string>;
  customCommands: Set<string>;
  customScripts: {
    shellScripts: string[];
  };
  getAllAllowedCommands(): Set<string>;
}

/** Hook input data shape (matches Vercel AI SDK tool call metadata) */
export interface HookInputData {
  toolName?: string;
  toolInput?: Record<string, unknown> | null;
  cwd?: string;
}

/** Hook deny result */
interface HookDenyResult {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

/** Hook result — empty object means allow */
type HookResult = Record<string, never> | HookDenyResult;

// ---------------------------------------------------------------------------
// Validators registry
// ---------------------------------------------------------------------------

/**
 * Central map of command names → validator functions.
 *
 * These validators run AFTER the denylist check and examine dangerous usage
 * patterns within otherwise-permitted commands (e.g. `rm /` or
 * `git config user.email`).
 */
export const VALIDATORS: Record<string, ValidatorFunction> = {
  // Filesystem
  rm: validateRmCommand,
  chmod: validateChmodCommand,

  // Git
  git: validateGitCommand,

  // Process management
  pkill: validatePkillCommand,
  kill: validateKillCommand,
  killall: validateKillallCommand,

  // Shell interpreters — validate commands inside -c strings
  bash: validateShellCCommand,
  sh: validateShellCCommand,
  zsh: validateShellCCommand,

  // Databases
  psql: validatePsqlCommand,
  mysql: validateMysqlCommand,
  mysqladmin: validateMysqladminCommand,
  'redis-cli': validateRedisCliCommand,
  mongosh: validateMongoshCommand,
  mongo: validateMongoshCommand,
  dropdb: validateDropdbCommand,
  dropuser: validateDropuserCommand,
};

/**
 * Get the validator function for a given command name.
 */
export function getValidator(
  commandName: string,
): ValidatorFunction | undefined {
  return VALIDATORS[commandName];
}

// ---------------------------------------------------------------------------
// Backward-compat shim
// ---------------------------------------------------------------------------

/**
 * @deprecated Use isCommandBlocked() instead. Kept for backward compatibility
 * with any external tooling that still calls isCommandAllowed().
 *
 * In the new denylist model the profile argument is ignored.
 * Returns [true, ''] when the command is allowed (not in denylist).
 * Returns [false, reason] when the command is in the denylist.
 */
export function isCommandAllowed(
  command: string,
  _profile?: SecurityProfile,
): ValidationResult {
  return isCommandBlocked(command);
}

// ---------------------------------------------------------------------------
// Main security hook
// ---------------------------------------------------------------------------

/**
 * Pre-tool-use hook that validates bash commands using a denylist model.
 *
 * The `profile` parameter is accepted for backward compatibility with callers
 * that still pass a SecurityProfile but is no longer used for allow/deny
 * decisions.
 */
export function bashSecurityHook(
  inputData: HookInputData,
  _profile?: SecurityProfile,
): HookResult {
  if (inputData.toolName !== 'Bash') {
    return {} as Record<string, never>;
  }

  // Validate tool_input structure
  const toolInput = inputData.toolInput;

  if (toolInput === null || toolInput === undefined) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Bash tool_input is null/undefined - malformed tool call',
      },
    };
  }

  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Bash tool_input must be an object, got ${typeof toolInput}`,
      },
    };
  }

  const command =
    typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command) {
    return {} as Record<string, never>;
  }

  // Extract all commands from the command string
  const commands = extractCommands(command);

  if (commands.length === 0) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Could not parse command for security validation: ${command}`,
      },
    };
  }

  // Split into segments for per-command validation
  const segments = splitCommandSegments(command);

  for (const cmd of commands) {
    // Step 1: Check static denylist
    const [notBlocked, blockReason] = isCommandBlocked(cmd);

    if (!notBlocked) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: blockReason,
        },
      };
    }

    // Step 2: Run per-command validator if one exists
    const validator = VALIDATORS[cmd];
    if (validator) {
      const cmdSegment = getCommandForValidation(cmd, segments) ?? command;
      const [validatorAllowed, validatorReason] = validator(cmdSegment);

      if (!validatorAllowed) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: validatorReason,
          },
        };
      }
    }

    // Step 3: Otherwise allow
  }

  return {} as Record<string, never>;
}

// ---------------------------------------------------------------------------
// Testing / debugging helper
// ---------------------------------------------------------------------------

/**
 * Validate a command string (for testing/debugging).
 *
 * In the new denylist model the profile argument is ignored.
 */
export function validateCommand(
  command: string,
  _profile?: SecurityProfile,
): ValidationResult {
  const commands = extractCommands(command);

  if (commands.length === 0) {
    return [false, 'Could not parse command'];
  }

  const segments = splitCommandSegments(command);

  for (const cmd of commands) {
    // Check denylist
    const [notBlocked, blockReason] = isCommandBlocked(cmd);
    if (!notBlocked) {
      return [false, blockReason];
    }

    // Run per-command validator
    const validator = VALIDATORS[cmd];
    if (validator) {
      const cmdSegment = getCommandForValidation(cmd, segments) ?? command;
      const [validatorAllowed, validatorReason] = validator(cmdSegment);
      if (!validatorAllowed) {
        return [false, validatorReason];
      }
    }
  }

  return [true, ''];
}
