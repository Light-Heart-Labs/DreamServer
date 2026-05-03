/**
 * Semantic Analyzer
 * =================
 *
 * Regex-based semantic analysis for code changes.
 * See apps/desktop/src/main/ai/merge/semantic-analyzer.ts for the TypeScript implementation.
 *
 * Analyzes diffs using language-specific regex patterns to detect:
 * - Import additions/removals
 * - Function additions/removals/modifications
 * - Hook calls, JSX changes, class/method changes
 * - TypeScript-specific type/interface changes
 */

import {
  ChangeType,
  type FileAnalysis,
  type SemanticChange,
  createFileAnalysis,
} from './types';

// =============================================================================
// Import patterns by file extension
// =============================================================================

function getImportPattern(ext: string): RegExp | null {
  const patterns: Record<string, RegExp> = {
    '.py': /^(?:from\s+\S+\s+)?import\s+/,
    '.js': /^import\s+/,
    '.jsx': /^import\s+/,
    '.ts': /^import\s+/,
    '.tsx': /^import\s+/,
  };
  return patterns[ext] ?? null;
}

// =============================================================================
// Function patterns by file extension
// =============================================================================

function getFunctionPattern(ext: string): RegExp | null {
  const patterns: Record<string, RegExp> = {
    '.py': /def\s+(\w+)\s*\(/g,
    '.js': /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
    '.jsx': /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
    '.ts': /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
    '.tsx': /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
  };
  return patterns[ext] ?? null;
}

// =============================================================================
// Extract function names from regex matches (handles capturing groups)
// =============================================================================

function extractFunctionNames(content: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  const regex = new RegExp(pattern.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Find first non-undefined capture group (skip full match at index 0)
    for (let i = 1; i < match.length; i++) {
      if (match[i]) {
        names.add(match[i]);
        break;
      }
    }
  }

  return names;
}

// =============================================================================
// Diff parsing
// =============================================================================

interface DiffLine {
  lineNum: number;
  content: string;
}

function parseUnifiedDiff(before: string, after: string): { added: DiffLine[]; removed: DiffLine[] } {
  // Normalize line endings
  const beforeNorm = before.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const afterNorm = after.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const beforeLines = beforeNorm.split('\n');
  const afterLines = afterNorm.split('\n');

  // Use a simple LCS-based diff
  const added: DiffLine[] = [];
  const removed: DiffLine[] = [];

  // Simple diff using Myers algorithm approximation
  const diff = computeSimpleDiff(beforeLines, afterLines);

  let beforeIdx = 0;
  let afterIdx = 0;

  for (const op of diff) {
    if (op === 'equal') {
      beforeIdx++;
      afterIdx++;
    } else if (op === 'insert') {
      added.push({ lineNum: afterIdx + 1, content: afterLines[afterIdx] ?? '' });
      afterIdx++;
    } else if (op === 'delete') {
      removed.push({ lineNum: beforeIdx + 1, content: beforeLines[beforeIdx] ?? '' });
      beforeIdx++;
    } else if (op === 'replace') {
      removed.push({ lineNum: beforeIdx + 1, content: beforeLines[beforeIdx] ?? '' });
      added.push({ lineNum: afterIdx + 1, content: afterLines[afterIdx] ?? '' });
      beforeIdx++;
      afterIdx++;
    }
  }

  return { added, removed };
}

type DiffOp = 'equal' | 'insert' | 'delete' | 'replace';

function computeSimpleDiff(before: string[], after: string[]): DiffOp[] {
  // Simple O(n*m) LCS-based diff
  const m = before.length;
  const n = after.length;

  // Build LCS table
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (before[i - 1] === after[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff ops
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.unshift('equal');
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.unshift('insert');
      j--;
    } else {
      ops.unshift('delete');
      i--;
    }
  }

  return ops;
}

// =============================================================================
// Function modification classification
// =============================================================================

function classifyFunctionModification(before: string, after: string, ext: string): ChangeType {
  // Check for React hook additions
  const hookPattern = /\buse[A-Z]\w*\s*\(/g;
  const hooksBefore = new Set(Array.from(before.matchAll(hookPattern), (m) => m[0]));
  const hooksAfter = new Set(Array.from(after.matchAll(hookPattern), (m) => m[0]));

  const addedHooks = [...hooksAfter].filter((h) => !hooksBefore.has(h));
  const removedHooks = [...hooksBefore].filter((h) => !hooksAfter.has(h));

  if (addedHooks.length > 0) return ChangeType.ADD_HOOK_CALL;
  if (removedHooks.length > 0) return ChangeType.REMOVE_HOOK_CALL;

  // Check for JSX wrapping
  const jsxPattern = /<[A-Z]\w*/g;
  const jsxBefore = (before.match(jsxPattern) ?? []).length;
  const jsxAfter = (after.match(jsxPattern) ?? []).length;

  if (jsxAfter > jsxBefore) return ChangeType.WRAP_JSX;
  if (jsxAfter < jsxBefore) return ChangeType.UNWRAP_JSX;

  // Check if only JSX props changed
  if (ext === '.jsx' || ext === '.tsx') {
    const structBefore = before.replace(/=\{[^}]*\}|="[^"]*"/g, '=...');
    const structAfter = after.replace(/=\{[^}]*\}|="[^"]*"/g, '=...');
    if (structBefore === structAfter) return ChangeType.MODIFY_JSX_PROPS;
  }

  return ChangeType.MODIFY_FUNCTION;
}

// =============================================================================
// Main analyzer
// =============================================================================

/**
 * Analyze code changes using regex patterns.
 *
 * @param filePath - Path to the file being analyzed
 * @param before - Content before changes
 * @param after - Content after changes
 * @returns FileAnalysis with changes detected via regex patterns
 */
export function analyzeWithRegex(
  filePath: string,
  before: string,
  after: string,
): FileAnalysis {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const analysis = createFileAnalysis(filePath);
  const changes: SemanticChange[] = [];

  const { added: addedLines, removed: removedLines } = parseUnifiedDiff(before, after);

  // Detect imports
  const importPattern = getImportPattern(ext);
  if (importPattern) {
    for (const { lineNum, content } of addedLines) {
      if (importPattern.test(content.trim())) {
        changes.push({
          changeType: ChangeType.ADD_IMPORT,
          target: content.trim(),
          location: 'file_top',
          lineStart: lineNum,
          lineEnd: lineNum,
          contentAfter: content,
          metadata: {},
        });
        analysis.importsAdded.add(content.trim());
      }
    }

    for (const { lineNum, content } of removedLines) {
      if (importPattern.test(content.trim())) {
        changes.push({
          changeType: ChangeType.REMOVE_IMPORT,
          target: content.trim(),
          location: 'file_top',
          lineStart: lineNum,
          lineEnd: lineNum,
          contentBefore: content,
          metadata: {},
        });
        analysis.importsRemoved.add(content.trim());
      }
    }
  }

  // Detect function changes
  const funcPattern = getFunctionPattern(ext);
  if (funcPattern) {
    const funcsBefore = extractFunctionNames(before, funcPattern);
    const funcsAfter = extractFunctionNames(after, funcPattern);

    for (const func of funcsAfter) {
      if (!funcsBefore.has(func)) {
        changes.push({
          changeType: ChangeType.ADD_FUNCTION,
          target: func,
          location: `function:${func}`,
          lineStart: 1,
          lineEnd: 1,
          metadata: {},
        });
        analysis.functionsAdded.add(func);
      }
    }

    for (const func of funcsBefore) {
      if (!funcsAfter.has(func)) {
        changes.push({
          changeType: ChangeType.REMOVE_FUNCTION,
          target: func,
          location: `function:${func}`,
          lineStart: 1,
          lineEnd: 1,
          metadata: {},
        });
      }
    }

    // Check for modifications to existing functions
    for (const func of funcsBefore) {
      if (funcsAfter.has(func)) {
        // Extract function body and compare
        const beforeBody = extractFunctionBody(before, func, ext);
        const afterBody = extractFunctionBody(after, func, ext);

        if (beforeBody !== afterBody && beforeBody !== null && afterBody !== null) {
          const modType = classifyFunctionModification(beforeBody, afterBody, ext);
          changes.push({
            changeType: modType,
            target: func,
            location: `function:${func}`,
            lineStart: 1,
            lineEnd: 1,
            contentBefore: beforeBody,
            contentAfter: afterBody,
            metadata: {},
          });
          analysis.functionsModified.add(func);
        }
      }
    }
  }

  analysis.changes = changes;
  analysis.totalLinesChanged = addedLines.length + removedLines.length;

  return analysis;
}

function extractFunctionBody(content: string, funcName: string, ext: string): string | null {
  let pattern: RegExp;

  if (ext === '.py') {
    pattern = new RegExp(`def\\s+${escapeRegex(funcName)}\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]+)?:\\s*([\\s\\S]*?)(?=\\ndef|\\nclass|$)`, 'm');
  } else {
    pattern = new RegExp(
      `(?:function\\s+${escapeRegex(funcName)}|(?:const|let|var)\\s+${escapeRegex(funcName)}\\s*=\\s*(?:async\\s+)?(?:function|(?:\\([^)]*\\)\\s*=>)))\\s*\\{`,
      'm',
    );
  }

  const match = content.match(pattern);
  return match ? match[0] : null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// SemanticAnalyzer class (main entry point)
// =============================================================================

/**
 * Semantic code change analyzer.
 *
 * Analyzes diffs between file versions to produce semantic change summaries
 * that the conflict detector and auto-merger can use.
 */
export class SemanticAnalyzer {
  /**
   * Analyze a diff between two file versions.
   */
  analyzeDiff(filePath: string, before: string, after: string): FileAnalysis {
    return analyzeWithRegex(filePath, before, after);
  }

  /**
   * Analyze a single file's content (no diff, just extract structure).
   */
  analyzeFile(filePath: string, content: string): FileAnalysis {
    return analyzeWithRegex(filePath, '', content);
  }
}
