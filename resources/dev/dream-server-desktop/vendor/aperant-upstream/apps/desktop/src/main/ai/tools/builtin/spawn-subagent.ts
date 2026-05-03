/**
 * SpawnSubagent Tool
 * ==================
 *
 * Allows orchestrator agents (spec_orchestrator, build_orchestrator) to spawn
 * nested specialist agent sessions within their own streamText() loop.
 *
 * Subagents CANNOT access this tool (no recursion).
 * The tool delegates to a SubagentExecutor provided via the ToolContext's
 * subagentExecutor property. If no executor is available, returns a graceful
 * error (for non-agentic sessions).
 */

import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';
import type { ToolContext } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const SpawnSubagentInputSchema = z.object({
  agent_type: z
    .enum([
      'complexity_assessor',
      'spec_discovery',
      'spec_gatherer',
      'spec_researcher',
      'spec_writer',
      'spec_critic',
      'spec_validation',
      'planner',
      'coder',
      'qa_reviewer',
      'qa_fixer',
    ])
    .describe('The type of specialist subagent to spawn'),
  task: z.string().describe('Clear description of what the subagent should accomplish'),
  context: z
    .string()
    .nullable()
    .describe(
      'Additional context to pass to the subagent (accumulated findings, prior outputs, etc.)',
    ),
  expect_structured_output: z
    .boolean()
    .describe('Whether to expect structured JSON output from the subagent'),
});

export type SpawnSubagentInput = z.infer<typeof SpawnSubagentInputSchema>;

// ---------------------------------------------------------------------------
// SubagentExecutor Interface
// ---------------------------------------------------------------------------

/**
 * Interface for the SubagentExecutor that the tool delegates to.
 * Implemented in orchestration/subagent-executor.ts.
 */
export interface SubagentExecutor {
  spawn(params: SubagentSpawnParams): Promise<SubagentResult>;
}

export interface SubagentSpawnParams {
  agentType: string;
  task: string;
  context?: string;
  expectStructuredOutput: boolean;
}

export interface SubagentResult {
  text?: string;
  structuredOutput?: Record<string, unknown>;
  error?: string;
  stepsExecuted: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/**
 * SpawnSubagent tool — allows orchestrator agents to spawn nested specialist agent sessions.
 *
 * Only available to orchestrator agent types (spec_orchestrator, build_orchestrator).
 * Subagents CANNOT access this tool (no recursion).
 *
 * The tool delegates to a SubagentExecutor provided via the ToolContext's
 * subagentExecutor property. If no executor is available, the tool returns
 * an error message (graceful degradation for non-agentic sessions).
 */
export const spawnSubagentTool = Tool.define({
  metadata: {
    name: 'SpawnSubagent',
    description: `Spawn a specialist subagent to perform a focused task. The subagent runs independently with its own tools and system prompt. You receive the subagent's text output (or structured data) back in your context.

Available subagent types:
- complexity_assessor: Assess task complexity (simple/standard/complex). Returns structured JSON.
- spec_discovery: Analyze project structure, tech stack, conventions. Writes context.json.
- spec_gatherer: Gather and validate requirements from task description. Writes requirements.json.
- spec_researcher: Research implementation approaches, external APIs, libraries. Writes research.json.
- spec_writer: Write the specification (spec.md) and implementation plan. Writes files.
- spec_critic: Review spec for completeness, technical feasibility, gaps.
- spec_validation: Final validation of spec.md and implementation_plan.json.
- planner: Create implementation plan with subtasks.
- coder: Implement code changes.
- qa_reviewer: Review implementation against specification.
- qa_fixer: Fix issues found by qa_reviewer.

Tips:
- Pass accumulated context from prior subagents to avoid redundant work.
- Keep context concise — summarize large outputs (>10KB).
- Use expect_structured_output=true for complexity_assessor (returns JSON).`,
    permission: ToolPermission.Auto,
    executionOptions: {
      ...DEFAULT_EXECUTION_OPTIONS,
      timeoutMs: 600_000, // 10 minutes — subagents can take a while
    },
  },
  inputSchema: SpawnSubagentInputSchema,
  execute: async (input: SpawnSubagentInput, context: ToolContext): Promise<string> => {
    // Access the SubagentExecutor from the tool context via extension cast
    const executor = (context as ToolContext & { subagentExecutor?: SubagentExecutor })
      .subagentExecutor;

    if (!executor) {
      return 'Error: SpawnSubagent is not available in this session. This tool is only available when running in agentic orchestration mode.';
    }

    try {
      const result = await executor.spawn({
        agentType: input.agent_type,
        task: input.task,
        context: input.context ?? undefined,
        expectStructuredOutput: input.expect_structured_output,
      });

      if (result.error) {
        return `Subagent (${input.agent_type}) failed: ${result.error}`;
      }

      if (result.structuredOutput) {
        return `Subagent (${input.agent_type}) completed successfully.\n\nStructured output:\n\`\`\`json\n${JSON.stringify(result.structuredOutput, null, 2)}\n\`\`\``;
      }

      return `Subagent (${input.agent_type}) completed successfully.\n\nOutput:\n${result.text ?? '(no text output)'}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Subagent (${input.agent_type}) execution error: ${message}`;
    }
  },
});
