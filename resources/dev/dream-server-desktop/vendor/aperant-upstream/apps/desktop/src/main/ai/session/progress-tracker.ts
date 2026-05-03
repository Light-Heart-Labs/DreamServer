/**
 * Progress Tracker
 * ================
 * Detects execution phase transitions from tool calls and text patterns.
 * Replaces stdout parsing with structured event detection for the
 * Vercel AI SDK integration.
 *
 * Phase detection sources:
 * 1. Tool calls (e.g., Write to implementation_plan.json → planning phase)
 * 2. Text patterns in model output (fallback)
 *
 * Preserves regression prevention from phase-protocol.ts:
 * - Uses PHASE_ORDER_INDEX for ordering
 * - wouldPhaseRegress() prevents backward transitions from fallback matching
 * - Terminal phases (complete, failed) are locked
 */

import {
  type ExecutionPhase,
  PHASE_ORDER_INDEX,
  TERMINAL_PHASES,
  wouldPhaseRegress,
  isTerminalPhase,
} from '../../../shared/constants/phase-protocol';
import type { ToolCallEvent, ToolResultEvent, StreamEvent } from './types';

// =============================================================================
// Types
// =============================================================================

/** Result of a phase detection attempt */
export interface PhaseDetection {
  /** Detected phase */
  phase: ExecutionPhase;
  /** Human-readable status message */
  message: string;
  /** Current subtask identifier (if detected) */
  currentSubtask?: string;
  /** Source of detection for diagnostics */
  source: 'tool-call' | 'tool-result' | 'text-pattern';
}

/** Progress tracker state snapshot */
export interface ProgressTrackerState {
  /** Current execution phase */
  currentPhase: ExecutionPhase;
  /** Status message for the current phase */
  currentMessage: string;
  /** Current subtask being worked on */
  currentSubtask: string | null;
  /** Phases that have been completed */
  completedPhases: ExecutionPhase[];
}

// =============================================================================
// Tool Call Phase Detection Patterns
// =============================================================================

/**
 * File path patterns that indicate specific phases.
 * Checked against tool call arguments (file paths in Write/Read/Edit).
 */
const TOOL_FILE_PHASE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  phase: ExecutionPhase;
  message: string;
}> = [
  {
    pattern: /implementation_plan\.json$/,
    phase: 'planning',
    message: 'Creating implementation plan...',
  },
  {
    pattern: /qa_report\.md$/,
    phase: 'qa_review',
    message: 'Writing QA report...',
  },
  {
    pattern: /QA_FIX_REQUEST\.md$/,
    phase: 'qa_fixing',
    message: 'Processing QA fix request...',
  },
];

/**
 * Tool name patterns that indicate specific phases.
 */
const TOOL_NAME_PHASE_PATTERNS: ReadonlyArray<{
  toolName: string;
  phase: ExecutionPhase;
  message: string;
}> = [
  {
    toolName: 'update_subtask_status',
    phase: 'coding',
    message: 'Implementing subtask...',
  },
  {
    toolName: 'update_qa_status',
    phase: 'qa_review',
    message: 'Updating QA status...',
  },
];

// =============================================================================
// Text Pattern Phase Detection
// =============================================================================

/**
 * Text patterns for fallback phase detection.
 * Only used when tool call detection doesn't match.
 * Order matters: more specific patterns first.
 */
const TEXT_PHASE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  phase: ExecutionPhase;
  message: string;
}> = [
  // QA fixing (check before QA review — more specific)
  { pattern: /qa\s*fix/i, phase: 'qa_fixing', message: 'Fixing QA issues...' },
  { pattern: /fixing\s+issues/i, phase: 'qa_fixing', message: 'Fixing QA issues...' },

  // QA review
  { pattern: /qa\s*review/i, phase: 'qa_review', message: 'Running QA review...' },
  { pattern: /starting\s+qa/i, phase: 'qa_review', message: 'Running QA review...' },
  { pattern: /acceptance\s+criteria/i, phase: 'qa_review', message: 'Checking acceptance criteria...' },

  // Coding
  { pattern: /implementing\s+subtask/i, phase: 'coding', message: 'Implementing code changes...' },
  { pattern: /starting\s+coder/i, phase: 'coding', message: 'Implementing code changes...' },
  { pattern: /coder\s+agent/i, phase: 'coding', message: 'Implementing code changes...' },

  // Planning
  { pattern: /creating\s+implementation\s+plan/i, phase: 'planning', message: 'Creating implementation plan...' },
  { pattern: /planner\s+agent/i, phase: 'planning', message: 'Creating implementation plan...' },
  { pattern: /breaking.*into\s+subtasks/i, phase: 'planning', message: 'Breaking down into subtasks...' },
];

// =============================================================================
// ProgressTracker Class
// =============================================================================

/**
 * Tracks execution phase transitions from stream events.
 *
 * Consumes StreamEvent objects and detects phase changes from:
 * - Tool calls (highest priority — deterministic signals)
 * - Text patterns (fallback — heuristic matching)
 *
 * Enforces phase ordering to prevent regression.
 */
export class ProgressTracker {
  private _currentPhase: ExecutionPhase = 'idle';
  private _currentMessage = '';
  private _currentSubtask: string | null = null;
  private _completedPhases: ExecutionPhase[] = [];

  /** Get current tracker state */
  get state(): ProgressTrackerState {
    return {
      currentPhase: this._currentPhase,
      currentMessage: this._currentMessage,
      currentSubtask: this._currentSubtask,
      completedPhases: [...this._completedPhases],
    };
  }

  /** Get current phase */
  get currentPhase(): ExecutionPhase {
    return this._currentPhase;
  }

  /**
   * Process a stream event and detect phase transitions.
   *
   * @param event - Stream event from the AI SDK session
   * @returns Phase detection result if a transition occurred, null otherwise
   */
  processEvent(event: StreamEvent): PhaseDetection | null {
    switch (event.type) {
      case 'tool-call':
        return this.processToolCall(event);
      case 'tool-result':
        return this.processToolResult(event);
      case 'text-delta':
        return this.processTextDelta(event.text);
      default:
        return null;
    }
  }

  /**
   * Force-set a phase (for structured protocol events).
   * Bypasses regression checks — use only for authoritative sources.
   *
   * @param phase - Phase to set
   * @param message - Status message
   * @param subtask - Optional subtask ID
   */
  forcePhase(phase: ExecutionPhase, message: string, subtask?: string): void {
    this.transitionTo(phase, message, subtask);
  }

  /**
   * Reset tracker to initial state.
   */
  reset(): void {
    this._currentPhase = 'idle';
    this._currentMessage = '';
    this._currentSubtask = null;
    this._completedPhases = [];
  }

  // ===========================================================================
  // Private: Event Processing
  // ===========================================================================

  /**
   * Detect phase from a tool call event.
   * Tool calls are high-confidence signals for phase detection.
   */
  private processToolCall(event: ToolCallEvent): PhaseDetection | null {
    // Check tool name patterns
    for (const { toolName, phase, message } of TOOL_NAME_PHASE_PATTERNS) {
      if (event.toolName === toolName || event.toolName.endsWith(toolName)) {
        return this.tryTransition(phase, message, 'tool-call');
      }
    }

    // Check file path patterns in tool arguments
    const filePath = this.extractFilePath(event.args);
    if (filePath) {
      for (const { pattern, phase, message } of TOOL_FILE_PHASE_PATTERNS) {
        if (pattern.test(filePath)) {
          return this.tryTransition(phase, message, 'tool-call');
        }
      }
    }

    // Detect subtask from tool args when in coding phase
    if (this._currentPhase === 'coding') {
      const subtaskId = this.extractSubtaskId(event.args);
      if (subtaskId && subtaskId !== this._currentSubtask) {
        this._currentSubtask = subtaskId;
        const msg = `Working on subtask ${subtaskId}...`;
        this._currentMessage = msg;
        return { phase: 'coding', message: msg, currentSubtask: subtaskId, source: 'tool-call' };
      }
    }

    return null;
  }

  /**
   * Detect phase from a tool result event.
   * Completion of certain tools can indicate phase transitions.
   */
  private processToolResult(event: ToolResultEvent): PhaseDetection | null {
    // Failed QA status update might indicate qa_fixing
    if (
      (event.toolName === 'update_qa_status' || event.toolName.endsWith('update_qa_status')) &&
      !event.isError
    ) {
      const result = event.result;
      if (typeof result === 'object' && result !== null && 'status' in result) {
        const status = (result as Record<string, unknown>).status;
        if (status === 'failed' || status === 'issues_found') {
          return this.tryTransition('qa_fixing', 'QA found issues, fixing...', 'tool-result');
        }
        if (status === 'passed' || status === 'approved') {
          return this.tryTransition('complete', 'Build complete', 'tool-result');
        }
      }
    }

    return null;
  }

  /**
   * Detect phase from text output (fallback).
   * Only applies when not in a terminal phase.
   */
  private processTextDelta(text: string): PhaseDetection | null {
    // Terminal phases are locked
    if (isTerminalPhase(this._currentPhase)) {
      return null;
    }

    // Guard against undefined/null text (can happen with partial stream events)
    if (!text || text.length < 5) {
      return null;
    }

    for (const { pattern, phase, message } of TEXT_PHASE_PATTERNS) {
      if (pattern.test(text)) {
        return this.tryTransition(phase, message, 'text-pattern');
      }
    }

    // Detect subtask references in text when coding
    if (this._currentPhase === 'coding') {
      const subtaskMatch = text.match(/subtask[:\s]+(\d+(?:\/\d+)?|\w+[-_]\w+)/i);
      if (subtaskMatch) {
        const subtaskId = subtaskMatch[1];
        if (subtaskId !== this._currentSubtask) {
          this._currentSubtask = subtaskId;
          const msg = `Working on subtask ${subtaskId}...`;
          this._currentMessage = msg;
          return { phase: 'coding', message: msg, currentSubtask: subtaskId, source: 'text-pattern' };
        }
      }
    }

    return null;
  }

  // ===========================================================================
  // Private: Phase Transition Logic
  // ===========================================================================

  /**
   * Attempt a phase transition with regression prevention.
   * Returns detection result if transition is valid, null otherwise.
   */
  private tryTransition(
    phase: ExecutionPhase,
    message: string,
    source: PhaseDetection['source']
  ): PhaseDetection | null {
    // Terminal phases are locked
    if (isTerminalPhase(this._currentPhase)) {
      return null;
    }

    // Prevent regression (backward phase transitions)
    if (wouldPhaseRegress(this._currentPhase, phase)) {
      return null;
    }

    // Same phase with same message — no-op
    if (this._currentPhase === phase && this._currentMessage === message) {
      return null;
    }

    this.transitionTo(phase, message);
    return { phase, message, currentSubtask: this._currentSubtask ?? undefined, source };
  }

  /**
   * Execute a phase transition (no guards).
   */
  private transitionTo(phase: ExecutionPhase, message: string, subtask?: string): void {
    // Track completed phases on transition
    if (
      this._currentPhase !== 'idle' &&
      this._currentPhase !== phase &&
      !this._completedPhases.includes(this._currentPhase)
    ) {
      this._completedPhases.push(this._currentPhase);
    }

    this._currentPhase = phase;
    this._currentMessage = message;
    if (subtask !== undefined) {
      this._currentSubtask = subtask;
    }
  }

  // ===========================================================================
  // Private: Argument Extraction
  // ===========================================================================

  /**
   * Extract file path from tool call arguments.
   * Handles common argument shapes: { file_path, path, filePath }
   */
  private extractFilePath(args: Record<string, unknown>): string | null {
    const path = args.file_path ?? args.path ?? args.filePath ?? args.file ?? args.notebook_path;
    return typeof path === 'string' ? path : null;
  }

  /**
   * Extract subtask ID from tool call arguments.
   */
  private extractSubtaskId(args: Record<string, unknown>): string | null {
    const id = args.subtask_id ?? args.subtaskId;
    return typeof id === 'string' ? id : null;
  }
}
