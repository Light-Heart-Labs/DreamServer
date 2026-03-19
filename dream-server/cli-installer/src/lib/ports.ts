// ── Port Availability Checks ────────────────────────────────────────────────
// Verifies required ports are free before starting services.

import { isPortFree as platformIsPortFree } from './platform.ts';
import { type InstallContext } from './config.ts';
import * as ui from './ui.ts';

/**
 * Check if a TCP port is in use.
 * Returns true if the port is FREE, false if it's in use.
 * Delegates to platform.ts for cross-platform support.
 */
export async function isPortFree(port: number): Promise<boolean> {
  return platformIsPortFree(port);
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
  const ports: { service: string; port: number }[] = [];

  // Only check llama-server port when using the built-in container
  if (ctx.llmBackend === 'llamacpp' || ctx.llmBackend === 'vllm') {
    ports.push({ service: 'llama-server', port: SERVICE_PORTS['llama-server'] });
  }

  ports.push(
    { service: 'open-webui', port: SERVICE_PORTS['open-webui'] },
    { service: 'dashboard', port: SERVICE_PORTS.dashboard },
  );

  if (ctx.features.webSearch) {
    ports.push({ service: 'searxng', port: SERVICE_PORTS.searxng });
    ports.push({ service: 'perplexica', port: SERVICE_PORTS.perplexica });
  }
  if (ctx.features.imageGen) {
    ports.push({ service: 'comfyui', port: SERVICE_PORTS.comfyui });
  }
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

  for (const { service, port } of required) {
    const free = await isPortFree(port);

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
