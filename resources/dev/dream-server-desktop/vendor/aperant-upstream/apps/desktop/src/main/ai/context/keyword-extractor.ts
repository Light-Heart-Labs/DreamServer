/**
 * Keyword Extraction
 *
 * Extracts meaningful keywords from task descriptions for code search.
 * See apps/desktop/src/main/ai/context/keyword-extractor.ts for the TypeScript implementation.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with',
  'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'we', 'they', 'it', 'add', 'create', 'make', 'implement',
  'build', 'fix', 'update', 'change', 'modify', 'when', 'if', 'then',
  'else', 'new', 'existing',
]);

/**
 * Extract search keywords from a task description.
 * Uses regex-based tokenization; skips stop words and very short tokens.
 */
export function extractKeywords(task: string, maxKeywords = 10): string[] {
  const wordPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
  const words = (task.toLowerCase().match(wordPattern) ?? []);

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const word of words) {
    if (word.length > 2 && !STOPWORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      unique.push(word);
    }
  }

  return unique.slice(0, maxKeywords);
}
