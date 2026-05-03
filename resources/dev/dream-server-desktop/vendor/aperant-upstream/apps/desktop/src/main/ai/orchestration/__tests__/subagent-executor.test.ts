import { describe, it, expect, vi } from 'vitest';

import { SubagentExecutorImpl } from '../subagent-executor';
import type { ToolRegistry } from '../../tools/registry';
import type { ToolContext } from '../../tools/types';

// Mock the generateText function
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Task completed',
    steps: [{ toolCalls: [] }],
    output: null,
  }),
  Output: {
    object: vi.fn((opts: unknown) => opts),
  },
  stepCountIs: vi.fn((n: number) => ({ type: 'stepCount', count: n })),
}));

// Mock agent configs
vi.mock('../../config/agent-configs', () => ({
  getAgentConfig: vi.fn(() => ({
    tools: ['Read', 'Glob', 'Grep', 'Write'],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  })),
}));

describe('SubagentExecutorImpl', () => {
  const mockToolContext: ToolContext = {
    cwd: '/test',
    projectDir: '/test/project',
    specDir: '/test/specs/001',
    securityProfile: {
      baseCommands: new Set(),
      stackCommands: new Set(),
      scriptCommands: new Set(),
      customCommands: new Set(),
      customScripts: { shellScripts: [] },
      getAllAllowedCommands: () => new Set(),
    },
  } as unknown as ToolContext;

  const mockRegistry = {
    getTool: vi.fn((name: string) => ({
      bind: vi.fn(() => ({ type: 'tool', name })),
      metadata: { name },
    })),
    getToolsForAgent: vi.fn(() => ({})),
  } as unknown as ToolRegistry;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock model for testing
  const mockModel = { modelId: 'test-model' } as any;

  const createExecutor = () =>
    new SubagentExecutorImpl({
      model: mockModel,
      registry: mockRegistry,
      baseToolContext: mockToolContext,
      loadPrompt: vi.fn().mockResolvedValue('You are a specialist agent.'),
      abortSignal: undefined,
      onSubagentEvent: vi.fn(),
    });

  it('should spawn a subagent and return text result', async () => {
    const executor = createExecutor();
    const result = await executor.spawn({
      agentType: 'spec_gatherer',
      task: 'Gather requirements',
      expectStructuredOutput: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.text).toBe('Task completed');
    expect(result.stepsExecuted).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors gracefully', async () => {
    const { generateText } = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

    const executor = createExecutor();
    const result = await executor.spawn({
      agentType: 'spec_writer',
      task: 'Write spec',
      expectStructuredOutput: false,
    });

    expect(result.error).toBe('API error');
    expect(result.stepsExecuted).toBe(0);
  });

  it('should include context in user message when provided', async () => {
    const { generateText } = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'Done',
      steps: [{ toolCalls: [] }],
      output: null,
    });

    const executor = createExecutor();
    await executor.spawn({
      agentType: 'spec_critic',
      task: 'Review spec',
      context: 'Prior findings: all requirements met',
      expectStructuredOutput: false,
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Prior findings: all requirements met'),
          }),
        ],
      }),
    );
  });

  it('should exclude SpawnSubagent tool from subagent tool set', async () => {
    const { getAgentConfig } = await import('../../config/agent-configs');
    (getAgentConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      tools: ['Read', 'SpawnSubagent', 'Write'],
      mcpServers: [],
      autoClaudeTools: [],
      thinkingDefault: 'medium',
    });

    const executor = createExecutor();
    await executor.spawn({
      agentType: 'spec_gatherer',
      task: 'Gather reqs',
      expectStructuredOutput: false,
    });

    // SpawnSubagent should not be in tools passed to generateText
    const { generateText } = await import('ai');
    const callArgs = (generateText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.tools).not.toHaveProperty('SpawnSubagent');
  });

  it('should fire onSubagentEvent callbacks for spawn lifecycle', async () => {
    const onEvent = vi.fn();
    const executor = new SubagentExecutorImpl({
      model: mockModel, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      registry: mockRegistry,
      baseToolContext: mockToolContext,
      loadPrompt: vi.fn().mockResolvedValue('System prompt'),
      onSubagentEvent: onEvent,
    });

    await executor.spawn({
      agentType: 'planner',
      task: 'Plan the build',
      expectStructuredOutput: false,
    });

    expect(onEvent).toHaveBeenCalledWith('planner', 'spawning');
    expect(onEvent).toHaveBeenCalledWith('planner', 'completed');
  });
});
