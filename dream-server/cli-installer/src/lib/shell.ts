// ── Shell execution helpers ─────────────────────────────────────────────────
// All subprocess calls via Bun.spawn — async, streaming, no event loop blocking.

import { commandExists as platformCommandExists } from './platform.ts';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and capture output. Throws on non-zero exit by default.
 */
export async function exec(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; throwOnError?: boolean; timeout?: number } = {},
): Promise<ExecResult> {
  const { cwd, env, throwOnError = true, timeout = 30_000 } = opts;

  let proc;
  try {
    proc = Bun.spawn(cmd, {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    // Bun.spawn throws synchronously if the binary doesn't exist (ENOENT)
    if (throwOnError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 127, stdout: '', stderr: msg };
  }

  const timeoutId = timeout > 0
    ? setTimeout(() => proc.kill(), timeout)
    : null;

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (timeoutId) clearTimeout(timeoutId);

  if (throwOnError && exitCode !== 0) {
    throw new ShellError(cmd.join(' '), exitCode, stdout, stderr);
  }

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Run a command and stream stdout/stderr to the console.
 */
export async function execStream(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<number> {
  let proc;
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      stdout: 'inherit',
      stderr: 'inherit',
    });
  } catch {
    // Binary not found (ENOENT) — return non-zero exit code
    return 127;
  }

  if (opts.timeout) {
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, opts.timeout);
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);
    return exitCode;
  }

  return proc.exited;
}

/**
 * Check if a command exists on the system.
 * Uses `where.exe` on Windows, `which` on Linux/macOS.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  return platformCommandExists(cmd);
}

export class ShellError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`Command failed (exit ${exitCode}): ${command}\n${stderr}`);
    this.name = 'ShellError';
  }
}
