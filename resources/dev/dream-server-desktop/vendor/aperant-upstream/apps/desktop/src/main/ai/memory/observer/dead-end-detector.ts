/**
 * Dead-End Detector
 *
 * Detects when an agent abandons an approach mid-session.
 * Used to create `dead_end` memory candidates from reasoning text.
 */

export const DEAD_END_LANGUAGE_PATTERNS: RegExp[] = [
  /this approach (won't|will not|cannot) work/i,
  /I need to abandon this/i,
  /let me try a different approach/i,
  /unavailable in (test|ci|production)/i,
  /not available in this environment/i,
  /this (won't|will not|doesn't|does not) work (here|in this|for this)/i,
  /I (should|need to|must) (try|use|switch to) (a different|another|an alternative)/i,
  /this method (is deprecated|has been removed|no longer exists)/i,
];

export interface DeadEndDetectionResult {
  matched: boolean;
  pattern: string;
  matchedText: string;
}

/**
 * Detect dead-end language in an agent reasoning text chunk.
 * Returns the first match found (highest priority patterns first).
 */
export function detectDeadEnd(text: string): DeadEndDetectionResult {
  for (const pattern of DEAD_END_LANGUAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return {
        matched: true,
        pattern: pattern.toString(),
        matchedText: match[0],
      };
    }
  }
  return { matched: false, pattern: '', matchedText: '' };
}
