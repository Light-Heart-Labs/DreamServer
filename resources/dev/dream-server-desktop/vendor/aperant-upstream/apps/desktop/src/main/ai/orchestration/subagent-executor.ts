/**
 * SubagentExecutor
 * ================
 *
 * Implements the SubagentExecutor interface from spawn-subagent.ts.
 * Runs nested generateText() sessions for specialist subagents.
 *
 * Key design decisions:
 * - Uses generateText() (not streamText()) because subagent output goes back to
 *   the orchestrator's context, not to the UI stream.
 * - Subagents get their own tool set from AGENT_CONFIGS (excluding SpawnSubagent).
 * - Inherits allowedWritePaths from parent context for write containment.
 * - Step budget is capped at SUBAGENT_MAX_STEPS (default 100).
 */

import { generateText, Output, stepCountIs } from 'ai';
import type { LanguageModel, Tool as AITool } from 'ai';
import type { ZodSchema } from 'zod';

import type { SubagentExecutor, SubagentSpawnParams, SubagentResult } from '../tools/builtin/spawn-subagent';
import type { ToolContext } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import type { AgentType } from '../config/agent-configs';
import { getAgentConfig } from '../config/agent-configs';
import { ComplexityAssessmentOutputSchema } from '../schema/output/complexity-assessment.output';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of tool-use steps for a subagent */
const SUBAGENT_MAX_STEPS = 100;

// ---------------------------------------------------------------------------
// Agent type resolution helpers
// ---------------------------------------------------------------------------

/**
 * Map subagent type strings to the AgentType union.
 * Some subagent types map directly, others need translation.
 */
function resolveAgentType(subagentType: string): AgentType {
  const directMap: Record<string, AgentType> = {
    complexity_assessor: 'spec_gatherer', // Uses spec_gatherer tools + complexity assessor prompt
    spec_discovery: 'spec_discovery',
    spec_gatherer: 'spec_gatherer',
    spec_researcher: 'spec_researcher',
    spec_writer: 'spec_writer',
    spec_critic: 'spec_critic',
    spec_validation: 'spec_validation',
    planner: 'planner',
    coder: 'coder',
    qa_reviewer: 'qa_reviewer',
    qa_fixer: 'qa_fixer',
  };
  return directMap[subagentType] ?? 'spec_gatherer';
}

/**
 * Map subagent type to the prompt file name.
 */
function resolvePromptName(subagentType: string): string {
  const promptMap: Record<string, string> = {
    complexity_assessor: 'complexity_assessor',
    spec_discovery: 'spec_gatherer',
    spec_gatherer: 'spec_gatherer',
    spec_researcher: 'spec_researcher',
    spec_writer: 'spec_writer',
    spec_critic: 'spec_critic',
    spec_validation: 'spec_writer',
    planner: 'planner',
    coder: 'coder',
    qa_reviewer: 'qa_reviewer',
    qa_fixer: 'qa_fixer',
  };
  return promptMap[subagentType] ?? 'spec_writer';
}

/** Agent types that use Output.object() for structured output */
const STRUCTURED_OUTPUT_AGENTS: Partial<Record<string, ZodSchema>> = {
  complexity_assessor: ComplexityAssessmentOutputSchema,
};

// ---------------------------------------------------------------------------
// SubagentExecutorConfig
// ---------------------------------------------------------------------------

export interface SubagentExecutorConfig {
  /** Language model for subagent sessions */
  model: LanguageModel;
  /** Tool registry containing all builtin tools */
  registry: ToolRegistry;
  /** Base tool context (cwd, projectDir, specDir, securityProfile) */
  baseToolContext: ToolContext;
  /** Function to load and assemble a system prompt for a given prompt name */
  loadPrompt: (promptName: string) => Promise<string>;
  /** Abort signal from the parent orchestrator */
  abortSignal?: AbortSignal;
  /** Optional callback for subagent stream events */
  onSubagentEvent?: (agentType: string, event: string) => void;
}

// ---------------------------------------------------------------------------
// SubagentExecutorImpl
// ---------------------------------------------------------------------------

/**
 * SubagentExecutorImpl — runs nested generateText() sessions for specialist subagents.
 */
export class SubagentExecutorImpl implements SubagentExecutor {
  private readonly config: SubagentExecutorConfig;

  constructor(config: SubagentExecutorConfig) {
    this.config = config;
  }

  async spawn(params: SubagentSpawnParams): Promise<SubagentResult> {
    const startTime = Date.now();
    const agentType = resolveAgentType(params.agentType);
    const promptName = resolvePromptName(params.agentType);

    this.config.onSubagentEvent?.(params.agentType, 'spawning');

    try {
      // 1. Load system prompt for the subagent
      const systemPrompt = await this.config.loadPrompt(promptName);

      // 2. Build tool set — exclude SpawnSubagent to prevent recursion
      const subagentToolContext: ToolContext = {
        ...this.config.baseToolContext,
        abortSignal: this.config.abortSignal,
      };

      const tools: Record<string, AITool> = {};
      const agentConfig = getAgentConfig(agentType);
      for (const toolName of agentConfig.tools) {
        if (toolName === 'SpawnSubagent') continue; // No recursion
        const definedTool = this.config.registry.getTool(toolName);
        if (definedTool) {
          tools[toolName] = definedTool.bind(subagentToolContext);
        }
      }

      // 3. Build the user message with task + context
      let userMessage = `Your task: ${params.task}`;
      if (params.context) {
        userMessage += `\n\nContext:\n${params.context}`;
      }

      // 4. Determine if we should use structured output
      const outputSchema = params.expectStructuredOutput
        ? STRUCTURED_OUTPUT_AGENTS[params.agentType]
        : undefined;

      // 5. Run generateText() with the subagent configuration
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generateText overloads don't resolve with conditional output spread
      const generateOptions: any = {
        model: this.config.model,
        system: systemPrompt,
        messages: [{ role: 'user' as const, content: userMessage }],
        tools,
        stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
        abortSignal: this.config.abortSignal,
        ...(outputSchema
          ? { output: Output.object({ schema: outputSchema }) }
          : {}),
      };

      const result = await generateText(generateOptions);

      this.config.onSubagentEvent?.(params.agentType, 'completed');

      // 6. Extract results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- result.output type varies with OUTPUT generic
      const resultAny = result as any;
      const structuredOutput =
        outputSchema && resultAny.output != null
          ? (resultAny.output as Record<string, unknown>)
          : undefined;

      return {
        text: result.text || undefined,
        structuredOutput,
        stepsExecuted: result.steps?.length ?? 1,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.config.onSubagentEvent?.(params.agentType, 'failed');
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: message,
        stepsExecuted: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
