/**
 * Build Tool Registry
 * ===================
 *
 * Shared helper that creates a ToolRegistry pre-populated with all builtin tools.
 * Used by worker threads, runners (insights, roadmap, ideation), and the client factory.
 */

import { ToolRegistry } from './registry';
import type { DefinedTool } from './define';

import { readTool } from './builtin/read';
import { writeTool } from './builtin/write';
import { editTool } from './builtin/edit';
import { bashTool } from './builtin/bash';
import { globTool } from './builtin/glob';
import { grepTool } from './builtin/grep';
import { webFetchTool } from './builtin/web-fetch';
import { webSearchTool } from './builtin/web-search';
import { spawnSubagentTool } from './builtin/spawn-subagent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDefined = (t: unknown): DefinedTool => t as DefinedTool;

/**
 * Build and return a ToolRegistry with all builtin tools registered.
 */
export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerTool('Read', asDefined(readTool));
  registry.registerTool('Write', asDefined(writeTool));
  registry.registerTool('Edit', asDefined(editTool));
  registry.registerTool('Bash', asDefined(bashTool));
  registry.registerTool('Glob', asDefined(globTool));
  registry.registerTool('Grep', asDefined(grepTool));
  registry.registerTool('WebFetch', asDefined(webFetchTool));
  registry.registerTool('WebSearch', asDefined(webSearchTool));
  registry.registerTool('SpawnSubagent', asDefined(spawnSubagentTool));
  return registry;
}
