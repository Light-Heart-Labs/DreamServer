/**
 * Duplicate Detector for GitHub Issues
 * =======================================
 *
 * Detects duplicate and similar issues before processing.
 * See apps/desktop/src/main/ai/runners/github/duplicate-detector.ts for the TypeScript implementation.
 *
 * Uses text-based similarity (title + body) with entity extraction.
 * Embedding-based similarity is not available in the Electron main process,
 * so we use TF-IDF-inspired cosine similarity over token bags instead.
 */

// =============================================================================
// Constants
// =============================================================================

/** Cosine similarity threshold for "definitely duplicate" */
export const DUPLICATE_THRESHOLD = 0.85;

/** Cosine similarity threshold for "potentially related" */
export const SIMILAR_THRESHOLD = 0.70;

// =============================================================================
// Types
// =============================================================================

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  labels?: Array<{ name: string }>;
  state?: string;
  [key: string]: unknown;
}

export interface EntityExtraction {
  errorCodes: string[];
  filePaths: string[];
  functionNames: string[];
  urls: string[];
  versions: string[];
}

export interface SimilarityResult {
  issueA: number;
  issueB: number;
  overallScore: number;
  titleScore: number;
  bodyScore: number;
  entityScores: Record<string, number>;
  isDuplicate: boolean;
  isSimilar: boolean;
  explanation: string;
}

export interface DuplicateGroup {
  primaryIssue: number;
  duplicates: number[];
  similar: number[];
}

// =============================================================================
// Entity Extractor
// =============================================================================

const ERROR_CODE_RE = /\b(?:E|ERR|ERROR|WARN|WARNING|FATAL)[-_]?\d{3,5}\b|\b[A-Z]{2,5}[-_]\d{3,5}\b/gi;
const FILE_PATH_RE = /(?:^|\s|["'`])([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})(?:\s|["'`]|$|:|\()/gm;
const FUNCTION_NAME_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(|\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)|\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?\b/g;

export function extractEntities(content: string): EntityExtraction {
  const errorCodes = [...new Set((content.match(ERROR_CODE_RE) ?? []).map((s) => s.toLowerCase()))];

  const filePathMatches = [...content.matchAll(FILE_PATH_RE)];
  const filePaths = [...new Set(
    filePathMatches
      .map((m) => m[1])
      .filter((p) => p && p.length > 3),
  )];

  const funcMatches = [...content.matchAll(FUNCTION_NAME_RE)];
  const functionNames = [...new Set(
    funcMatches
      .map((m) => m[1] ?? m[2] ?? m[3])
      .filter((f): f is string => Boolean(f) && f.length > 2)
      .slice(0, 20),
  )];

  const urls = [...new Set((content.match(URL_RE) ?? []).slice(0, 10))];
  const versions = [...new Set((content.match(VERSION_RE) ?? []).slice(0, 10))];

  return { errorCodes, filePaths, functionNames, urls, versions };
}

// =============================================================================
// Text Similarity Helpers
// =============================================================================

/** Tokenize text into a bag-of-words (lowercase, alphanumeric tokens). */
function tokenize(text: string): Map<string, number> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const bag = new Map<string, number>();
  for (const tok of tokens) {
    bag.set(tok, (bag.get(tok) ?? 0) + 1);
  }
  return bag;
}

/** Cosine similarity between two token bags. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [tok, countA] of a) {
    const countB = b.get(tok) ?? 0;
    dot += countA * countB;
    normA += countA * countA;
  }
  for (const [, countB] of b) {
    normB += countB * countB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Jaccard similarity between two lists. */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0.0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  const union = new Set([...setA, ...setB]);
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  return union.size === 0 ? 0 : intersection / union.size;
}

// =============================================================================
// Duplicate Detector
// =============================================================================

/**
 * Detects duplicate and similar GitHub issues using text-based similarity.
 *
 * Uses cosine similarity on bag-of-words (title, body) plus Jaccard on
 * extracted entities (file paths, error codes, function names).
 */
export class DuplicateDetector {
  /**
   * Compare two issues and return a similarity result.
   */
  compareIssues(issueA: GitHubIssue, issueB: GitHubIssue): SimilarityResult {
    const titleA = issueA.title ?? '';
    const titleB = issueB.title ?? '';
    const bodyA = issueA.body ?? '';
    const bodyB = issueB.body ?? '';

    // Title similarity
    const titleScore = cosineSimilarity(tokenize(titleA), tokenize(titleB));

    // Body similarity
    const bodyScore = cosineSimilarity(tokenize(bodyA), tokenize(bodyB));

    // Entity overlap
    const entitiesA = extractEntities(`${titleA} ${bodyA}`);
    const entitiesB = extractEntities(`${titleB} ${bodyB}`);

    const entityScores: Record<string, number> = {
      errorCodes: jaccardSimilarity(entitiesA.errorCodes, entitiesB.errorCodes),
      filePaths: jaccardSimilarity(entitiesA.filePaths, entitiesB.filePaths),
      functionNames: jaccardSimilarity(entitiesA.functionNames, entitiesB.functionNames),
      urls: jaccardSimilarity(entitiesA.urls, entitiesB.urls),
    };

    // Weighted combination: title 40%, body 40%, entity avg 20%
    const entityAvg =
      Object.values(entityScores).reduce((s, v) => s + v, 0) /
      Math.max(Object.values(entityScores).length, 1);
    const overallScore = 0.4 * titleScore + 0.4 * bodyScore + 0.2 * entityAvg;

    const isDuplicate = overallScore >= DUPLICATE_THRESHOLD;
    const isSimilar = !isDuplicate && overallScore >= SIMILAR_THRESHOLD;

    const explanation = isDuplicate
      ? `Issues are likely duplicates (score: ${overallScore.toFixed(2)})`
      : isSimilar
        ? `Issues may be related (score: ${overallScore.toFixed(2)})`
        : `Issues are not related (score: ${overallScore.toFixed(2)})`;

    return {
      issueA: issueA.number,
      issueB: issueB.number,
      overallScore,
      titleScore,
      bodyScore,
      entityScores,
      isDuplicate,
      isSimilar,
      explanation,
    };
  }

  /**
   * Find all duplicate groups in a list of issues.
   *
   * Returns groups where each group has a primary issue and its duplicates.
   * Issues that are merely similar (not duplicates) are noted separately.
   */
  findDuplicateGroups(issues: GitHubIssue[]): DuplicateGroup[] {
    if (issues.length < 2) return [];

    const groups: DuplicateGroup[] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < issues.length; i++) {
      const primary = issues[i];
      if (assigned.has(primary.number)) continue;

      const group: DuplicateGroup = {
        primaryIssue: primary.number,
        duplicates: [],
        similar: [],
      };

      for (let j = i + 1; j < issues.length; j++) {
        const candidate = issues[j];
        if (assigned.has(candidate.number)) continue;

        const result = this.compareIssues(primary, candidate);
        if (result.isDuplicate) {
          group.duplicates.push(candidate.number);
          assigned.add(candidate.number);
        } else if (result.isSimilar) {
          group.similar.push(candidate.number);
        }
      }

      if (group.duplicates.length > 0 || group.similar.length > 0) {
        assigned.add(primary.number);
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Filter out duplicate issues from a list, keeping only unique ones.
   *
   * When duplicates are found, the lowest-numbered issue is kept as the primary.
   * Returns the filtered list and a map of removed issue numbers → kept issue number.
   */
  deduplicateIssues(issues: GitHubIssue[]): {
    unique: GitHubIssue[];
    removedMap: Record<number, number>;
  } {
    const groups = this.findDuplicateGroups(issues);
    const removedMap: Record<number, number> = {};
    const removedNumbers = new Set<number>();

    for (const group of groups) {
      for (const dup of group.duplicates) {
        removedNumbers.add(dup);
        removedMap[dup] = group.primaryIssue;
      }
    }

    const unique = issues.filter((issue) => !removedNumbers.has(issue.number));
    return { unique, removedMap };
  }

  /**
   * Check if a new issue is a duplicate of any existing issue.
   *
   * Returns the most similar existing issue if a duplicate is found, or null.
   */
  findDuplicateOf(
    newIssue: GitHubIssue,
    existingIssues: GitHubIssue[],
  ): { issue: GitHubIssue; result: SimilarityResult } | null {
    let best: { issue: GitHubIssue; result: SimilarityResult } | null = null;

    for (const existing of existingIssues) {
      if (existing.number === newIssue.number) continue;
      const result = this.compareIssues(newIssue, existing);
      if (result.isDuplicate) {
        if (!best || result.overallScore > best.result.overallScore) {
          best = { issue: existing, result };
        }
      }
    }

    return best;
  }
}
