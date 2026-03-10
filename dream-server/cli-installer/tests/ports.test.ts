import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { isPortFree, getRequiredPorts } from '../src/lib/ports.ts';
import { createDefaultContext } from '../src/lib/config.ts';

describe('ports.ts', () => {
  describe('getRequiredPorts()', () => {
    test('returns base ports for core-only config', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      // Core services: llama-server, open-webui, dashboard, searxng, perplexica, comfyui
      expect(ports.length).toBe(6);
      expect(ports.some(p => p.service === 'llama-server')).toBe(true);
      expect(ports.some(p => p.service === 'open-webui')).toBe(true);
      expect(ports.some(p => p.service === 'dashboard')).toBe(true);
    });

    test('adds voice ports when voice enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: false, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'whisper')).toBe(true);
      expect(ports.some(p => p.service === 'tts')).toBe(true);
      expect(ports.length).toBe(8); // 6 base + whisper + tts
    });

    test('adds n8n port when workflows enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: true, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'n8n')).toBe(true);
      expect(ports.length).toBe(7); // 6 base + n8n
    });

    test('adds qdrant port when rag enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: true, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'qdrant')).toBe(true);
      expect(ports.length).toBe(7);
    });

    test('adds openclaw port when openclaw enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: false, openclaw: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'openclaw')).toBe(true);
      expect(ports.length).toBe(7);
    });

    test('adds all optional ports when all features enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: true, rag: true, openclaw: true };
      const ports = getRequiredPorts(ctx);

      // 6 base + whisper + tts + n8n + qdrant + openclaw = 11
      expect(ports.length).toBe(11);
    });

    test('returns correct default port numbers', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: true, rag: true, openclaw: true };
      const ports = getRequiredPorts(ctx);

      const portMap = Object.fromEntries(ports.map(p => [p.service, p.port]));
      expect(portMap['llama-server']).toBe(8080);
      expect(portMap['open-webui']).toBe(3000);
      expect(portMap.dashboard).toBe(3001);
      expect(portMap.whisper).toBe(9000);
      expect(portMap.tts).toBe(8880);
      expect(portMap.n8n).toBe(5678);
      expect(portMap.qdrant).toBe(6333);
    });
  });

  describe('isPortFree()', () => {
    test('returns boolean for any port check', async () => {
      // Use a port that should be free in test env
      const result = await isPortFree(59999);
      expect(typeof result).toBe('boolean');
    });
  });
});
