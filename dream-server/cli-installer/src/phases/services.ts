// ── Phase 06: Services ──────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { parseEnv } from '../lib/env.ts';
import * as ui from '../lib/ui.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

export async function services(ctx: InstallContext): Promise<number> {
  ui.phase(6, 6, 'Launch Services', '~2min');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would run: docker compose up -d');
    return 0;
  }

  // Use shared compose command resolver
  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch {
    ui.fail('Neither "docker compose" nor "docker-compose" found');
    process.exit(1);
    return 1; // unreachable, but satisfies TS
  }

  ui.step('Starting containers...');
  const exitCode = await execStream(
    [...composeCmd, 'up', '-d', '--remove-orphans'],
    { cwd: ctx.installDir },
  );

  if (exitCode !== 0) {
    // Don't hard-exit — check what actually happened
    ui.warn('docker compose up exited with errors');
    console.log('');
    await showContainerStatus(ctx, composeCmd);
    showRecoveryHelp(ctx, composeCmd);
    // Continue to health checks and summary (handled by install.ts)
  } else {
    ui.ok('All containers started');
  }

  return exitCode;
}

/**
 * Read configured ports from .env, with sensible defaults.
 */
export function readPorts(ctx: InstallContext): Record<string, number> {
  const defaults: Record<string, number> = {
    WEBUI_PORT: 3000,
    DASHBOARD_PORT: 3001,
    LLM_PORT: 8080,
    SEARXNG_PORT: 8888,
  };

  const envPath = join(ctx.installDir, '.env');
  if (!existsSync(envPath)) return defaults;

  try {
    const content = readFileSync(envPath, 'utf-8');
    const env = parseEnv(content);
    return {
      WEBUI_PORT: parseInt(env.WEBUI_PORT || '', 10) || defaults.WEBUI_PORT,
      DASHBOARD_PORT: parseInt(env.DASHBOARD_PORT || '', 10) || defaults.DASHBOARD_PORT,
      LLM_PORT: parseInt(env.LLAMA_SERVER_PORT || env.OLLAMA_PORT || '', 10) || defaults.LLM_PORT,
      SEARXNG_PORT: parseInt(env.SEARXNG_PORT || '', 10) || defaults.SEARXNG_PORT,
    };
  } catch {
    return defaults;
  }
}

/**
 * Derive the base docker command from the compose command.
 * If composeCmd is ['sudo', 'docker', 'compose'], docker base is ['sudo', 'docker'].
 * If composeCmd is ['docker', 'compose'], docker base is ['docker'].
 * If composeCmd is ['docker-compose'], docker base is ['docker'].
 */
export function getDockerBaseCmd(composeCmd: string[]): string[] {
  if (composeCmd[0] === 'sudo') return ['sudo', 'docker'];
  if (composeCmd[0] === 'docker-compose') return ['docker'];
  return ['docker'];
}

async function showContainerStatus(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps', '--format', 'json'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );

    if (!stdout.trim()) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    const running: string[] = [];
    const failed: string[] = [];

    // Parse containers — handle both JSON array and one-per-line formats
    let containers: Record<string, unknown>[] = [];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('[')) {
      try { containers = JSON.parse(trimmed); } catch { /* fallback below */ }
    } else {
      for (const line of trimmed.split('\n')) {
        try { containers.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }

    if (containers.length === 0) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    for (const c of containers) {
      // Docker Compose v2 uses PascalCase, some versions use lowercase
      const name = ((c.Name ?? c.name ?? '') as string).replace(/^dream-/, '');
      const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
      const status = (c.Status ?? c.status ?? '') as string;

      if (state === 'running') {
        running.push(name);
      } else {
        failed.push(`${name} (${status || state})`);
      }
    }

    if (running.length > 0) {
      ui.ok(`Running (${running.length}): ${running.join(', ')}`);
    }
    if (failed.length > 0) {
      for (const f of failed) {
        ui.fail(f);
      }
    }
  } catch {
    await showContainerStatusFallback(ctx, composeCmd);
  }
}

async function showContainerStatusFallback(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );
    if (stdout.trim()) {
      console.log('');
      console.log(stdout);
    }
  } catch {
    ui.info('Could not get container status');
  }
}

function showRecoveryHelp(ctx: InstallContext, composeCmd: string[]) {
  const cmd = composeCmd.join(' ');
  console.log('');
  ui.info('To inspect failed containers:');
  console.log(`     cd ${ctx.installDir}`);
  console.log(`     ${cmd} logs <service-name>`);
  console.log('');
  ui.info('To retry:');
  console.log(`     dream-installer install`);
}


export function showSuccess(ctx: InstallContext, ports: Record<string, number>, hadErrors: boolean) {
  const localIP = getLocalIP();

  if (hadErrors) {
    ui.header('Installation Partially Complete');
    console.log('');
    ui.warn('Some services failed to start. Core services may still be functional.');
  } else {
    ui.header('Installation Complete');
  }

  console.log('');
  ui.table([
    ['Dashboard', `http://localhost:${ports.DASHBOARD_PORT}`],
    ['Chat', `http://localhost:${ports.WEBUI_PORT}`],
  ]);

  if (localIP) {
    console.log('');
    ui.info('LAN access:');
    ui.table([
      ['Dashboard', `http://${localIP}:${ports.DASHBOARD_PORT}`],
      ['Chat', `http://${localIP}:${ports.WEBUI_PORT}`],
    ]);
  }

  if (ctx.tailscaleIp) {
    console.log('');
    ui.ok('Tailscale access (secure, no port forwarding):');
    ui.table([
      ['Dashboard', `http://${ctx.tailscaleIp}:${ports.DASHBOARD_PORT}`],
      ['Chat', `http://${ctx.tailscaleIp}:${ports.WEBUI_PORT}`],
    ]);
  }

  console.log('');
  ui.info('Your data never leaves this machine.');

  if (hadErrors) {
    console.log('');
    ui.info(`Manage services: cd ${ctx.installDir}`);
  }

  console.log('');
}

function getLocalIP(): string | null {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}
