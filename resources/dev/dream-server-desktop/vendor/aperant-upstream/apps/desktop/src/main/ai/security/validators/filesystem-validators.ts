/**
 * File System Validators
 * =======================
 *
 * Validators for file system operations (chmod, rm, init scripts).
 *
 * Security model: DENYLIST-based (consistent with the overall security system).
 * - rm: blocks dangerous targets (/, /home, /etc, etc.)
 * - chmod: blocks setuid/setgid bits (privilege escalation), allows all other modes
 */

import type { ValidationResult } from '../bash-validator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Dangerous chmod mode patterns — setuid/setgid bits that enable
 * privilege escalation. All other modes (755, 644, 777, +x, o+w, etc.)
 * are allowed since agents work within project boundaries.
 */
const DANGEROUS_CHMOD_PATTERNS: RegExp[] = [
  // Numeric modes with special bits: 4xxx (setuid), 2xxx (setgid), 6xxx (both)
  /^[4267]\d{3}$/,
  // Symbolic setuid/setgid
  /[+]s/,
  /u[+]s/,
  /g[+]s/,
  /o[+]s/,
  /a[+]s/,
];

/** Dangerous rm target patterns */
const DANGEROUS_RM_PATTERNS: RegExp[] = [
  /^\/$/,        // Root
  /^\.\.$/,      // Parent directory
  /^~$/,         // Home directory
  /^\*$/,        // Wildcard only
  /^\/\*$/,      // Root wildcard
  /^\.\.\//,     // Escaping current directory
  /^\/home$/,    // /home
  /^\/usr$/,     // /usr
  /^\/etc$/,     // /etc
  /^\/var$/,     // /var
  /^\/bin$/,     // /bin
  /^\/lib$/,     // /lib
  /^\/opt$/,     // /opt
];

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
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate chmod commands — block setuid/setgid (privilege escalation).
 *
 * Uses a denylist model: any mode is allowed UNLESS it sets the setuid or
 * setgid special permission bits, which enable privilege escalation.
 * Normal permission modes (755, 644, 777, +x, o+w, etc.) are all permitted
 * since agents work within project boundaries.
 */
export function validateChmodCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse chmod command'];
  }

  if (tokens.length === 0 || tokens[0] !== 'chmod') {
    return [false, 'Not a chmod command'];
  }

  let mode: string | null = null;
  const files: string[] = [];

  for (const token of tokens.slice(1)) {
    if (token === '-R' || token === '--recursive') {
      continue;
    }
    if (token.startsWith('-')) {
      // Allow common flags like -v (verbose), -c (changes), -f (silent)
      if (/^-[vcf]+$/.test(token)) continue;
      return [false, `chmod flag '${token}' is not allowed`];
    }
    if (mode === null) {
      mode = token;
    } else {
      files.push(token);
    }
  }

  if (mode === null) {
    return [false, 'chmod requires a mode'];
  }

  if (files.length === 0) {
    return [false, 'chmod requires at least one file'];
  }

  // Block dangerous modes (setuid/setgid — privilege escalation)
  for (const pattern of DANGEROUS_CHMOD_PATTERNS) {
    if (pattern.test(mode)) {
      return [
        false,
        `chmod mode '${mode}' is not allowed — setuid/setgid bits enable privilege escalation. ` +
          `Use standard permission modes (755, 644, +x, etc.) instead.`,
      ];
    }
  }

  return [true, ''];
}

/**
 * Validate rm commands — prevent dangerous deletions.
 *
 * Ported from: validate_rm_command()
 */
export function validateRmCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse rm command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty rm command'];
  }

  for (const token of tokens.slice(1)) {
    if (token.startsWith('-')) {
      // Allow flags: -r, -f, -rf, -fr, -v, -i
      if (token === '--no-preserve-root') {
        return [false, '--no-preserve-root is not allowed for safety'];
      }
      continue;
    }
    for (const pattern of DANGEROUS_RM_PATTERNS) {
      if (pattern.test(token)) {
        return [false, `rm target '${token}' is not allowed for safety`];
      }
    }
  }

  return [true, ''];
}

/**
 * Validate init.sh script execution — only allow ./init.sh.
 *
 * Ported from: validate_init_script()
 */
export function validateInitScript(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse init script command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty command'];
  }

  const script = tokens[0];

  // Allow ./init.sh or paths ending in /init.sh
  if (script === './init.sh' || script.endsWith('/init.sh')) {
    return [true, ''];
  }

  return [false, `Only ./init.sh is allowed, got: ${script}`];
}
