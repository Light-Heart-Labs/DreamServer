/**
 * Tool Types
 * ==========
 *
 * Core type definitions for the AI tool system.
 * Defines tool context, permissions, and execution options.
 */

import type { z } from 'zod/v3';

import type { SecurityProfile } from '../security/bash-validator';

// ---------------------------------------------------------------------------
// Tool Context
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to every tool execution.
 * Provides filesystem paths and security profile for the current agent session.
 */
export interface ToolContext {
  /** Current working directory for the agent */
  cwd: string;
  /** Root directory of the project being worked on */
  projectDir: string;
  /** Spec directory for the current task (e.g., .auto-claude/specs/001-feature/) */
  specDir: string;
  /** Security profile governing command allowlists */
  securityProfile: SecurityProfile;
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** If set, Write/Edit tools can only write within these directories */
  allowedWritePaths?: string[];
}

// ---------------------------------------------------------------------------
// Tool Permissions
// ---------------------------------------------------------------------------

/**
 * Permission level for a tool.
 * Controls whether the tool requires user approval before execution.
 */
export const ToolPermission = {
  /** Tool runs without any approval */
  Auto: 'auto',
  /** Tool requires user approval before each execution */
  RequiresApproval: 'requires_approval',
  /** Tool is read-only and safe to run automatically */
  ReadOnly: 'read_only',
} as const;

export type ToolPermission = (typeof ToolPermission)[keyof typeof ToolPermission];

// ---------------------------------------------------------------------------
// Tool Execution Options
// ---------------------------------------------------------------------------

/**
 * Options controlling how a tool executes.
 */
export interface ToolExecutionOptions {
  /** Timeout in milliseconds (0 = no timeout) */
  timeoutMs: number;
  /** Whether the tool can run in the background */
  allowBackground: boolean;
}

/** Default execution options */
export const DEFAULT_EXECUTION_OPTIONS: ToolExecutionOptions = {
  timeoutMs: 120_000,
  allowBackground: false,
};

// ---------------------------------------------------------------------------
// Tool Definition Shape
// ---------------------------------------------------------------------------

/**
 * Metadata for a defined tool, used by the registry and define wrapper.
 */
export interface ToolMetadata {
  /** Unique tool name (e.g., 'Read', 'Bash', 'Glob') */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** Permission level */
  permission: ToolPermission;
  /** Default execution options */
  executionOptions: ToolExecutionOptions;
}

/**
 * Configuration passed to Tool.define() to create a tool.
 *
 * @typeParam TInput - Zod schema type for the tool's input
 * @typeParam TOutput - Return type of the execute function
 */
export interface ToolDefinitionConfig<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
> {
  /** Tool metadata */
  metadata: ToolMetadata;
  /** Zod v3 schema for input validation */
  inputSchema: TInput;
  /** Execute function called with validated input and tool context */
  execute: (
    input: z.infer<TInput>,
    context: ToolContext,
  ) => Promise<TOutput> | TOutput;
}
