import { EventEmitter } from 'events';
import { generateText } from 'ai';
import { createSimpleClient } from './ai/client/factory';
import { getActiveProviderFeatureSettings } from './ipc-handlers/feature-settings-helper';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.warn('[TerminalNameGenerator]', ...args);
  }
}

const SYSTEM_PROMPT =
  'You generate very short, concise terminal names (2-3 words MAX). Output ONLY the name, nothing else. No quotes, no explanation, no preamble. Keep it as short as possible while being descriptive.';

/**
 * Service for generating terminal names from commands using the Vercel AI SDK.
 *
 * Replaces the previous Python subprocess implementation.
 * Emits "sdk-rate-limit" events on 429 errors (same interface as before).
 */
export class TerminalNameGenerator extends EventEmitter {
  constructor() {
    super();
    debug('TerminalNameGenerator initialized');
  }

  /**
   * No-op configure() kept for backward compatibility.
   * Python source path is no longer needed.
   */
  configure(_autoBuildSourcePath?: string): void {
    // No-op: TypeScript implementation does not need a source path
  }

  /**
   * Generate a terminal name from a command using Claude AI
   * @param command - The command or recent output to generate a name from
   * @param cwd - Current working directory for context
   * @returns Promise resolving to the generated name (2-3 words) or null on failure
   */
  async generateName(command: string, cwd?: string): Promise<string | null> {
    const prompt = this.createNamePrompt(command, cwd);

    debug('Generating terminal name for command:', command.substring(0, 100) + '...');

    try {
      // Read the user's configured naming model for their active provider
      const namingSettings = getActiveProviderFeatureSettings('naming');

      const client = await createSimpleClient({
        systemPrompt: SYSTEM_PROMPT,
        modelShorthand: namingSettings.model,
        thinkingLevel: namingSettings.thinkingLevel as 'low' | 'medium' | 'high' | 'xhigh',
      });

      const result = await generateText({
        model: client.model,
        system: client.systemPrompt,
        prompt,
      });

      const raw = result.text.trim();
      if (!raw) {
        debug('AI returned empty response for terminal name');
        return null;
      }

      const name = this.cleanName(raw);
      debug('Generated terminal name:', name);
      return name;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Surface 429 rate-limit errors as sdk-rate-limit events
      if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
        debug('Rate limit detected:', message);
        this.emit('sdk-rate-limit', {
          source: 'other',
          message,
          timestamp: new Date().toISOString(),
        });
        return null;
      }

      debug('Terminal name generation failed:', message);
      return null;
    }
  }

  /**
   * Create the prompt for terminal name generation
   */
  private createNamePrompt(command: string, cwd?: string): string {
    let prompt = `Generate a very short, descriptive name (2-3 words MAX) for a terminal window based on what it's doing. The name should be concise and help identify the terminal at a glance.

Command or activity:
${command}`;

    if (cwd) {
      prompt += `

Working directory:
${cwd}`;
    }

    prompt += '\n\nOutput ONLY the name (2-3 words), nothing else. Examples: "npm build", "git logs", "python tests", "claude dev"';

    return prompt;
  }

  /**
   * Clean up the generated name
   */
  private cleanName(name: string): string {
    // Remove quotes if present
    let cleaned = name.replace(/^["']|["']$/g, '');

    // Remove any "Terminal:" or similar prefixes
    cleaned = cleaned.replace(/^(terminal|name)[:\s]*/i, '');

    // Take first line only
    cleaned = cleaned.split('\n')[0]?.trim() ?? cleaned;

    // Truncate if too long (max 30 chars for terminal names)
    if (cleaned.length > 30) {
      cleaned = `${cleaned.substring(0, 27)}...`;
    }

    return cleaned.trim();
  }
}

// Export singleton instance
export const terminalNameGenerator = new TerminalNameGenerator();
