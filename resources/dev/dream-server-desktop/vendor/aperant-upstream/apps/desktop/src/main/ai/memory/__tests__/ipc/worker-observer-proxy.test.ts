/**
 * WorkerObserverProxy Tests
 *
 * Tests IPC request/response correlation, timeout handling,
 * and fire-and-forget observation calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessagePort } from 'worker_threads';
import { WorkerObserverProxy } from '../../ipc/worker-observer-proxy';
import type { MemoryIpcResponse, Memory } from '../../types';

// ============================================================
// HELPERS
// ============================================================

function makeMemory(): Memory {
  return {
    id: 'mem-1',
    type: 'gotcha',
    content: 'Use refreshToken() before API calls',
    confidence: 0.9,
    tags: [],
    relatedFiles: [],
    relatedModules: [],
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    scope: 'module',
    source: 'agent_explicit',
    sessionId: 'sess-1',
    provenanceSessionIds: [],
    projectId: 'proj-1',
  };
}

// ============================================================
// MOCK MESSAGE PORT
// ============================================================

function makeMockPort() {
  const listeners = new Map<string, ((msg: unknown) => void)[]>();
  const sentMessages: unknown[] = [];

  const port = {
    postMessage: vi.fn((msg: unknown) => {
      sentMessages.push(msg);
    }),
    on: (event: string, listener: (msg: unknown) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    },
    emit: (event: string, msg: unknown) => {
      const ls = listeners.get(event) ?? [];
      for (const l of ls) l(msg);
    },
    sentMessages,
  };

  return port;
}

// Helper: schedule a response after postMessage is called.
// The mock replaces postMessage so it intercepts the message, captures
// the requestId from the message param directly, then emits the response.
function setupResponseMock(
  mockPort: ReturnType<typeof makeMockPort>,
  makeResponse: (requestId: string) => MemoryIpcResponse,
) {
  mockPort.postMessage.mockImplementationOnce((msg: unknown) => {
    // Push to sentMessages manually (mirrors default vi.fn behavior)
    mockPort.sentMessages.push(msg);
    const requestId = (msg as Record<string, unknown>).requestId as string;
    const response = makeResponse(requestId);
    mockPort.emit('message', response);
  });
}

// ============================================================
// TESTS
// ============================================================

describe('WorkerObserverProxy', () => {
  let mockPort: ReturnType<typeof makeMockPort>;
  let proxy: WorkerObserverProxy;

  beforeEach(() => {
    mockPort = makeMockPort();
    proxy = new WorkerObserverProxy(mockPort as unknown as MessagePort);
  });

  describe('fire-and-forget observation methods', () => {
    it('onToolCall posts a memory:tool-call message', () => {
      proxy.onToolCall('Read', { file_path: '/src/auth.ts' }, 3);

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory:tool-call',
          toolName: 'Read',
          args: { file_path: '/src/auth.ts' },
          stepNumber: 3,
        }),
      );
    });

    it('onToolResult posts a memory:tool-result message', () => {
      proxy.onToolResult('Read', 'file contents', 3);

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory:tool-result',
          toolName: 'Read',
          result: 'file contents',
          stepNumber: 3,
        }),
      );
    });

    it('onReasoning posts a memory:reasoning message', () => {
      proxy.onReasoning('I should check the imports first.', 2);

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory:reasoning',
          text: 'I should check the imports first.',
          stepNumber: 2,
        }),
      );
    });

    it('onStepComplete posts a memory:step-complete message', () => {
      proxy.onStepComplete(7);

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory:step-complete',
          stepNumber: 7,
        }),
      );
    });

    it('does not throw when postMessage fails', () => {
      mockPort.postMessage.mockImplementationOnce(() => {
        throw new Error('Port closed');
      });

      expect(() => proxy.onToolCall('Read', {}, 1)).not.toThrow();
    });
  });

  describe('searchMemory()', () => {
    it('sends a memory:search message and resolves with memories on success', async () => {
      const memories: Memory[] = [makeMemory()];

      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:search-result',
        requestId,
        memories,
      }));

      const result = await proxy.searchMemory({ query: 'auth token', projectId: 'proj-1' });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Use refreshToken() before API calls');
    });

    it('returns empty array on error response', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:error',
        requestId,
        error: 'Service unavailable',
      }));

      const result = await proxy.searchMemory({ query: 'test', projectId: 'proj-1' });

      expect(result).toEqual([]);
    });

    it('returns empty array when postMessage throws', async () => {
      mockPort.postMessage.mockImplementationOnce(() => {
        throw new Error('Port closed');
      });

      const result = await proxy.searchMemory({ query: 'test', projectId: 'proj-1' });
      expect(result).toEqual([]);
    });
  });

  describe('recordMemory()', () => {
    it('sends a memory:record message and resolves with ID on success', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:stored',
        requestId,
        id: 'new-mem-123',
      }));

      const id = await proxy.recordMemory({
        type: 'gotcha',
        content: 'Always check null before .id',
        projectId: 'proj-1',
      });

      expect(id).toBe('new-mem-123');
    });

    it('returns null on error response', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:error',
        requestId,
        error: 'Write failed',
      }));

      const id = await proxy.recordMemory({
        type: 'gotcha',
        content: 'test',
        projectId: 'proj-1',
      });

      expect(id).toBeNull();
    });
  });

  describe('requestStepInjection()', () => {
    it('returns null when server responds with empty search result', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:search-result',
        requestId,
        memories: [],
      }));

      const injection = await proxy.requestStepInjection(5, {
        toolCalls: [{ toolName: 'Read', args: { file_path: '/src/auth.ts' } }],
        injectedMemoryIds: new Set(),
      });

      expect(injection).toBeNull();
    });

    it('returns null on error response', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:error',
        requestId,
        error: 'StepInjectionDecider failed',
      }));

      const injection = await proxy.requestStepInjection(5, {
        toolCalls: [],
        injectedMemoryIds: new Set(),
      });

      expect(injection).toBeNull();
    });

    it('sends serializable context (converts Set to Array)', async () => {
      setupResponseMock(mockPort, (requestId) => ({
        type: 'memory:search-result',
        requestId,
        memories: [],
      }));

      await proxy.requestStepInjection(5, {
        toolCalls: [{ toolName: 'Grep', args: { pattern: 'foo' } }],
        injectedMemoryIds: new Set(['id-1', 'id-2']),
      });

      // sentMessages has 1 entry pushed by setupResponseMock
      const sentMsg = mockPort.sentMessages[0] as Record<string, unknown>;
      const ctx = sentMsg.recentContext as { injectedMemoryIds: unknown };
      // Should be an Array, not a Set (Set isn't serializable via postMessage)
      expect(Array.isArray(ctx.injectedMemoryIds)).toBe(true);
      expect(ctx.injectedMemoryIds).toContain('id-1');
    });
  });

  describe('response correlation', () => {
    it('correctly routes concurrent responses by requestId', async () => {
      const responses: MemoryIpcResponse[] = [];
      let callCount = 0;

      mockPort.postMessage.mockImplementation((msg: unknown) => {
        // Push to sentMessages manually
        mockPort.sentMessages.push(msg);
        callCount++;
        const reqId = (msg as Record<string, unknown>).requestId as string;
        setTimeout(() => {
          const response: MemoryIpcResponse = {
            type: 'memory:stored',
            requestId: reqId,
            id: `result-for-${reqId.slice(0, 8)}`,
          };
          responses.push(response);
          mockPort.emit('message', response);
        }, 0);
      });

      const [id1, id2] = await Promise.all([
        proxy.recordMemory({ type: 'gotcha', content: 'memory 1', projectId: 'p1' }),
        proxy.recordMemory({ type: 'gotcha', content: 'memory 2', projectId: 'p1' }),
      ]);

      // Both should resolve with different IDs
      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
      expect(id1).not.toBe(id2);
    });
  });
});
