/**
 * Path resolution utilities for Auto Claude updater
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Get the path to the bundled prompts directory
 */
export function getBundledSourcePath(): string {
  // In production, use app resources
  // In development, use the repo's apps/desktop/prompts folder
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'prompts');
  }

  // Development mode - look for prompts in various locations
  const possiblePaths = [
    // apps/desktop/prompts relative to app root
    path.join(app.getAppPath(), '..', 'prompts'),
    path.join(app.getAppPath(), '..', '..', 'apps', 'desktop', 'prompts'),
    path.join(process.cwd(), 'apps', 'desktop', 'prompts'),
    path.join(process.cwd(), '..', 'prompts')
  ];

  for (const p of possiblePaths) {
    // Validate it's a proper prompts directory (must have planner.md)
    const markerPath = path.join(p, 'planner.md');
    if (existsSync(p) && existsSync(markerPath)) {
      return p;
    }
  }

  // Fallback - warn if this path is also invalid
  const fallback = path.join(app.getAppPath(), '..', 'prompts');
  const fallbackMarker = path.join(fallback, 'planner.md');
  if (!existsSync(fallbackMarker)) {
    console.warn(
      `[path-resolver] No valid prompts directory found in development paths, fallback "${fallback}" may be invalid`
    );
  }
  return fallback;
}

/**
 * Get the path for storing downloaded updates
 */
export function getUpdateCachePath(): string {
  return path.join(app.getPath('userData'), 'auto-claude-updates');
}

/**
 * Get the effective source path (considers override from updates and settings)
 */
export function getEffectiveSourcePath(): string {
  // First, check user settings for configured autoBuildPath
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.autoBuildPath && existsSync(settings.autoBuildPath)) {
        // Validate it's a proper prompts source (must have planner.md)
        const markerPath = path.join(settings.autoBuildPath, 'planner.md');
        if (existsSync(markerPath)) {
          return settings.autoBuildPath;
        }
        // Invalid path - log warning and fall through to auto-detection
        console.warn(
          `[path-resolver] Configured autoBuildPath "${settings.autoBuildPath}" is missing planner.md, falling back to bundled source`
        );
      }
    }
  } catch {
    // Ignore settings read errors
  }

  if (app.isPackaged) {
    // Check for user-updated source first
    const overridePath = path.join(app.getPath('userData'), 'prompts-source');
    const overrideMarker = path.join(overridePath, 'planner.md');
    if (existsSync(overridePath) && existsSync(overrideMarker)) {
      return overridePath;
    }
  }

  return getBundledSourcePath();
}

/**
 * Get the path where updates should be installed
 */
export function getUpdateTargetPath(): string {
  if (app.isPackaged) {
    // For packaged apps, store in userData as a source override
    return path.join(app.getPath('userData'), 'prompts-source');
  } else {
    // In development, update the actual source
    return getBundledSourcePath();
  }
}
