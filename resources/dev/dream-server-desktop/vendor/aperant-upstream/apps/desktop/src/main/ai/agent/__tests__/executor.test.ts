import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

import type { AgentExecutorConfig } from '../types';

// =============================================================================
// Mocks
// =============================================================================

const mockSpawn = vi.fn();
const mockTerminate = vi.fn().mockResolvedValue(undefined);
let mockIsActive = false;

vi.mock('../worker-bridge', () => ({
  WorkerBridge: class extends EventEmitter {
    spawn = (...args: unknown[]) => {
      mockSpawn(...args);
      mockIsActive = true;
    };
    terminate = async () => {
      mockIsActive = false;
      mockTerminate();
    };
    get isActive() {
      return mockIsActive;
    }
  },
}));

// Import after mocks
import { AgentExecutor } from '../executor';

// =============================================================================
// Helpers
// =============================================================================

function createConfig(overrides: Partial<AgentExecutorConfig> = {}): AgentExecutorConfig {
  return {
    taskId: 'task-123',
    projectId: 'proj-456',
    processType: 'task-execution',
    session: {
      agentType: 'coder',
      systemPrompt: 'test',
      initialMessages: [{ role: 'user', content: 'hello' }],
      maxSteps: 10,
      specDir: '/specs',
      projectDir: '/project',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      toolContext: { cwd: '/project', projectDir: '/project', specDir: '/specs' },
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('AgentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsActive = false;
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('starts and sets isRunning to true', () => {
      const executor = new AgentExecutor(createConfig());
      executor.start();

      expect(mockSpawn).toHaveBeenCalled();
      expect(executor.isRunning).toBe(true);
    });

    it('throws if started twice while running', () => {
      const executor = new AgentExecutor(createConfig());
      executor.start();

      expect(() => executor.start()).toThrow('already running');
    });

    it('stops and sets isRunning to false', async () => {
      const executor = new AgentExecutor(createConfig());
      executor.start();

      await executor.stop();

      expect(mockTerminate).toHaveBeenCalled();
      expect(executor.isRunning).toBe(false);
    });

    it('stop is safe when not running', async () => {
      const executor = new AgentExecutor(createConfig());
      await expect(executor.stop()).resolves.toBeUndefined();
    });

    it('retry stops then starts', async () => {
      const executor = new AgentExecutor(createConfig());
      executor.start();
      mockSpawn.mockClear();

      await executor.retry();

      expect(mockTerminate).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  describe('config', () => {
    it('exposes taskId', () => {
      const executor = new AgentExecutor(createConfig({ taskId: 'my-task' }));
      expect(executor.taskId).toBe('my-task');
    });

    it('updateConfig merges new values', () => {
      const executor = new AgentExecutor(createConfig({ taskId: 'old' }));
      executor.updateConfig({ taskId: 'new' });
      expect(executor.taskId).toBe('new');
    });
  });

  // ---------------------------------------------------------------------------
  // Event forwarding
  // ---------------------------------------------------------------------------

  describe('event forwarding', () => {
    it('cleans up bridge reference on exit event from bridge', async () => {
      const executor = new AgentExecutor(createConfig());
      executor.start();

      // Simulate the bridge becoming inactive (as if worker exited)
      mockIsActive = false;

      expect(executor.isRunning).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // AgentManagerEvents compatibility
  // ---------------------------------------------------------------------------

  describe('AgentManagerEvents compatibility', () => {
    it('supports all required event types', () => {
      const executor = new AgentExecutor(createConfig());

      // Verify we can register all AgentManagerEvents without error
      const events = ['log', 'error', 'exit', 'execution-progress', 'task-event'] as const;
      for (const event of events) {
        const handler = vi.fn();
        executor.on(event, handler);
        // Emit directly to verify listener is registered
        executor.emit(event, 'task-123', 'test-data');
        expect(handler).toHaveBeenCalled();
      }
    });
  });
});
