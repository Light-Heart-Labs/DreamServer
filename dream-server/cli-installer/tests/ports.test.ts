import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { isPortFree, getRequiredPorts } from '../src/lib/ports.ts';
import { createDefaultContext, type FeatureSet } from '../src/lib/config.ts';

/** Helper: all features off */
const OFF: FeatureSet = {
  voice: false, workflows: false, rag: false, openclaw: false,
  devtools: false, imageGen: false, webSearch: false, litellm: false,
};

describe('ports.ts', () => {
  describe('getRequiredPorts()', () => {
    test('returns base ports for core-only config', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF };
      const ports = getRequiredPorts(ctx);

      // Core services: llama-server, open-webui, dashboard
      expect(ports.length).toBe(3);
      expect(ports.some(p => p.service === 'llama-server')).toBe(true);
      expect(ports.some(p => p.service === 'open-webui')).toBe(true);
      expect(ports.some(p => p.service === 'dashboard')).toBe(true);
    });

    test('adds voice ports when voice enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, voice: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'whisper')).toBe(true);
      expect(ports.some(p => p.service === 'tts')).toBe(true);
      expect(ports.length).toBe(5); // 3 base + whisper + tts
    });

    test('adds n8n port when workflows enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, workflows: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'n8n')).toBe(true);
      expect(ports.length).toBe(4); // 3 base + n8n
    });

    test('adds qdrant port when rag enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, rag: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'qdrant')).toBe(true);
      expect(ports.length).toBe(4);
    });

    test('adds openclaw port when openclaw enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, openclaw: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'openclaw')).toBe(true);
      expect(ports.length).toBe(4);
    });

    test('adds searxng and perplexica when webSearch enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, webSearch: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'searxng')).toBe(true);
      expect(ports.some(p => p.service === 'perplexica')).toBe(true);
      expect(ports.length).toBe(5); // 3 base + searxng + perplexica
    });

    test('adds comfyui when imageGen enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { ...OFF, imageGen: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'comfyui')).toBe(true);
      expect(ports.length).toBe(4); // 3 base + comfyui
    });

    test('adds all optional ports when all features enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = {
        voice: true, workflows: true, rag: true, openclaw: true,
        devtools: true, imageGen: true, webSearch: true, litellm: true,
      };
      const ports = getRequiredPorts(ctx);

      // 3 base + searxng + perplexica + comfyui + whisper + tts + n8n + qdrant + openclaw = 11
      // (devtools and litellm don't have dedicated ports)
      expect(ports.length).toBe(11);
    });

    test('returns correct default port numbers', () => {
      const ctx = createDefaultContext();
      ctx.features = {
        voice: true, workflows: true, rag: true, openclaw: true,
        devtools: true, imageGen: true, webSearch: true, litellm: true,
      };
      const ports = getRequiredPorts(ctx);

      const portMap = Object.fromEntries(ports.map(p => [p.service, p.port]));
      expect(portMap['llama-server']).toBe(8080);
      expect(portMap['open-webui']).toBe(3000);
      expect(portMap.dashboard).toBe(3001);
      expect(portMap.whisper).toBe(9000);
      expect(portMap.tts).toBe(8880);
      expect(portMap.n8n).toBe(5678);
      expect(portMap.qdrant).toBe(6333);
      expect(portMap.searxng).toBe(8888);
      expect(portMap.perplexica).toBe(3004);
      expect(portMap.comfyui).toBe(8188);
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
