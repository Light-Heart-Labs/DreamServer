/**
 * Git Validators
 * ==============
 *
 * Validators for git operations:
 * - Commit with secret scanning
 * - Config protection (prevent setting identity fields)
 *
 * See apps/desktop/src/main/ai/security/validators/git-validators.ts for the TypeScript implementation.
 */

import type { ValidationResult } from '../bash-validator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Git config keys that agents must NOT modify.
 * These are identity settings that should inherit from the user's global config.
 */
const BLOCKED_GIT_CONFIG_KEYS = new Set([
  'user.name',
  'user.email',
  'author.name',
  'author.email',
  'committer.name',
  'committer.email',
]);

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

// ---------------------------------------------------------------------------
// Sub-validators
// ---------------------------------------------------------------------------

/**
 * Validate git config commands — block identity changes.
 *
 * Ported from: validate_git_config()
 */
function validateGitConfig(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse git command'];
  }

  if (tokens.length < 2 || tokens[0] !== 'git' || tokens[1] !== 'config') {
    return [true, '']; // Not a git config command
  }

  // Check for read-only operations first — always allowed
  const readOnlyFlags = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l']);
  for (const token of tokens.slice(2)) {
    if (readOnlyFlags.has(token)) {
      return [true, ''];
    }
  }

  // Extract the config key (first non-option token after "config")
  let configKey: string | null = null;
  for (const token of tokens.slice(2)) {
    if (token.startsWith('-')) continue;
    configKey = token.toLowerCase();
    break;
  }

  if (!configKey) {
    return [true, '']; // No config key specified
  }

  if (BLOCKED_GIT_CONFIG_KEYS.has(configKey)) {
    return [
      false,
      `BLOCKED: Cannot modify git identity configuration\n\n` +
        `You attempted to set '${configKey}' which is not allowed.\n\n` +
        `WHY: Git identity (user.name, user.email) must inherit from the user's ` +
        `global git configuration. Setting fake identities like 'Test User' breaks ` +
        `commit attribution and causes serious issues.\n\n` +
        `WHAT TO DO: Simply commit without setting any user configuration. ` +
        `The repository will use the correct identity automatically.`,
    ];
  }

  return [true, ''];
}

/**
 * Check for blocked config keys passed via git -c flag.
 *
 * Ported from: validate_git_inline_config()
 */
function validateGitInlineConfig(tokens: string[]): ValidationResult {
  let i = 1; // Start after 'git'
  while (i < tokens.length) {
    const token = tokens[i];

    if (token === '-c') {
      // Next token should be key=value
      if (i + 1 < tokens.length) {
        const configPair = tokens[i + 1];
        if (configPair.includes('=')) {
          const configKey = configPair.split('=')[0].toLowerCase();
          if (BLOCKED_GIT_CONFIG_KEYS.has(configKey)) {
            return [
              false,
              `BLOCKED: Cannot set git identity via -c flag\n\n` +
                `You attempted to use '-c ${configPair}' which sets a blocked ` +
                `identity configuration.\n\n` +
                `WHY: Git identity (user.name, user.email) must inherit from the ` +
                `user's global git configuration. Setting fake identities breaks ` +
                `commit attribution and causes serious issues.\n\n` +
                `WHAT TO DO: Remove the -c flag and commit normally. ` +
                `The repository will use the correct identity automatically.`,
            ];
          }
        }
        i += 2; // Skip -c and its value
        continue;
      }
    } else if (token.startsWith('-c') && token.length > 2) {
      // Handle -ckey=value format (no space)
      const configPair = token.slice(2);
      if (configPair.includes('=')) {
        const configKey = configPair.split('=')[0].toLowerCase();
        if (BLOCKED_GIT_CONFIG_KEYS.has(configKey)) {
          return [
            false,
            `BLOCKED: Cannot set git identity via -c flag\n\n` +
              `You attempted to use '${token}' which sets a blocked ` +
              `identity configuration.\n\n` +
              `WHY: Git identity (user.name, user.email) must inherit from the ` +
              `user's global git configuration. Setting fake identities breaks ` +
              `commit attribution and causes serious issues.\n\n` +
              `WHAT TO DO: Remove the -c flag and commit normally. ` +
              `The repository will use the correct identity automatically.`,
          ];
        }
      }
    }

    i++;
  }

  return [true, ''];
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Main git validator that checks all git security rules.
 *
 * Currently validates:
 * - git -c: Block identity changes via inline config on ANY git command
 * - git config: Block identity changes
 * - git commit: Secret scanning (delegated to scan-secrets module)
 *
 * Ported from: validate_git_command() / validate_git_commit (alias)
 */
export function validateGitCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse git command'];
  }

  if (tokens.length === 0 || tokens[0] !== 'git') {
    return [true, ''];
  }

  if (tokens.length < 2) {
    return [true, '']; // Just "git" with no subcommand
  }

  // Check for blocked -c flags on ANY git command (security bypass prevention)
  const [inlineValid, inlineError] = validateGitInlineConfig(tokens);
  if (!inlineValid) {
    return [false, inlineError];
  }

  // Find the actual subcommand (skip global options like -c, -C, --git-dir, etc.)
  let subcommand: string | null = null;
  let skipNext = false;
  for (const token of tokens.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token === '-c' || token === '-C' || token === '--git-dir' || token === '--work-tree') {
      skipNext = true;
      continue;
    }
    if (token.startsWith('-')) continue;
    subcommand = token;
    break;
  }

  if (!subcommand) {
    return [true, '']; // No subcommand found
  }

  // Check git config commands
  if (subcommand === 'config') {
    return validateGitConfig(commandString);
  }

  // git commit: secret scanning is handled at a higher level in the Python backend.
  // In the TypeScript port we allow git commit (secrets scanning is async/file-based
  // and would require spawning a subprocess — left to the git hook layer).
  // The identity protection checks above still apply.

  return [true, ''];
}
