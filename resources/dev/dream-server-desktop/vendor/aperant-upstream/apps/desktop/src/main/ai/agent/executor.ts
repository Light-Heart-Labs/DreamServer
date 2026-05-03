/**
 * Agent Executor
 * ==============
 *
 * Wraps the WorkerBridge to provide a high-level agent lifecycle API:
 * - start(): Spawn a worker and begin execution
 * - stop(): Gracefully terminate the running session
 * - retry(): Stop and restart with the same configuration
 *
 * The executor manages a single agent session at a time and exposes
 * the same event interface as AgentManagerEvents for seamless integration
 * with the existing agent management system.
 */

import { EventEmitter } from 'events';

import { WorkerBridge } from './worker-bridge';
import type { AgentExecutorConfig } from './types';
import type { AgentManagerEvents } from '../../agent/types';

// =============================================================================
// AgentExecutor
// =============================================================================

export class AgentExecutor extends EventEmitter {
  private bridge: WorkerBridge | null = null;
  private config: AgentExecutorConfig;

  constructor(config: AgentExecutorConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the agent session in a worker thread.
   * Events are forwarded from the worker bridge to this executor's listeners.
   *
   * @throws If a session is already running
   */
  start(): void {
    if (this.bridge?.isActive) {
      throw new Error(`Agent executor for task ${this.config.taskId} is already running`);
    }

    this.bridge = new WorkerBridge();

    // Forward all events from the bridge
    this.forwardEvents(this.bridge);

    // Spawn the worker
    this.bridge.spawn(this.config);
  }

  /**
   * Stop the currently running agent session.
   * Sends an abort signal then terminates the worker thread.
   */
  async stop(): Promise<void> {
    if (!this.bridge) return;

    await this.bridge.terminate();
    this.bridge = null;
  }

  /**
   * Stop the current session and restart with the same configuration.
   * Useful for recovering from transient errors.
   */
  async retry(): Promise<void> {
    await this.stop();
    this.start();
  }

  /**
   * Update the configuration for future start/retry calls.
   * Does not affect a currently running session.
   */
  updateConfig(config: Partial<AgentExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Whether the executor has an active worker session */
  get isRunning(): boolean {
    return this.bridge?.isActive ?? false;
  }

  /** The task ID this executor is managing */
  get taskId(): string {
    return this.config.taskId;
  }

  // ===========================================================================
  // Event Forwarding
  // ===========================================================================

  /**
   * Forward all AgentManagerEvents from the bridge to this executor.
   */
  private forwardEvents(bridge: WorkerBridge): void {
    const events: (keyof AgentManagerEvents)[] = [
      'log',
      'error',
      'exit',
      'execution-progress',
      'task-event',
    ];

    for (const event of events) {
      bridge.on(event, (...args: unknown[]) => {
        this.emit(event, ...args);
      });
    }

    // Clean up bridge reference on exit
    bridge.on('exit', () => {
      this.bridge = null;
    });
  }
}
