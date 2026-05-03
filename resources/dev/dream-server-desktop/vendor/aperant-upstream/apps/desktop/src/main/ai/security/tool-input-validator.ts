/**
 * Tool Input Validator
 * ====================
 *
 * Validates tool_input structure before tool execution.
 * Catches malformed inputs (null, wrong type, missing required keys) early.
 *
 * See apps/desktop/src/main/ai/security/tool-input-validator.ts for the TypeScript implementation.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Required keys per tool type */
const TOOL_REQUIRED_KEYS: Record<string, string[]> = {
  Bash: ['command'],
  Read: ['file_path'],
  Write: ['file_path', 'content'],
  Edit: ['file_path', 'old_string', 'new_string'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result: [isValid, errorMessage | null] */
export type ToolValidationResult = [boolean, string | null];

/**
 * Validate tool input structure.
 *
 * Ported from: validate_tool_input()
 */
export function validateToolInput(
  toolName: string,
  toolInput: unknown,
): ToolValidationResult {
  // Must not be null/undefined
  if (toolInput === null || toolInput === undefined) {
    return [false, `${toolName}: tool_input is None (malformed tool call)`];
  }

  // Must be a dict (object, not array)
  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return [
      false,
      `${toolName}: tool_input must be dict, got ${Array.isArray(toolInput) ? 'array' : typeof toolInput}`,
    ];
  }

  const input = toolInput as Record<string, unknown>;

  // Check required keys for known tools
  const requiredKeys = TOOL_REQUIRED_KEYS[toolName] ?? [];
  const missingKeys = requiredKeys.filter((key) => !(key in input));

  if (missingKeys.length > 0) {
    return [
      false,
      `${toolName}: missing required keys: ${missingKeys.join(', ')}`,
    ];
  }

  // Additional validation for specific tools
  if (toolName === 'Bash') {
    const command = input.command;
    if (typeof command !== 'string') {
      return [
        false,
        `Bash: 'command' must be string, got ${typeof command}`,
      ];
    }
    if (!command.trim()) {
      return [false, "Bash: 'command' is empty"];
    }
  }

  return [true, null];
}

/**
 * Safely extract tool_input from a tool use block, defaulting to empty object.
 *
 * Ported from: get_safe_tool_input()
 */
export function getSafeToolInput(
  block: unknown,
  defaultValue: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!block || typeof block !== 'object') return defaultValue;

  const blockObj = block as Record<string, unknown>;
  const toolInput = blockObj.input ?? blockObj.tool_input;

  if (toolInput === null || toolInput === undefined) return defaultValue;
  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) return defaultValue;

  return toolInput as Record<string, unknown>;
}
