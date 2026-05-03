/**
 * get_session_context Tool
 * ========================
 *
 * Reads accumulated session context from memory files:
 *   - memory/codebase_map.json  → discoveries
 *   - memory/gotchas.md         → gotchas & pitfalls
 *   - memory/patterns.md        → code patterns
 *
 * See apps/desktop/src/main/ai/tools/auto-claude/get-session-context.ts for the TypeScript implementation.
 *
 * Tool name: mcp__auto-claude__get_session_context
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { safeParseJson } from '../../../utils/json-repair';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema (no parameters)
// ---------------------------------------------------------------------------

const inputSchema = z.object({});

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface CodebaseMap {
  discovered_files?: Record<string, { description?: string }>;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const getSessionContextTool = Tool.define({
  metadata: {
    name: 'mcp__auto-claude__get_session_context',
    description:
      'Get context from previous sessions including codebase discoveries, gotchas, and patterns. Call this at the start of a session to pick up where the last session left off.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: (_input, context) => {
    const memoryDir = path.join(context.specDir, 'memory');

    if (!fs.existsSync(memoryDir)) {
      return 'No session memory found. This appears to be the first session.';
    }

    const parts: string[] = [];

    // Load codebase map (discoveries)
    const mapFile = path.join(memoryDir, 'codebase_map.json');
    if (fs.existsSync(mapFile)) {
      try {
        const map = safeParseJson<CodebaseMap>(fs.readFileSync(mapFile, 'utf-8'));
        if (!map) throw new Error('Invalid JSON');
        const discoveries = Object.entries(map.discovered_files ?? {});
        if (discoveries.length > 0) {
          parts.push('## Codebase Discoveries');
          // Limit to 20 entries to avoid flooding context
          for (const [filePath, info] of discoveries.slice(0, 20)) {
            parts.push(`- \`${filePath}\`: ${info.description ?? 'No description'}`);
          }
        }
      } catch {
        // Skip corrupt file
      }
    }

    // Load gotchas
    const gotchasFile = path.join(memoryDir, 'gotchas.md');
    if (fs.existsSync(gotchasFile)) {
      try {
        const content = fs.readFileSync(gotchasFile, 'utf-8');
        if (content.trim()) {
          parts.push('\n## Gotchas');
          // Take last 1000 chars to avoid too much context
          parts.push(content.length > 1000 ? content.slice(-1000) : content);
        }
      } catch {
        // Skip
      }
    }

    // Load patterns
    const patternsFile = path.join(memoryDir, 'patterns.md');
    if (fs.existsSync(patternsFile)) {
      try {
        const content = fs.readFileSync(patternsFile, 'utf-8');
        if (content.trim()) {
          parts.push('\n## Patterns');
          parts.push(content.length > 1000 ? content.slice(-1000) : content);
        }
      } catch {
        // Skip
      }
    }

    if (parts.length === 0) {
      return 'No session context available yet.';
    }

    return parts.join('\n');
  },
});
