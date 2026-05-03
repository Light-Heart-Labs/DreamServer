import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStreamHandler } from '../stream-handler';
import type { StreamEvent } from '../types';

describe('createStreamHandler', () => {
  let events: StreamEvent[];
  let onEvent: (event: StreamEvent) => void;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
  });

  // ===========================================================================
  // Text Delta (AI SDK v6: type='text-delta', field='text')
  // ===========================================================================

  describe('text-delta', () => {
    it('should emit text-delta events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'text-delta', text: 'Hello' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    });

    it('should emit multiple text-delta events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'text-delta', text: 'Hello' });
      handler.processPart({ type: 'text-delta', text: ' world' });

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'text-delta', text: ' world' });
    });
  });

  // ===========================================================================
  // Reasoning (AI SDK v6: type='reasoning-delta', field='delta')
  // ===========================================================================

  describe('reasoning-delta', () => {
    it('should emit thinking-delta events for reasoning-delta parts', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'reasoning-delta', delta: 'Let me think...' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'thinking-delta', text: 'Let me think...' });
    });
  });

  // ===========================================================================
  // Tool Call (AI SDK v6: type='tool-call', fields: toolCallId, toolName, input)
  // ===========================================================================

  describe('tool-call', () => {
    it('should emit tool-call events and increment tool count', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({
        type: 'tool-call',
        toolName: 'Bash',
        toolCallId: 'call-1',
        input: { command: 'ls' },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool-call',
        toolName: 'Bash',
        toolCallId: 'call-1',
        args: { command: 'ls' },
      });
      expect(handler.getSummary().toolCallCount).toBe(1);
    });

    it('should track multiple tool calls', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', input: {} });
      handler.processPart({ type: 'tool-call', toolName: 'Read', toolCallId: 'c2', input: {} });
      handler.processPart({ type: 'tool-call', toolName: 'Write', toolCallId: 'c3', input: {} });

      expect(handler.getSummary().toolCallCount).toBe(3);
    });
  });

  // ===========================================================================
  // Tool Result (AI SDK v6: type='tool-result', fields: toolCallId, toolName, output)
  // ===========================================================================

  describe('tool-result', () => {
    it('should emit tool-result with duration from matching tool call', () => {
      const handler = createStreamHandler(onEvent);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValueOnce(now + 150);

      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', input: {} });
      events.length = 0; // clear tool-call event

      handler.processPart({
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'Bash',
        input: {},
        output: 'output',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool-result',
        toolName: 'Bash',
        toolCallId: 'c1',
        result: 'output',
        durationMs: 150,
        isError: false,
      });

      vi.restoreAllMocks();
    });

    it('should handle tool-result without matching tool-call (durationMs = 0)', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({
        type: 'tool-result',
        toolCallId: 'unknown',
        toolName: 'Bash',
        input: {},
        output: 'ok',
      });

      expect(events[0]).toMatchObject({ type: 'tool-result', durationMs: 0 });
    });
  });

  // ===========================================================================
  // Tool Error (AI SDK v6: type='tool-error', fields: toolCallId, toolName, error)
  // ===========================================================================

  describe('tool-error', () => {
    it('should emit error event for tool failures', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', input: {} });
      events.length = 0;

      handler.processPart({
        type: 'tool-error',
        toolCallId: 'c1',
        toolName: 'Bash',
        error: new Error('command not found'),
      });

      // tool-result + error event
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'tool-result', isError: true });
      expect(events[1]).toMatchObject({ type: 'error' });
      expect((events[1] as { type: 'error'; error: { code: string } }).error.code).toBe('tool_execution_error');
    });
  });

  // ===========================================================================
  // Step Finish (AI SDK v6: type='finish-step', usage.promptTokens/completionTokens)
  // ===========================================================================

  describe('finish-step', () => {
    it('should increment step count and accumulate usage', () => {
      const handler = createStreamHandler(onEvent);

      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      // step-finish + usage-update
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'step-finish', stepNumber: 1 });
      expect(events[1]).toMatchObject({
        type: 'usage-update',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(handler.getSummary().stepsExecuted).toBe(1);
    });

    it('should accumulate usage across multiple steps', () => {
      const handler = createStreamHandler(onEvent);

      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 100, completionTokens: 50 },
      });
      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 200, completionTokens: 80 },
      });

      const summary = handler.getSummary();
      expect(summary.stepsExecuted).toBe(2);
      expect(summary.usage).toEqual({
        promptTokens: 300,
        completionTokens: 130,
        totalTokens: 430,
      });
    });

    it('should handle missing usage gracefully', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'finish-step' });

      expect(handler.getSummary().stepsExecuted).toBe(1);
      expect(handler.getSummary().usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });
  });

  // ===========================================================================
  // Error (AI SDK v6: type='error', field='error')
  // ===========================================================================

  describe('error', () => {
    it('should classify and emit error events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'error', error: new Error('429 too many requests') });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'error' });
      expect((events[0] as { type: 'error'; error: { code: string } }).error.code).toBe('rate_limited');
    });
  });

  // ===========================================================================
  // Ignored parts
  // ===========================================================================

  describe('ignored part types', () => {
    it('should ignore unknown/lifecycle part types without crashing', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'text-start', id: 'text-1' });
      handler.processPart({ type: 'text-end', id: 'text-1' });
      handler.processPart({ type: 'start-step' });
      handler.processPart({ type: 'start', messageId: 'msg-1' });
      handler.processPart({ type: 'finish' });
      handler.processPart({ type: 'reasoning-start', id: 'r-1' });
      handler.processPart({ type: 'reasoning-end', id: 'r-1' });
      handler.processPart({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'Bash' });
      handler.processPart({ type: 'tool-input-delta', toolCallId: 'c1', inputTextDelta: '{}' });

      expect(events).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe('getSummary', () => {
    it('should return initial state when no parts processed', () => {
      const handler = createStreamHandler(onEvent);
      expect(handler.getSummary()).toEqual({
        stepsExecuted: 0,
        toolCallCount: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    });
  });

  // ===========================================================================
  // Multi-step conversation with tool calls
  // ===========================================================================

  describe('multi-step conversation', () => {
    it('should track a full multi-step conversation with tool calls', () => {
      const handler = createStreamHandler(onEvent);

      // Step 1: text + tool call + tool result + step finish
      handler.processPart({ type: 'text-delta', text: 'Let me check...' });
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', input: { command: 'ls' } });
      handler.processPart({ type: 'tool-result', toolCallId: 'c1', toolName: 'Bash', input: { command: 'ls' }, output: 'file.ts' });
      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      // Step 2: another tool call
      handler.processPart({ type: 'tool-call', toolName: 'Read', toolCallId: 'c2', input: { file_path: 'file.ts' } });
      handler.processPart({ type: 'tool-result', toolCallId: 'c2', toolName: 'Read', input: { file_path: 'file.ts' }, output: 'content' });
      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 200, completionTokens: 100 },
      });

      // Step 3: text only
      handler.processPart({ type: 'text-delta', text: 'Here is the result.' });
      handler.processPart({
        type: 'finish-step',
        usage: { promptTokens: 150, completionTokens: 60 },
      });

      const summary = handler.getSummary();
      expect(summary.stepsExecuted).toBe(3);
      expect(summary.toolCallCount).toBe(2);
      expect(summary.usage).toEqual({
        promptTokens: 450,
        completionTokens: 210,
        totalTokens: 660,
      });
    });
  });
});
