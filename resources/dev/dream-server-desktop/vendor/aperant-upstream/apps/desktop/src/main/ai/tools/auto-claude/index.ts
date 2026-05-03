/**
 * Auto-Claude Custom Tools
 * ========================
 *
 * Barrel export for all auto-claude builtin tools.
 * These replace the Python tools_pkg/tools/* implementations.
 *
 * Tool names follow the mcp__auto-claude__* convention to match the
 * TOOL_* constants in registry.ts and AGENT_CONFIGS autoClaudeTools arrays.
 */

export { updateSubtaskStatusTool } from './update-subtask-status';
export { getBuildProgressTool } from './get-build-progress';
export { recordDiscoveryTool } from './record-discovery';
export { recordGotchaTool } from './record-gotcha';
export { getSessionContextTool } from './get-session-context';
export { updateQaStatusTool } from './update-qa-status';
