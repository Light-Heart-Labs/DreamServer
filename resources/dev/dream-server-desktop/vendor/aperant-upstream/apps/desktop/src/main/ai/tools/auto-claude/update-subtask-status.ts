/**
 * update_subtask_status Tool
 * ==========================
 *
 * Updates the status of a subtask in implementation_plan.json.
 * See apps/desktop/src/main/ai/tools/auto-claude/update-subtask-status.ts for the TypeScript implementation.
 *
 * Tool name: mcp__auto-claude__update_subtask_status
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';
import { safeParseJson } from '../../../utils/json-repair';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  subtask_id: z.string().describe('ID of the subtask to update'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed'])
    .describe('New status for the subtask'),
  notes: z.string().optional().describe('Optional notes about the completion or failure'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PlanSubtask {
  id?: string;
  subtask_id?: string;
  status?: string;
  notes?: string;
  updated_at?: string;
}

interface PlanPhase {
  subtasks?: PlanSubtask[];
}

interface ImplementationPlan {
  phases?: PlanPhase[];
  last_updated?: string;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function updateSubtaskInPlan(
  plan: ImplementationPlan,
  subtaskId: string,
  status: string,
  notes: string | undefined,
): boolean {
  for (const phase of plan.phases ?? []) {
    for (const subtask of phase.subtasks ?? []) {
      const id = subtask.id ?? subtask.subtask_id;
      if (id === subtaskId) {
        subtask.status = status;
        if (notes) subtask.notes = notes;
        subtask.updated_at = new Date().toISOString();
        plan.last_updated = new Date().toISOString();
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const updateSubtaskStatusTool = Tool.define({
  metadata: {
    name: 'mcp__auto-claude__update_subtask_status',
    description:
      'Update the status of a subtask in implementation_plan.json. Use this when completing or starting a subtask.',
    permission: ToolPermission.Auto,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: (input, context) => {
    const { subtask_id, status, notes } = input;
    const planFile = path.join(context.specDir, 'implementation_plan.json');

    if (!fs.existsSync(planFile)) {
      return 'Error: implementation_plan.json not found';
    }

    const plan = safeParseJson<ImplementationPlan>(fs.readFileSync(planFile, 'utf-8'));
    if (!plan) {
      return 'Error: implementation_plan.json contains unrepairable JSON';
    }

    const found = updateSubtaskInPlan(plan, subtask_id, status, notes);
    if (!found) {
      return `Error: Subtask '${subtask_id}' not found in implementation plan`;
    }

    try {
      writeJsonAtomic(planFile, plan);
      return `Successfully updated subtask '${subtask_id}' to status '${status}'`;
    } catch (e) {
      return `Error writing implementation_plan.json: ${e}`;
    }
  },
});
