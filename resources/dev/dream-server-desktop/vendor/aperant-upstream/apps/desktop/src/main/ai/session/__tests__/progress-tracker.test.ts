import { describe, it, expect, beforeEach } from 'vitest';

import { ProgressTracker } from '../progress-tracker';
import type { StreamEvent } from '../types';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  // ===========================================================================
  // Initial State
  // ===========================================================================

  describe('initial state', () => {
    it('should start in idle phase', () => {
      expect(tracker.currentPhase).toBe('idle');
      expect(tracker.state.currentMessage).toBe('');
      expect(tracker.state.currentSubtask).toBeNull();
      expect(tracker.state.completedPhases).toEqual([]);
    });
  });

  // ===========================================================================
  // Tool Call Phase Detection
  // ===========================================================================

  describe('tool call detection', () => {
    it('should detect planning from implementation_plan.json write', () => {
      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'Write',
        toolCallId: 'c1',
        args: { file_path: '/project/.auto-claude/specs/001/implementation_plan.json' },
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('planning');
      expect(result!.source).toBe('tool-call');
      expect(tracker.currentPhase).toBe('planning');
    });

    it('should detect qa_review from qa_report.md write', () => {
      // First advance to coding
      tracker.forcePhase('coding', 'Coding...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'Write',
        toolCallId: 'c1',
        args: { path: '/project/qa_report.md' },
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_review');
    });

    it('should detect qa_fixing from QA_FIX_REQUEST.md', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'Read',
        toolCallId: 'c1',
        args: { filePath: '/project/QA_FIX_REQUEST.md' },
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_fixing');
    });

    it('should detect coding from update_subtask_status tool', () => {
      tracker.forcePhase('planning', 'Planning...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'update_subtask_status',
        toolCallId: 'c1',
        args: { subtask_id: 'subtask-1' },
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('coding');
    });

    it('should detect qa_review from update_qa_status tool', () => {
      tracker.forcePhase('coding', 'Coding...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'update_qa_status',
        toolCallId: 'c1',
        args: {},
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_review');
    });

    it('should detect subtask changes in coding phase from non-phase tools', () => {
      tracker.forcePhase('coding', 'Coding...');

      // Use a generic tool that has subtask_id in args (not a phase-detection tool)
      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'Write',
        toolCallId: 'c1',
        args: { file_path: '/project/src/index.ts', subtask_id: 'subtask-2' },
      });

      expect(result).not.toBeNull();
      expect(result!.currentSubtask).toBe('subtask-2');
      expect(tracker.state.currentSubtask).toBe('subtask-2');
    });
  });

  // ===========================================================================
  // Tool Result Phase Detection
  // ===========================================================================

  describe('tool result detection', () => {
    it('should detect qa_fixing from failed QA status', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'tool-result',
        toolName: 'update_qa_status',
        toolCallId: 'c1',
        result: { status: 'failed' },
        durationMs: 100,
        isError: false,
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_fixing');
    });

    it('should detect complete from passed QA status', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'tool-result',
        toolName: 'update_qa_status',
        toolCallId: 'c1',
        result: { status: 'passed' },
        durationMs: 100,
        isError: false,
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('complete');
    });

    it('should ignore error tool results for QA status', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'tool-result',
        toolName: 'update_qa_status',
        toolCallId: 'c1',
        result: { status: 'passed' },
        durationMs: 100,
        isError: true,
      });

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Text Pattern Detection
  // ===========================================================================

  describe('text pattern detection', () => {
    it('should detect planning from text', () => {
      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Creating implementation plan for the project...',
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('planning');
      expect(result!.source).toBe('text-pattern');
    });

    it('should detect coding from text', () => {
      tracker.forcePhase('planning', 'Planning...');

      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Implementing subtask changes now.',
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('coding');
    });

    it('should detect qa_review from text', () => {
      tracker.forcePhase('coding', 'Coding...');

      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Starting QA review process.',
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_review');
    });

    it('should detect qa_fixing from text', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Now QA fixing the issues found.',
      });

      expect(result).not.toBeNull();
      expect(result!.phase).toBe('qa_fixing');
    });

    it('should ignore very short text fragments', () => {
      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'QA',
      });

      expect(result).toBeNull();
    });

    it('should detect subtask references in text during coding', () => {
      tracker.forcePhase('coding', 'Coding...');

      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Working on subtask: 3/5 now',
      });

      expect(result).not.toBeNull();
      expect(result!.currentSubtask).toBe('3/5');
    });
  });

  // ===========================================================================
  // Regression Prevention
  // ===========================================================================

  describe('regression prevention', () => {
    it('should prevent backward phase transitions', () => {
      tracker.forcePhase('coding', 'Coding...');

      // Try to regress to planning via text pattern
      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Creating implementation plan for another thing.',
      });

      expect(result).toBeNull();
      expect(tracker.currentPhase).toBe('coding');
    });

    it('should prevent regression from qa_review to coding', () => {
      tracker.forcePhase('qa_review', 'Reviewing...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'update_subtask_status',
        toolCallId: 'c1',
        args: {},
      });

      expect(result).toBeNull();
      expect(tracker.currentPhase).toBe('qa_review');
    });

    it('should allow forward transitions', () => {
      tracker.forcePhase('planning', 'Planning...');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'update_subtask_status',
        toolCallId: 'c1',
        args: {},
      });

      expect(result).not.toBeNull();
      expect(tracker.currentPhase).toBe('coding');
    });
  });

  // ===========================================================================
  // Terminal Phase Locking
  // ===========================================================================

  describe('terminal phase locking', () => {
    it('should not allow transitions from complete', () => {
      tracker.forcePhase('complete', 'Done');

      const result = tracker.processEvent({
        type: 'text-delta',
        text: 'Starting QA review again.',
      });

      expect(result).toBeNull();
      expect(tracker.currentPhase).toBe('complete');
    });

    it('should not allow transitions from failed', () => {
      tracker.forcePhase('failed', 'Failed');

      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'update_subtask_status',
        toolCallId: 'c1',
        args: {},
      });

      expect(result).toBeNull();
      expect(tracker.currentPhase).toBe('failed');
    });
  });

  // ===========================================================================
  // Completed Phases Tracking
  // ===========================================================================

  describe('completed phases tracking', () => {
    it('should track completed phases on transitions', () => {
      tracker.forcePhase('planning', 'Planning...');
      tracker.forcePhase('coding', 'Coding...');
      tracker.forcePhase('qa_review', 'Reviewing...');

      expect(tracker.state.completedPhases).toEqual(['planning', 'coding']);
    });

    it('should not add idle to completed phases', () => {
      tracker.forcePhase('planning', 'Planning...');
      expect(tracker.state.completedPhases).toEqual([]);
    });
  });

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe('reset', () => {
    it('should reset to initial state', () => {
      tracker.forcePhase('coding', 'Coding...', 'subtask-1');
      tracker.reset();

      expect(tracker.currentPhase).toBe('idle');
      expect(tracker.state.currentMessage).toBe('');
      expect(tracker.state.currentSubtask).toBeNull();
      expect(tracker.state.completedPhases).toEqual([]);
    });
  });

  // ===========================================================================
  // No-op for unrelated events
  // ===========================================================================

  describe('unrelated events', () => {
    it('should return null for step-finish events', () => {
      const result = tracker.processEvent({
        type: 'step-finish',
        stepNumber: 1,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(result).toBeNull();
    });

    it('should return null for error events', () => {
      const result = tracker.processEvent({
        type: 'error',
        error: { code: 'generic_error', message: 'fail', retryable: false },
      });
      expect(result).toBeNull();
    });

    it('should return null for usage-update events', () => {
      const result = tracker.processEvent({
        type: 'usage-update',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Same phase same message no-op
  // ===========================================================================

  describe('deduplication', () => {
    it('should not re-emit same phase and message', () => {
      tracker.forcePhase('planning', 'Creating implementation plan...');

      // Try to transition to same phase with same message via tool call
      const result = tracker.processEvent({
        type: 'tool-call',
        toolName: 'Write',
        toolCallId: 'c2',
        args: { file_path: '/project/implementation_plan.json' },
      });

      expect(result).toBeNull();
    });
  });
});
