/**
 * Path Containment
 * =================
 *
 * Filesystem boundary enforcement to prevent AI agents from
 * accessing files outside the project directory.
 *
 * Handles symlink resolution, relative path traversal (../),
 * and cross-platform path normalization.
 *
 * See apps/desktop/src/main/ai/security/path-containment.ts for the TypeScript implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isWindows } from '../../platform/';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a path containment check */
export interface PathContainmentResult {
  contained: boolean;
  resolvedPath: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Core enforcement
// ---------------------------------------------------------------------------

/**
 * Normalize a path for consistent comparison across platforms.
 *
 * - Resolves to absolute path relative to projectDir
 * - Normalizes separators and removes trailing slashes
 * - Lowercases on Windows for case-insensitive comparison
 */
function normalizePath(filePath: string, projectDir: string): string {
  // Resolve relative paths against the project directory
  const resolved = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.normalize(path.resolve(projectDir, filePath));

  // On Windows, lowercase for case-insensitive comparison
  if (isWindows()) {
    return resolved.toLowerCase();
  }

  return resolved;
}

/**
 * Resolve symlinks in a path, falling back to the original if it doesn't exist yet.
 */
function resolveSymlinks(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // File doesn't exist yet — resolve the parent directory instead
    const parentDir = path.dirname(filePath);
    try {
      const realParent = fs.realpathSync(parentDir);
      return path.join(realParent, path.basename(filePath));
    } catch {
      // Parent doesn't exist either — return normalized path as-is
      return path.normalize(filePath);
    }
  }
}

/**
 * Assert that a file path is contained within the project directory.
 *
 * Blocks:
 * - Paths that resolve outside projectDir (including via ../ traversal)
 * - Symlinks that escape the project boundary
 * - Absolute paths to other directories
 *
 * @param filePath - The path to check (absolute or relative)
 * @param projectDir - The project root directory (boundary)
 * @returns PathContainmentResult with containment status
 * @throws Error if the path escapes the project boundary
 */
export function assertPathContained(
  filePath: string,
  projectDir: string,
): PathContainmentResult {
  if (!filePath || !projectDir) {
    throw new Error(
      'Path containment check requires both filePath and projectDir',
    );
  }

  // Resolve the project directory (with symlinks)
  const resolvedProjectDir = resolveSymlinks(projectDir);
  const normalizedProjectDir = normalizePath(
    resolvedProjectDir,
    resolvedProjectDir,
  );

  // Resolve the target path (with symlinks)
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(resolvedProjectDir, filePath);
  const resolvedPath = resolveSymlinks(absolutePath);
  const normalizedPath = normalizePath(resolvedPath, resolvedProjectDir);

  // Ensure the resolved path starts with the project directory
  const projectDirWithSep = normalizedProjectDir.endsWith(path.sep)
    ? normalizedProjectDir
    : normalizedProjectDir + path.sep;

  const isContained =
    normalizedPath === normalizedProjectDir ||
    normalizedPath.startsWith(projectDirWithSep);

  if (!isContained) {
    const reason = `Path '${filePath}' resolves to '${resolvedPath}' which is outside the project directory '${resolvedProjectDir}'`;
    throw new Error(reason);
  }

  return {
    contained: true,
    resolvedPath,
  };
}

/**
 * Check path containment without throwing — returns a result object instead.
 */
export function isPathContained(
  filePath: string,
  projectDir: string,
): PathContainmentResult {
  try {
    return assertPathContained(filePath, projectDir);
  } catch (error) {
    return {
      contained: false,
      resolvedPath: '',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
