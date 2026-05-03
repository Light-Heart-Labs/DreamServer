/**
 * Disk-Spillover Tool Output Truncation
 * ======================================
 *
 * When tool output exceeds size limits, writes full output to disk and returns
 * a truncated version with a routing hint so the agent knows how to access
 * the full data. Inspired by opencode's production patterns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum lines before truncation */
const MAX_LINES = 2000;

/** Maximum bytes before truncation (50KB) */
const MAX_BYTES = 50_000;

/** Higher limit for the safety-net wrapper in Tool.define() */
export const SAFETY_NET_MAX_BYTES = 100_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalSize: number;
  spilloverPath?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Truncate tool output if it exceeds size limits.
 * Full output is preserved on disk with a routing hint for the agent.
 *
 * @param output - The raw tool output string
 * @param toolName - Name of the tool (for spillover filename)
 * @param projectDir - Project directory (spillover written to .auto-claude/tool-output/)
 * @param maxBytes - Override max bytes limit (default: MAX_BYTES)
 * @returns TruncationResult with potentially truncated content
 */
export function truncateToolOutput(
  output: string,
  toolName: string,
  projectDir: string,
  maxBytes: number = MAX_BYTES,
): TruncationResult {
  const bytes = Buffer.byteLength(output, 'utf-8');
  const lines = output.split('\n');

  // Within limits — return as-is
  if (bytes <= maxBytes && lines.length <= MAX_LINES) {
    return {
      content: output,
      wasTruncated: false,
      originalSize: bytes,
    };
  }

  // Exceeds limits — spill to disk
  const spilloverDir = path.join(projectDir, '.auto-claude', 'tool-output');
  try {
    fs.mkdirSync(spilloverDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const timestamp = Date.now();
  const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const spilloverPath = path.join(spilloverDir, `${sanitizedToolName}-${timestamp}.txt`);

  try {
    fs.writeFileSync(spilloverPath, output, 'utf-8');
  } catch {
    // If we can't write spillover, just truncate without disk backup
    const truncated = lines.slice(0, MAX_LINES).join('\n').slice(0, maxBytes);
    return {
      content: `${truncated}\n\n[Output truncated: ${lines.length} lines / ${bytes} bytes — spillover write failed]`,
      wasTruncated: true,
      originalSize: bytes,
    };
  }

  // Truncate to limits
  const truncatedLines = lines.slice(0, MAX_LINES);
  let truncatedContent = truncatedLines.join('\n');
  if (Buffer.byteLength(truncatedContent, 'utf-8') > maxBytes) {
    truncatedContent = truncatedContent.slice(0, maxBytes);
  }

  const hint = [
    '',
    `[Output truncated: ${lines.length} lines / ${bytes} bytes → showing first ${Math.min(lines.length, MAX_LINES)} lines]`,
    `[Full output saved to: ${spilloverPath}]`,
    `[Hint: Use the Read tool to view the full output, or narrow your search pattern for more specific results]`,
  ].join('\n');

  return {
    content: truncatedContent + hint,
    wasTruncated: true,
    originalSize: bytes,
    spilloverPath,
  };
}
