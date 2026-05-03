import { describe, it, expect, vi } from 'vitest';

import { spawnSubagentTool } from '../spawn-subagent';
import type { SubagentExecutor } from '../spawn-subagent';
import type { ToolContext } from '../../types';

// Mock security module to prevent initialization issues
vi.mock('../../../security/bash-validator', () => ({
  bashSecurityHook: vi.fn(() => ({})),
}));

describe('SpawnSubagent Tool', () => {
  const baseContext: ToolContext = {
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

  it('should have correct metadata', () => {
    expect(spawnSubagentTool.metadata.name).toBe('SpawnSubagent');
    expect(spawnSubagentTool.metadata.permission).toBe('auto');
  });

  it('should return error when no executor is available', async () => {
    const result = await spawnSubagentTool.config.execute(
      {
        agent_type: 'complexity_assessor',
        task: 'Assess complexity',
        context: null,
        expect_structured_output: true,
      },
      baseContext,
    );
    expect(result).toContain('not available');
  });

  it('should delegate to executor when available', async () => {
    const mockExecutor: SubagentExecutor = {
      spawn: vi.fn().mockResolvedValue({
        text: 'Assessment complete',
        structuredOutput: { complexity: 'simple', confidence: 0.9 },
        stepsExecuted: 3,
        durationMs: 1500,
      }),
    };

    const contextWithExecutor = {
      ...baseContext,
      subagentExecutor: mockExecutor,
    };

    const result = await spawnSubagentTool.config.execute(
      {
        agent_type: 'complexity_assessor',
        task: 'Assess complexity of: add button',
        context: 'Small UI change',
        expect_structured_output: true,
      },
      contextWithExecutor as unknown as ToolContext,
    );

    expect(result).toContain('completed successfully');
    expect(result).toContain('Structured output');
    expect(mockExecutor.spawn).toHaveBeenCalledWith({
      agentType: 'complexity_assessor',
      task: 'Assess complexity of: add button',
      context: 'Small UI change',
      expectStructuredOutput: true,
    });
  });

  it('should handle subagent errors gracefully', async () => {
    const mockExecutor: SubagentExecutor = {
      spawn: vi.fn().mockResolvedValue({
        error: 'Model timeout',
        stepsExecuted: 0,
        durationMs: 5000,
      }),
    };

    const contextWithExecutor = {
      ...baseContext,
      subagentExecutor: mockExecutor,
    };

    const result = await spawnSubagentTool.config.execute(
      {
        agent_type: 'spec_writer',
        task: 'Write spec',
        context: null,
        expect_structured_output: false,
      },
      contextWithExecutor as unknown as ToolContext,
    );

    expect(result).toContain('failed');
    expect(result).toContain('Model timeout');
  });

  it('should handle executor throwing exceptions', async () => {
    const mockExecutor: SubagentExecutor = {
      spawn: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const contextWithExecutor = {
      ...baseContext,
      subagentExecutor: mockExecutor,
    };

    const result = await spawnSubagentTool.config.execute(
      {
        agent_type: 'spec_researcher',
        task: 'Research APIs',
        context: null,
        expect_structured_output: false,
      },
      contextWithExecutor as unknown as ToolContext,
    );

    expect(result).toContain('execution error');
    expect(result).toContain('Network error');
  });

  it('should return text output when no structured output', async () => {
    const mockExecutor: SubagentExecutor = {
      spawn: vi.fn().mockResolvedValue({
        text: 'Found 3 relevant files',
        stepsExecuted: 5,
        durationMs: 3000,
      }),
    };

    const contextWithExecutor = {
      ...baseContext,
      subagentExecutor: mockExecutor,
    };

    const result = await spawnSubagentTool.config.execute(
      {
        agent_type: 'spec_discovery',
        task: 'Discover project structure',
        context: null,
        expect_structured_output: false,
      },
      contextWithExecutor as unknown as ToolContext,
    );

    expect(result).toContain('completed successfully');
    expect(result).toContain('Found 3 relevant files');
    expect(result).not.toContain('Structured output');
  });

  it('should convert null context to undefined when spawning', async () => {
    const mockExecutor: SubagentExecutor = {
      spawn: vi.fn().mockResolvedValue({
        text: 'Done',
        stepsExecuted: 1,
        durationMs: 500,
      }),
    };

    const contextWithExecutor = {
      ...baseContext,
      subagentExecutor: mockExecutor,
    };

    await spawnSubagentTool.config.execute(
      {
        agent_type: 'planner',
        task: 'Plan implementation',
        context: null,
        expect_structured_output: false,
      },
      contextWithExecutor as unknown as ToolContext,
    );

    expect(mockExecutor.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ context: undefined }),
    );
  });
});
