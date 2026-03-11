// ── .env Parser ─────────────────────────────────────────────────────────────
// Robust parser that handles quotes, inline comments, blank lines, and merging.

/**
 * Parse a .env file into a key-value map.
 *
 * Handles:
 *  - KEY=value
 *  - KEY="value with spaces"
 *  - KEY='value with spaces'
 *  - KEY=value # inline comment
 *  - Empty values (KEY=)
 *  - Blank lines and # full-line comments
 */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = line.slice(eqIdx + 1);

    // Handle quoted values
    const trimmed = value.trimStart();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      value = trimmed.slice(1, -1);
    } else {
      // Strip inline comments (only for unquoted values)
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx);
      }
      value = value.trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Get a single value from .env content.
 */
export function getEnvValue(content: string, key: string): string | undefined {
  const parsed = parseEnv(content);
  return parsed[key];
}

/**
 * Set or update a key in .env content, preserving structure and comments.
 * If the key exists, replaces its value in-place. If not, appends it.
 */
export function setEnvValue(content: string, key: string, value: string): string {
  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    const lineKey = trimmed.slice(0, eqIdx).trim();
    if (lineKey === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  return lines.join('\n');
}

/**
 * Merge a generated .env into an existing one, preserving user edits.
 *
 * Rules:
 *  - User-edited keys in `existing` are preserved
 *  - New keys from `generated` are appended
 *  - Comments and structure from `existing` are preserved
 */
export function mergeEnv(existing: string, generated: string): string {
  const existingParsed = parseEnv(existing);
  const generatedParsed = parseEnv(generated);
  let result = existing;

  // System-managed keys that MUST be overwritten on re-install
  // (tier/model/backend upgrades would silently fail otherwise)
  const MANAGED_KEYS = new Set([
    'LLM_MODEL', 'GGUF_FILE', 'CTX_SIZE', 'MAX_CONTEXT', 'TIER',
    'GPU_BACKEND', 'LLM_BACKEND', 'COMPOSE_FILE',
    'VLLM_MODEL', 'VLLM_ARGS', 'VLLM_IMAGE',
    'ENABLE_VOICE', 'ENABLE_WORKFLOWS', 'ENABLE_RAG', 'ENABLE_OPENCLAW', 'ENABLE_DEVTOOLS',
  ]);

  // Force-overwrite managed keys in the existing content
  for (const key of Object.keys(generatedParsed)) {
    if (MANAGED_KEYS.has(key) && key in existingParsed) {
      result = setEnvValue(result, key, generatedParsed[key]);
    }
  }

  // Append any keys from generated that don't exist in existing
  const newKeys: string[] = [];
  for (const key of Object.keys(generatedParsed)) {
    if (!(key in existingParsed)) {
      newKeys.push(key);
    }
  }

  if (newKeys.length > 0) {
    const additions = newKeys.map((k) => `${k}=${generatedParsed[k]}`);
    // Ensure trailing newline before appending
    if (!result.endsWith('\n')) result += '\n';
    result += `\n# ── Added by dream-installer ──────────────────────────────────\n`;
    result += additions.join('\n') + '\n';
  }

  return result;
}
