/**
 * Security Profile Management
 * ============================
 *
 * Loads and caches project security profiles from .auto-claude/ config.
 * Provides SecurityProfile instances consumed by bash-validator.ts.
 *
 * NOTE: With the denylist security model, SecurityProfile command sets are no
 * longer used to make allow/deny decisions. The profile is retained for
 * backward compatibility — callers that serialize/deserialize profiles across
 * worker boundaries continue to work without changes.
 *
 * The bash validator now uses a static BLOCKED_COMMANDS denylist instead of
 * reading commands from these sets.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SecurityProfile } from './bash-validator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROFILE_FILENAME = '.auto-claude-security.json';
const ALLOWLIST_FILENAME = '.auto-claude-allowlist';

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

let cachedProfile: SecurityProfile | null = null;
let cachedProjectDir: string | null = null;
let cachedProfileMtime: number | null = null;
let cachedAllowlistMtime: number | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProfilePath(projectDir: string): string {
  return path.join(projectDir, PROFILE_FILENAME);
}

function getAllowlistPath(projectDir: string): string {
  return path.join(projectDir, ALLOWLIST_FILENAME);
}

function getFileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON security profile file into a SecurityProfile object.
 */
function parseProfileFile(filePath: string): SecurityProfile | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    return profileFromDict(data);
  } catch {
    return null;
  }
}

/**
 * Parse the allowlist file and return additional command names.
 * Each non-empty, non-comment line is a command name.
 */
function parseAllowlistFile(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Build a SecurityProfile from a raw JSON dict.
 */
function profileFromDict(data: Record<string, unknown>): SecurityProfile {
  const toStringArray = (val: unknown): string[] =>
    Array.isArray(val) ? (val as string[]) : [];

  const baseCommands = new Set(toStringArray(data.base_commands));
  const stackCommands = new Set(toStringArray(data.stack_commands));
  const scriptCommands = new Set(toStringArray(data.script_commands));
  const customCommands = new Set(toStringArray(data.custom_commands));

  const customScriptsData = (data.custom_scripts ?? {}) as Record<
    string,
    unknown
  >;
  const shellScripts = toStringArray(customScriptsData.shell_scripts);

  return {
    baseCommands,
    stackCommands,
    scriptCommands,
    customCommands,
    customScripts: { shellScripts },
    getAllAllowedCommands(): Set<string> {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}

/**
 * Create an empty default security profile.
 *
 * Under the denylist model the command sets are not used for security
 * decisions, so an empty profile is perfectly safe.
 */
function createDefaultProfile(): SecurityProfile {
  return {
    baseCommands: new Set<string>(),
    stackCommands: new Set<string>(),
    scriptCommands: new Set<string>(),
    customCommands: new Set<string>(),
    customScripts: { shellScripts: [] },
    getAllAllowedCommands(): Set<string> {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the security profile for a project, using cache when possible.
 *
 * The cache is invalidated when:
 * - The project directory changes
 * - The security profile file is created or modified
 * - The allowlist file is created, modified, or deleted
 *
 * @param projectDir - Project root directory
 * @returns SecurityProfile for the project
 */
export function getSecurityProfile(projectDir: string): SecurityProfile {
  const resolvedDir = path.resolve(projectDir);

  // Check cache validity
  if (cachedProfile !== null && cachedProjectDir === resolvedDir) {
    const currentProfileMtime = getFileMtime(getProfilePath(resolvedDir));
    const currentAllowlistMtime = getFileMtime(getAllowlistPath(resolvedDir));

    if (
      currentProfileMtime === cachedProfileMtime &&
      currentAllowlistMtime === cachedAllowlistMtime
    ) {
      return cachedProfile;
    }
  }

  // Load profile from file or create default
  const profilePath = getProfilePath(resolvedDir);
  let profile = parseProfileFile(profilePath);

  if (!profile) {
    profile = createDefaultProfile();
  }

  // Merge allowlist commands into customCommands (informational, not used for
  // security decisions in the denylist model)
  const allowlistPath = getAllowlistPath(resolvedDir);
  const allowlistCommands = parseAllowlistFile(allowlistPath);
  for (const cmd of allowlistCommands) {
    profile.customCommands.add(cmd);
  }

  // Update cache
  cachedProfile = profile;
  cachedProjectDir = resolvedDir;
  cachedProfileMtime = getFileMtime(profilePath);
  cachedAllowlistMtime = getFileMtime(allowlistPath);

  return profile;
}

/**
 * Reset the cached profile (useful for testing or re-analysis).
 */
export function resetProfileCache(): void {
  cachedProfile = null;
  cachedProjectDir = null;
  cachedProfileMtime = null;
  cachedAllowlistMtime = null;
}
