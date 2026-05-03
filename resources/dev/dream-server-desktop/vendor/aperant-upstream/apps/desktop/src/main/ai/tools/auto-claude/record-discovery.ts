/**
 * record_discovery Tool
 * =====================
 *
 * Records a codebase discovery to session memory (codebase_map.json).
 * See apps/desktop/src/main/ai/tools/auto-claude/record-discovery.ts for the TypeScript implementation.
 *
 * Tool name: mcp__auto-claude__record_discovery
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { safeParseJson } from '../../../utils/json-repair';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z.string().describe('Path to the file or module being documented'),
  description: z.string().describe('What was discovered about this file or module'),
  category: z
    .string()
    .optional()
    .describe('Category of the discovery (e.g., "api", "config", "ui", "general")'),
});

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface CodebaseMap {
  discovered_files: Record<string, { description: string; category: string; discovered_at: string }>;
  last_updated: string | null;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const recordDiscoveryTool = Tool.define({
  metadata: {
    name: 'mcp__auto-claude__record_discovery',
    description:
      'Record a codebase discovery to session memory. Use this when you learn something important about the codebase structure or behavior.',
    permission: ToolPermission.Auto,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: (input, context) => {
    const { file_path, description, category = 'general' } = input;
    const memoryDir = path.join(context.specDir, 'memory');

    try {
      fs.mkdirSync(memoryDir, { recursive: true });

      const mapFile = path.join(memoryDir, 'codebase_map.json');
      let codebaseMap: CodebaseMap = { discovered_files: {}, last_updated: null };

      if (fs.existsSync(mapFile)) {
        try {
          const parsed = safeParseJson<CodebaseMap>(fs.readFileSync(mapFile, 'utf-8'));
          if (parsed) codebaseMap = parsed;
          // Start fresh if corrupt (parsed === null)
        } catch {
          // Start fresh if corrupt
        }
      }

      codebaseMap.discovered_files[file_path] = {
        description,
        category,
        discovered_at: new Date().toISOString(),
      };
      codebaseMap.last_updated = new Date().toISOString();

      const tmp = `${mapFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(codebaseMap, null, 2), 'utf-8');
      fs.renameSync(tmp, mapFile);

      return `Recorded discovery for '${file_path}': ${description}`;
    } catch (e) {
      return `Error recording discovery: ${e}`;
    }
  },
});
