// ── Port Availability Checks ────────────────────────────────────────────────
// Verifies required ports are free before starting services.

import { exec } from './shell.ts';
import { type InstallContext } from './config.ts';
import * as ui from './ui.ts';

/**
 * Check if a TCP port is in use using ss or netstat.
 * Returns true if the port is FREE, false if it's in use.
 */
export async function isPortFree(port: number): Promise<boolean> {
  // Try ss first (iproute2 — modern Linux)
  try {
    const { stdout, exitCode } = await exec(
      ['ss', '-tln'],
      { throwOnError: false, timeout: 5000 },
    );
    if (exitCode === 0) {
      // Match :PORT at word boundary (handles IPv4 and IPv6)
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* try netstat */ }

  // Fallback: netstat (net-tools)
  try {
    const { stdout, exitCode } = await exec(
      ['netstat', '-tln'],
      { throwOnError: false, timeout: 5000 },
    );
    if (exitCode === 0) {
      const regex = new RegExp(`:${port}(\\s|$)`, 'm');
      return !regex.test(stdout);
    }
  } catch { /* neither tool available */ }

  // Can't check — assume free but warn
  return true;
}

/**
 * Map of service names to their default ports.
 */
const SERVICE_PORTS: Record<string, number> = {
  'llama-server': 8080,
  'open-webui': 3000,
  dashboard: 3001,
  searxng: 8888,
  whisper: 9000,
  tts: 8880,
  n8n: 5678,
  qdrant: 6333,
  openclaw: 7860,
  perplexica: 3004,
  comfyui: 8188,
};

/**
 * Get the list of ports that need to be free based on enabled features.
 */
export function getRequiredPorts(ctx: InstallContext): { service: string; port: number }[] {
  const ports: { service: string; port: number }[] = [
    { service: 'llama-server', port: SERVICE_PORTS['llama-server'] },
    { service: 'open-webui', port: SERVICE_PORTS['open-webui'] },
    { service: 'dashboard', port: SERVICE_PORTS.dashboard },
    { service: 'searxng', port: SERVICE_PORTS.searxng },
    { service: 'perplexica', port: SERVICE_PORTS.perplexica },
    { service: 'comfyui', port: SERVICE_PORTS.comfyui },
  ];

  if (ctx.features.voice) {
    ports.push({ service: 'whisper', port: SERVICE_PORTS.whisper });
    ports.push({ service: 'tts', port: SERVICE_PORTS.tts });
  }
  if (ctx.features.workflows) {
    ports.push({ service: 'n8n', port: SERVICE_PORTS.n8n });
  }
  if (ctx.features.rag) {
    ports.push({ service: 'qdrant', port: SERVICE_PORTS.qdrant });
  }
  if (ctx.features.openclaw) {
    ports.push({ service: 'openclaw', port: SERVICE_PORTS.openclaw });
  }

  return ports;
}

/**
 * Check all required ports and report any conflicts.
 * Returns true if all ports are free, false if any are in use.
 */
export async function checkRequiredPorts(ctx: InstallContext): Promise<boolean> {
  const required = getRequiredPorts(ctx);
  let allFree = true;
  let ssAvailable: boolean | null = null;

  for (const { service, port } of required) {
    const free = await isPortFree(port);

    // On first check, detect if ss/netstat are available
    if (ssAvailable === null) {
      try {
        await exec(['ss', '-tln'], { throwOnError: false, timeout: 2000 });
        ssAvailable = true;
      } catch {
        try {
          await exec(['netstat', '-tln'], { throwOnError: false, timeout: 2000 });
          ssAvailable = true;
        } catch {
          ssAvailable = false;
          ui.warn('Neither ss nor netstat found — cannot verify port availability');
          ui.info('Install iproute2 (for ss) or net-tools (for netstat) to enable port checks');
          return true; // Can't verify, assume OK
        }
      }
    }

    if (!free) {
      ui.warn(`Port ${port} (${service}) is already in use`);
      allFree = false;
    }
  }

  if (allFree) {
    ui.ok(`All ${required.length} required ports are available`);
  }

  return allFree;
}
