/**
 * Security Denylist
 * =================
 *
 * Static set of commands that are ALWAYS blocked for autonomous agents.
 * Extracted into a standalone module to avoid circular imports between
 * bash-validator.ts and the validator modules.
 *
 * Criteria for inclusion:
 * - System destruction (disk formatting, raw I/O)
 * - Privilege escalation
 * - Firewall / network infrastructure manipulation
 * - OS service / scheduler / user-account management
 * - Physical machine control (shutdown, reboot)
 */

/** Validation result: [isAllowed, reason] */
export type ValidationResult = [boolean, string];

/**
 * Commands that are never permitted regardless of project profile.
 */
export const BLOCKED_COMMANDS: Set<string> = new Set([
  // System shutdown / reboot
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',

  // Disk formatting / partition management (catastrophic data loss)
  'mkfs',
  'fdisk',
  'parted',
  'gdisk',
  'dd', // raw disk write — too dangerous for autonomous agents

  // Privilege escalation
  'sudo',
  'su',
  'doas',
  'chown', // changing file ownership requires elevated context

  // Firewall / network infrastructure
  'iptables',
  'ip6tables',
  'nft',
  'ufw',

  // Network scanning / exploitation primitives
  'nmap',

  // System service management
  'systemctl',
  'service',

  // Scheduled tasks
  'crontab',

  // Mount / unmount
  'mount',
  'umount',

  // User / group account management
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'passwd',
  'visudo',
]);

/**
 * Check whether a command is blocked by the static denylist.
 *
 * Returns [false, reason] if blocked, [true, ''] if allowed.
 */
export function isCommandBlocked(command: string): ValidationResult {
  if (BLOCKED_COMMANDS.has(command)) {
    return [
      false,
      `Command '${command}' is blocked for security reasons (system-level command not permitted for autonomous agents)`,
    ];
  }
  return [true, ''];
}
