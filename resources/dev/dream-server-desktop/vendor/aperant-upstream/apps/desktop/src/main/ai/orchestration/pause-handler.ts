/**
 * Pause Handler
 * =============
 *
 * Handles rate-limit and authentication pause/resume signalling via
 * filesystem sentinel files. See apps/desktop/src/main/ai/orchestration/pause-handler.ts for the TypeScript implementation.
 *
 * The backend (or, in this TS port, the build orchestrator) creates a pause
 * file when it hits a rate limit or auth failure. The frontend removes this
 * file (or creates a RESUME file) to signal that execution can continue.
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Constants — see apps/desktop/src/main/ai/orchestration/pause-handler.ts
// =============================================================================

/** Created in specDir when the provider returns HTTP 429. */
export const RATE_LIMIT_PAUSE_FILE = 'RATE_LIMIT_PAUSE';

/** Created in specDir when the provider returns HTTP 401. */
export const AUTH_FAILURE_PAUSE_FILE = 'AUTH_PAUSE';

/** Created by the frontend UI to signal that the user wants to resume. */
export const RESUME_FILE = 'RESUME';

/** Created by the frontend when a human needs to review before continuing. */
export const HUMAN_INTERVENTION_FILE = 'PAUSE';

/** Maximum time to wait for rate-limit reset (2 hours). */
const MAX_RATE_LIMIT_WAIT_MS = 7_200_000;

/** Interval for polling RESUME file during rate-limit wait (30 s). */
const RATE_LIMIT_CHECK_INTERVAL_MS = 30_000;

/** Interval for polling during auth-failure wait (10 s). */
const AUTH_RESUME_CHECK_INTERVAL_MS = 10_000;

/** Maximum time to wait for user to re-authenticate (24 hours). */
const AUTH_RESUME_MAX_WAIT_MS = 86_400_000;

// =============================================================================
// Types
// =============================================================================

/** Data written to RATE_LIMIT_PAUSE file. */
export interface RateLimitPauseData {
  pausedAt: string;
  resetTimestamp: string | null;
  error: string;
}

/** Data written to AUTH_FAILURE_PAUSE file. */
export interface AuthPauseData {
  pausedAt: string;
  error: string;
  requiresAction: 're-authenticate';
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Check if a RESUME file exists at either the primary or fallback location.
 * If found, deletes the RESUME file and the associated pause file.
 *
 * @returns true if a RESUME file was found (early resume requested).
 */
function checkAndClearResumeFile(
  resumeFile: string,
  pauseFile: string,
  fallbackResumeFile?: string,
): boolean {
  let found = existsSync(resumeFile);

  if (!found && fallbackResumeFile && existsSync(fallbackResumeFile)) {
    found = true;
    try { unlinkSync(fallbackResumeFile); } catch { /* ignore */ }
  }

  if (found) {
    try { unlinkSync(resumeFile); } catch { /* ignore */ }
    try { unlinkSync(pauseFile); } catch { /* ignore */ }
  }

  return found;
}

/**
 * Promise-based delay that resolves when either the timeout expires
 * or the abort signal fires.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// =============================================================================
// Pause file creation
// =============================================================================

/**
 * Write a RATE_LIMIT_PAUSE sentinel file to the spec directory.
 * The frontend reads this file to show a countdown UI.
 */
export function writeRateLimitPauseFile(
  specDir: string,
  error: string,
  resetTimestamp: string | null,
): void {
  const data: RateLimitPauseData = {
    pausedAt: new Date().toISOString(),
    resetTimestamp,
    error,
  };
  writeFileSync(join(specDir, RATE_LIMIT_PAUSE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Write an AUTH_FAILURE_PAUSE sentinel file to the spec directory.
 * The frontend reads this file to show a re-authentication prompt.
 */
export function writeAuthPauseFile(specDir: string, error: string): void {
  const data: AuthPauseData = {
    pausedAt: new Date().toISOString(),
    error,
    requiresAction: 're-authenticate',
  };
  writeFileSync(join(specDir, AUTH_FAILURE_PAUSE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read and parse the contents of a pause file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readPauseFile(specDir: string, fileName: string): Record<string, unknown> | null {
  const filePath = join(specDir, fileName);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Remove a pause file if it exists (cleanup).
 */
export function removePauseFile(specDir: string, fileName: string): void {
  const filePath = join(specDir, fileName);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
}

// =============================================================================
// Wait functions
// =============================================================================

/**
 * Wait for a rate-limit reset, polling for an early RESUME signal.
 *
 * Mirrors Python `wait_for_rate_limit_reset()` in coder.py.
 *
 * @param specDir        Spec directory that holds the pause/resume files.
 * @param waitMs         Maximum milliseconds to wait.
 * @param sourceSpecDir  Optional fallback dir to also check for RESUME file.
 * @param signal         AbortSignal for cancellation.
 * @returns true if the user signalled an early resume, false if we waited out the full duration.
 */
export async function waitForRateLimitResume(
  specDir: string,
  waitMs: number,
  sourceSpecDir?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // Cap at maximum
  const effectiveWait = Math.min(waitMs, MAX_RATE_LIMIT_WAIT_MS);

  const resumeFile = join(specDir, RESUME_FILE);
  const pauseFile = join(specDir, RATE_LIMIT_PAUSE_FILE);
  const fallbackResume = sourceSpecDir ? join(sourceSpecDir, RESUME_FILE) : undefined;

  const deadline = Date.now() + effectiveWait;

  while (Date.now() < deadline) {
    if (signal?.aborted) break;

    if (checkAndClearResumeFile(resumeFile, pauseFile, fallbackResume)) {
      return true;
    }

    const remaining = deadline - Date.now();
    const interval = Math.min(RATE_LIMIT_CHECK_INTERVAL_MS, remaining);
    if (interval <= 0) break;
    await sleep(interval, signal);
  }

  // Clean up pause file after wait completes
  removePauseFile(specDir, RATE_LIMIT_PAUSE_FILE);
  return false;
}

/**
 * Wait for the user to complete re-authentication.
 *
 * Mirrors Python `wait_for_auth_resume()` in coder.py.
 *
 * Blocks until:
 * - A RESUME file appears (user completed re-auth in UI)
 * - The AUTH_PAUSE file is deleted externally (alternative signal)
 * - The maximum wait timeout (24 h) is reached
 *
 * @param specDir        Spec directory that holds the pause/resume files.
 * @param sourceSpecDir  Optional fallback dir to also check for RESUME file.
 * @param signal         AbortSignal for cancellation.
 */
export async function waitForAuthResume(
  specDir: string,
  sourceSpecDir?: string,
  signal?: AbortSignal,
): Promise<void> {
  const resumeFile = join(specDir, RESUME_FILE);
  const pauseFile = join(specDir, AUTH_FAILURE_PAUSE_FILE);
  const fallbackResume = sourceSpecDir ? join(sourceSpecDir, RESUME_FILE) : undefined;

  const deadline = Date.now() + AUTH_RESUME_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    if (signal?.aborted) break;

    // Check for explicit RESUME file
    if (checkAndClearResumeFile(resumeFile, pauseFile, fallbackResume)) {
      return;
    }

    // Check if pause file was deleted externally (alternative resume signal)
    if (!existsSync(pauseFile)) {
      // Also clean up resume file if it exists
      try { if (existsSync(resumeFile)) unlinkSync(resumeFile); } catch { /* ignore */ }
      return;
    }

    await sleep(AUTH_RESUME_CHECK_INTERVAL_MS, signal);
  }

  // Timeout reached — clean up and return so the build can continue / fail
  removePauseFile(specDir, AUTH_FAILURE_PAUSE_FILE);
}

// =============================================================================
// Human intervention check
// =============================================================================

/**
 * Check whether a human intervention pause file exists.
 *
 * When PAUSE exists, the build orchestrator should not start the next session
 * until the user removes the file or signals resume.
 *
 * @returns The contents of the PAUSE file, or null if no pause is active.
 */
export function checkHumanIntervention(specDir: string): string | null {
  const pauseFile = join(specDir, HUMAN_INTERVENTION_FILE);
  if (!existsSync(pauseFile)) return null;
  try {
    return readFileSync(pauseFile, 'utf8').trim();
  } catch {
    return '';
  }
}
