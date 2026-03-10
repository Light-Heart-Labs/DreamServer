import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { checkServiceHealth } from '../src/phases/health.ts';

// Mock fetch globally for health check tests
const originalFetch = globalThis.fetch;

describe('health.ts', () => {
  describe('checkServiceHealth()', () => {
    test('returns true when service responds with 200', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('OK', { status: 200 }))
      ) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 4);
      expect(result).toBe(true);

      globalThis.fetch = originalFetch;
    });

    test('returns true when service responds with 401', async () => {
      // Some services like Open WebUI return 401 when healthy but unauthenticated
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      ) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 4);
      expect(result).toBe(true);

      globalThis.fetch = originalFetch;
    });

    test('returns false when service never responds', async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error('Connection refused'))
      ) as any;

      // Short timeout to keep test fast
      const result = await checkServiceHealth('test', 'http://localhost:9999', 2);
      expect(result).toBe(false);

      globalThis.fetch = originalFetch;
    });

    test('retries and succeeds when service becomes available', async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      }) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 10);
      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);

      globalThis.fetch = originalFetch;
    });
  });
});
