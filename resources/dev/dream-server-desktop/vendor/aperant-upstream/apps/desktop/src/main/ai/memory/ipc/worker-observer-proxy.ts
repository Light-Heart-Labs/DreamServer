/**
 * WorkerObserverProxy
 *
 * Lives in the WORKER THREAD. Proxies memory-related operations to the main
 * thread via parentPort IPC, where the MemoryObserver and MemoryService live.
 *
 * Architecture:
 *   Worker thread: WorkerObserverProxy (this file)
 *     → postMessage IPC →
 *   Main thread: MemoryObserver + MemoryService
 *
 * All async operations use UUID-correlated request/response with a 3-second
 * timeout. On timeout the agent proceeds without memory (graceful degradation).
 *
 * Synchronous observation calls (onToolCall, onToolResult, etc.) post fire-and-
 * forget messages — no response required.
 */

import { MessagePort } from 'worker_threads';
import { randomUUID } from 'crypto';
import type {
  MemoryIpcRequest,
  MemoryIpcResponse,
  MemorySearchFilters,
  MemoryRecordEntry,
  Memory,
} from '../types';
import type { RecentToolCallContext, StepInjection } from '../injection/step-injection-decider';

// ============================================================
// CONSTANTS
// ============================================================

const IPC_TIMEOUT_MS = 3_000;

// ============================================================
// TYPES
// ============================================================

/**
 * Extended IPC request types for memory tool operations (search + record)
 * that require a response from the main thread.
 */
export type MemoryToolIpcRequest =
  | {
      type: 'memory:search';
      requestId: string;
      filters: MemorySearchFilters;
    }
  | {
      type: 'memory:record';
      requestId: string;
      entry: MemoryRecordEntry;
    }
  | {
      type: 'memory:step-injection-request';
      requestId: string;
      stepNumber: number;
      recentContext: SerializableRecentContext;
    };

/**
 * Serializable form of RecentToolCallContext (no Set → converted to Array).
 */
export interface SerializableRecentContext {
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  injectedMemoryIds: string[];
}

export type MemoryIpcMessage = MemoryIpcRequest | MemoryToolIpcRequest;

// ============================================================
// WORKER OBSERVER PROXY
// ============================================================

/**
 * Proxy for memory operations in the worker thread.
 * All DB operations are forwarded to the main thread.
 */
export class WorkerObserverProxy {
  private readonly port: MessagePort;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(port: MessagePort) {
    this.port = port;
    // Listen for responses from the main thread
    this.port.on('message', (msg: MemoryIpcResponse) => {
      this.handleResponse(msg);
    });
  }

  // ============================================================
  // FIRE-AND-FORGET OBSERVATION (synchronous, no response needed)
  // ============================================================

  /**
   * Notify the main thread of a tool call for observer tracking.
   * Fire-and-forget — no response needed.
   */
  onToolCall(toolName: string, args: Record<string, unknown>, stepNumber: number): void {
    this.postFireAndForget({
      type: 'memory:tool-call',
      toolName,
      args,
      stepNumber,
    });
  }

  /**
   * Notify the main thread of a tool result for observer tracking.
   * Fire-and-forget.
   */
  onToolResult(toolName: string, result: unknown, stepNumber: number): void {
    this.postFireAndForget({
      type: 'memory:tool-result',
      toolName,
      result,
      stepNumber,
    });
  }

  /**
   * Notify the main thread of a reasoning chunk.
   * Fire-and-forget.
   */
  onReasoning(text: string, stepNumber: number): void {
    this.postFireAndForget({
      type: 'memory:reasoning',
      text,
      stepNumber,
    });
  }

  /**
   * Notify the main thread that a step has completed.
   * Fire-and-forget.
   */
  onStepComplete(stepNumber: number): void {
    this.postFireAndForget({
      type: 'memory:step-complete',
      stepNumber,
    });
  }

  // ============================================================
  // ASYNC OPERATIONS (request/response with timeout)
  // ============================================================

  /**
   * Search memories via the main thread's MemoryService.
   * Returns empty array on timeout or error (graceful degradation).
   */
  async searchMemory(filters: MemorySearchFilters): Promise<Memory[]> {
    const requestId = randomUUID();
    try {
      const response = await this.sendRequest<MemoryIpcResponse>(
        { type: 'memory:search', requestId, filters },
        requestId,
      );
      if (response.type === 'memory:search-result') {
        return response.memories;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Record a memory entry via the main thread's MemoryService.
   * Returns null on timeout or error.
   */
  async recordMemory(entry: MemoryRecordEntry): Promise<string | null> {
    const requestId = randomUUID();
    try {
      const response = await this.sendRequest<MemoryIpcResponse>(
        { type: 'memory:record', requestId, entry },
        requestId,
      );
      if (response.type === 'memory:stored') {
        return response.id;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Request a step injection decision from the main thread's StepInjectionDecider.
   * Called from the runner.ts `prepareStep` callback.
   * Returns null on timeout or error (agent proceeds without injection).
   */
  async requestStepInjection(
    stepNumber: number,
    recentContext: RecentToolCallContext,
  ): Promise<StepInjection | null> {
    const requestId = randomUUID();
    const serializableContext: SerializableRecentContext = {
      toolCalls: recentContext.toolCalls,
      injectedMemoryIds: [...recentContext.injectedMemoryIds],
    };

    try {
      const response = await this.sendRequest<MemoryIpcResponse>(
        {
          type: 'memory:step-injection-request',
          requestId,
          stepNumber,
          recentContext: serializableContext,
        },
        requestId,
      );
      if (response.type === 'memory:search-result') {
        // The main thread returns injection content via a specialized response.
        // A null result is encoded as an empty memories array with a special marker.
        // See WorkerBridgeMemoryHandler for the encoding.
        return null;
      }
      // Custom injection response — encoded in the stored id field
      if (response.type === 'memory:stored') {
        // Injection encoded as JSON in the id field
        try {
          return JSON.parse(response.id) as StepInjection;
        } catch {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // PRIVATE: IPC HELPERS
  // ============================================================

  private postFireAndForget(message: MemoryIpcMessage): void {
    try {
      this.port.postMessage(message);
    } catch {
      // Worker port may be closing — ignore silently
    }
  }

  private sendRequest<T>(message: MemoryIpcMessage, requestId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Memory IPC timeout for request ${requestId}`));
      }, IPC_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      try {
        this.port.postMessage(message);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleResponse(msg: MemoryIpcResponse): void {
    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(msg.requestId);

    if (msg.type === 'memory:error') {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg);
    }
  }
}
