// ── Docker helpers ──────────────────────────────────────────────────────────

import { exec } from './shell.ts';
import { IS_WINDOWS, getDockerDaemonFixHint } from './platform.ts';

let _cachedCmd: string[] | null = null;

export function resetCache(): void {
  _cachedCmd = null;
}

/**
 * Resolve the docker compose command that can actually talk to the daemon.
 *
 * Strategy: Check binary + daemon access separately because:
 * - `docker compose version` works without daemon access (just binary check)
 * - `docker compose ps` requires a compose.yml in cwd (unreliable for detection)
 * - `docker info` verifies daemon access without needing a project directory
 */
export async function getComposeCommand(): Promise<string[]> {
  if (_cachedCmd) return _cachedCmd;

  // Try user-level: binary exists + daemon accessible
  try {
    const bin = await exec(['docker', 'compose', 'version'], { throwOnError: false, timeout: 5000 });
    if (bin.exitCode === 0) {
      const info = await exec(['docker', 'info'], { throwOnError: false, timeout: 5000 });
      if (info.exitCode === 0) {
        _cachedCmd = ['docker', 'compose'];
        return _cachedCmd;
      }
    }
  } catch { /* try sudo on Linux */ }

  // Try sudo (Linux/macOS only — sudo doesn't exist on Windows)
  if (!IS_WINDOWS) {
    try {
      const info = await exec(['sudo', '-n', 'docker', 'info'], { throwOnError: false, timeout: 5000 });
      if (info.exitCode === 0) {
        _cachedCmd = ['sudo', 'docker', 'compose'];
        return _cachedCmd;
      }
    } catch { /* skip */ }
  }

  // Try standalone docker-compose
  try {
    const bin = await exec(['docker-compose', 'version'], { throwOnError: false, timeout: 5000 });
    if (bin.exitCode === 0) {
      _cachedCmd = ['docker-compose'];
      return _cachedCmd;
    }
  } catch { /* skip */ }

  const hints = getDockerDaemonFixHint();
  throw new Error(
    'Cannot connect to Docker daemon.\n' +
    hints.map((h) => `  • ${h}`).join('\n'),
  );
}
