/**
 * Auto Merger
 * ===========
 *
 * Deterministic merge strategies without AI.
 * See apps/desktop/src/main/ai/merge/auto-merger.ts for the TypeScript implementation.
 *
 * Implements 8 merge strategies:
 * 1. COMBINE_IMPORTS — merge import statements
 * 2. HOOKS_FIRST — add hooks at function start
 * 3. HOOKS_THEN_WRAP — hooks first then JSX wrapping
 * 4. APPEND_FUNCTIONS — append new functions to file
 * 5. APPEND_METHODS — add new methods to class
 * 6. COMBINE_PROPS — merge JSX/object props
 * 7. ORDER_BY_DEPENDENCY — topological ordering
 * 8. ORDER_BY_TIME — chronological ordering
 */

import path from 'path';
import {
  ChangeType,
  MergeDecision,
  MergeStrategy,
  type ConflictRegion,
  type MergeResult,
  type SemanticChange,
  type TaskSnapshot,
  isAdditiveChange,
} from './types';

// =============================================================================
// Merge Context
// =============================================================================

export interface MergeContext {
  filePath: string;
  baselineContent: string;
  taskSnapshots: TaskSnapshot[];
  conflict: ConflictRegion;
}

// =============================================================================
// Helpers
// =============================================================================

function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function isImportLine(line: string, ext: string): boolean {
  if (ext === '.py') return line.startsWith('import ') || line.startsWith('from ');
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    return line.startsWith('import ') || line.startsWith('export ');
  }
  return false;
}

function findImportSectionEnd(lines: string[], ext: string): number {
  let lastImportLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (isImportLine(stripped, ext)) {
      lastImportLine = i + 1;
    } else if (
      stripped &&
      !stripped.startsWith('#') &&
      !stripped.startsWith('//')
    ) {
      if (lastImportLine > 0) break;
    }
  }

  return lastImportLine > 0 ? lastImportLine : 0;
}

function findFunctionInsertPosition(content: string): number | null {
  const lines = content.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('module.exports') || line.startsWith('export default')) {
      return i;
    }
  }
  return null;
}

function insertMethodsIntoClass(content: string, className: string, methods: string[]): string {
  const classPattern = new RegExp(`class\\s+${escapeRegex(className)}\\s*(?:extends\\s+\\w+)?\\s*\\{`);
  const match = classPattern.exec(content);

  if (!match) return content;

  const start = match.index + match[0].length;
  let braceCount = 1;
  let pos = start;

  while (pos < content.length && braceCount > 0) {
    if (content[pos] === '{') braceCount++;
    else if (content[pos] === '}') braceCount--;
    pos++;
  }

  if (braceCount === 0) {
    const insertPos = pos - 1;
    const methodText = '\n\n  ' + methods.join('\n\n  ');
    return content.slice(0, insertPos) + methodText + content.slice(insertPos);
  }

  return content;
}

function insertHooksIntoFunction(content: string, funcName: string, hooks: string[]): string {
  const patterns = [
    // function Component() {
    new RegExp(`(function\\s+${escapeRegex(funcName)}\\s*\\([^)]*\\)\\s*\\{)`),
    // const Component = () => {
    new RegExp(`((?:const|let|var)\\s+${escapeRegex(funcName)}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[^=]+)\\s*=>\\s*\\{)`),
    // const Component = function() {
    new RegExp(`((?:const|let|var)\\s+${escapeRegex(funcName)}\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{)`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      const insertPos = match.index + match[0].length;
      const hookText = '\n  ' + hooks.join('\n  ');
      return content.slice(0, insertPos) + hookText + content.slice(insertPos);
    }
  }

  return content;
}

function wrapFunctionReturn(
  content: string,
  _funcName: string,
  wrapperName: string,
  wrapperProps: string,
): string {
  const returnPattern = /(return\s*\(\s*)(<[^>]+>)/;

  return content.replace(returnPattern, (_match, returnStart, jsxStart) => {
    const props = wrapperProps ? ` ${wrapperProps}` : '';
    return `${returnStart}<${wrapperName}${props}>\n      ${jsxStart}`;
  });
}

function extractHookCall(change: SemanticChange): string | null {
  if (!change.contentAfter) return null;

  const patterns = [
    /(const\s+\{[^}]+\}\s*=\s*)?use\w+\([^)]*\);?/,
    /use\w+\([^)]*\);?/,
  ];

  for (const pattern of patterns) {
    const match = change.contentAfter.match(pattern);
    if (match) return match[0];
  }

  return null;
}

function extractJsxWrapper(change: SemanticChange): [string, string] | null {
  if (!change.contentAfter) return null;
  const match = change.contentAfter.match(/<(\w+)([^>]*)>/);
  if (match) return [match[1], match[2].trim()];
  return null;
}

function extractNewProps(change: SemanticChange): Array<[string, string]> {
  const props: Array<[string, string]> = [];
  if (change.contentAfter && change.contentBefore) {
    const afterProps = [...change.contentAfter.matchAll(/(\w+)=\{([^}]+)\}/g)].map((m) => [m[1], m[2]] as [string, string]);
    const beforeProps = new Map(
      [...change.contentBefore.matchAll(/(\w+)=\{([^}]+)\}/g)].map((m) => [m[1], m[2]]),
    );
    for (const [name, value] of afterProps) {
      if (!beforeProps.has(name)) {
        props.push([name, value]);
      }
    }
  }
  return props;
}

function applyContentChange(content: string, oldContent: string | undefined, newContent: string): string {
  if (oldContent && content.includes(oldContent)) {
    return content.replace(oldContent, newContent);
  }
  return content;
}

function topologicalSortChanges(snapshots: TaskSnapshot[]): SemanticChange[] {
  const allChanges: SemanticChange[] = [];
  for (const snapshot of snapshots) {
    allChanges.push(...snapshot.semanticChanges);
  }

  const priority: Partial<Record<ChangeType, number>> = {
    [ChangeType.ADD_IMPORT]: 0,
    [ChangeType.ADD_HOOK_CALL]: 1,
    [ChangeType.ADD_VARIABLE]: 2,
    [ChangeType.ADD_CONSTANT]: 2,
    [ChangeType.WRAP_JSX]: 3,
    [ChangeType.ADD_JSX_ELEMENT]: 4,
    [ChangeType.MODIFY_FUNCTION]: 5,
    [ChangeType.MODIFY_JSX_PROPS]: 5,
  };

  return allChanges.sort((a, b) => (priority[a.changeType] ?? 10) - (priority[b.changeType] ?? 10));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Strategy implementations
// =============================================================================

function executeImportStrategy(context: MergeContext): MergeResult {
  const lines = context.baselineContent.split(/\r?\n/);
  const ext = getExtension(context.filePath);

  const importsToAdd: string[] = [];
  const importsToRemove = new Set<string>();

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.changeType === ChangeType.ADD_IMPORT && change.contentAfter) {
        importsToAdd.push(change.contentAfter.trim());
      } else if (change.changeType === ChangeType.REMOVE_IMPORT && change.contentBefore) {
        importsToRemove.add(change.contentBefore.trim());
      }
    }
  }

  const importEndLine = findImportSectionEnd(lines, ext);

  const existingImports = new Set<string>();
  for (let i = 0; i < importEndLine; i++) {
    const stripped = lines[i].trim();
    if (isImportLine(stripped, ext)) existingImports.add(stripped);
  }

  const seen = new Set<string>();
  const newImports: string[] = [];
  for (const imp of importsToAdd) {
    if (!existingImports.has(imp) && !importsToRemove.has(imp) && !seen.has(imp)) {
      newImports.push(imp);
      seen.add(imp);
    }
  }

  // Remove imports that should be removed
  const resultLines = lines.filter((line) => !importsToRemove.has(line.trim()));

  if (newImports.length > 0) {
    const insertPos = findImportSectionEnd(resultLines, ext);
    for (let i = newImports.length - 1; i >= 0; i--) {
      resultLines.splice(insertPos, 0, newImports[i]);
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: resultLines.join('\n'),
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Combined ${newImports.length} imports from ${context.taskSnapshots.length} tasks`,
  };
}

function executeHooksStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;
  const hooks: string[] = [];

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.changeType === ChangeType.ADD_HOOK_CALL) {
        const hookContent = extractHookCall(change);
        if (hookContent) hooks.push(hookContent);
      }
    }
  }

  const funcLocation = context.conflict.location;
  if (funcLocation.startsWith('function:')) {
    const funcName = funcLocation.split(':')[1];
    if (funcName) {
      content = insertHooksIntoFunction(content, funcName, hooks);
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Added ${hooks.length} hooks to function start`,
  };
}

function executeHooksThenWrapStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;
  const hooks: string[] = [];
  const wraps: Array<[string, string]> = [];

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.changeType === ChangeType.ADD_HOOK_CALL) {
        const hookContent = extractHookCall(change);
        if (hookContent) hooks.push(hookContent);
      } else if (change.changeType === ChangeType.WRAP_JSX) {
        const wrapper = extractJsxWrapper(change);
        if (wrapper) wraps.push(wrapper);
      }
    }
  }

  const funcLocation = context.conflict.location;
  if (funcLocation.startsWith('function:')) {
    const funcName = funcLocation.split(':')[1];
    if (funcName) {
      if (hooks.length > 0) {
        content = insertHooksIntoFunction(content, funcName, hooks);
      }
      for (const [wrapperName, wrapperProps] of wraps) {
        content = wrapFunctionReturn(content, funcName, wrapperName, wrapperProps);
      }
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Added ${hooks.length} hooks and ${wraps.length} JSX wrappers`,
  };
}

function executeAppendFunctionsStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;
  const newFunctions: string[] = [];

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.changeType === ChangeType.ADD_FUNCTION && change.contentAfter) {
        newFunctions.push(change.contentAfter);
      }
    }
  }

  const insertPos = findFunctionInsertPosition(content);

  if (insertPos !== null) {
    const lines = content.split(/\r?\n/);
    let offset = insertPos;
    for (const func of newFunctions) {
      lines.splice(offset, 0, '');
      lines.splice(offset + 1, 0, func);
      offset += 2 + (func.match(/\n/g) ?? []).length;
    }
    content = lines.join('\n');
  } else {
    for (const func of newFunctions) {
      content += `\n\n${func}`;
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Appended ${newFunctions.length} new functions`,
  };
}

function executeAppendMethodsStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;
  const newMethods: Map<string, string[]> = new Map();

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.changeType === ChangeType.ADD_METHOD && change.contentAfter) {
        const className = change.target.includes('.') ? change.target.split('.')[0] : null;
        if (className) {
          if (!newMethods.has(className)) newMethods.set(className, []);
          newMethods.get(className)!.push(change.contentAfter);
        }
      }
    }
  }

  for (const [className, methods] of newMethods) {
    content = insertMethodsIntoClass(content, className, methods);
  }

  const totalMethods = [...newMethods.values()].reduce((sum, methods) => sum + methods.length, 0);
  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Added ${totalMethods} methods to ${newMethods.size} classes`,
  };
}

function executeCombinePropsStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;

  if (context.taskSnapshots.length > 0) {
    const lastSnapshot = context.taskSnapshots[context.taskSnapshots.length - 1];
    if (lastSnapshot.semanticChanges.length > 0) {
      const lastChange = lastSnapshot.semanticChanges[lastSnapshot.semanticChanges.length - 1];
      if (lastChange.contentAfter) {
        content = applyContentChange(content, lastChange.contentBefore, lastChange.contentAfter);
      }
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Combined props from ${context.taskSnapshots.length} tasks`,
  };
}

function executeOrderByDependencyStrategy(context: MergeContext): MergeResult {
  const orderedChanges = topologicalSortChanges(context.taskSnapshots);
  let content = context.baselineContent;

  for (const change of orderedChanges) {
    if (change.contentAfter) {
      if (change.changeType === ChangeType.ADD_HOOK_CALL) {
        const funcName = change.target.includes('.') ? change.target.split('.').pop()! : change.target;
        const hookCall = extractHookCall(change);
        if (hookCall) {
          content = insertHooksIntoFunction(content, funcName, [hookCall]);
        }
      } else if (change.changeType === ChangeType.WRAP_JSX) {
        const wrapper = extractJsxWrapper(change);
        if (wrapper) {
          const funcName = change.target.includes('.') ? change.target.split('.').pop()! : change.target;
          content = wrapFunctionReturn(content, funcName, wrapper[0], wrapper[1]);
        }
      }
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: 'Changes applied in dependency order',
  };
}

function executeOrderByTimeStrategy(context: MergeContext): MergeResult {
  const sortedSnapshots = [...context.taskSnapshots].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );

  let content = context.baselineContent;

  for (const snapshot of sortedSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (change.contentBefore && change.contentAfter) {
        content = applyContentChange(content, change.contentBefore, change.contentAfter);
      }
    }
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Applied ${sortedSnapshots.length} changes in chronological order`,
  };
}

function executeAppendStatementsStrategy(context: MergeContext): MergeResult {
  let content = context.baselineContent;
  const additions: string[] = [];

  for (const snapshot of context.taskSnapshots) {
    for (const change of snapshot.semanticChanges) {
      if (isAdditiveChange(change) && change.contentAfter) {
        additions.push(change.contentAfter);
      }
    }
  }

  for (const addition of additions) {
    content += `\n${addition}`;
  }

  return {
    decision: MergeDecision.AUTO_MERGED,
    filePath: context.filePath,
    mergedContent: content,
    conflictsResolved: [context.conflict],
    conflictsRemaining: [],
    aiCallsMade: 0,
    tokensUsed: 0,
    explanation: `Appended ${additions.length} statements`,
  };
}

// =============================================================================
// AutoMerger class
// =============================================================================

type StrategyHandler = (context: MergeContext) => MergeResult;

/**
 * Performs deterministic merges without AI.
 *
 * Implements multiple merge strategies that can be applied
 * when the ConflictDetector determines changes are compatible.
 */
export class AutoMerger {
  private readonly strategyHandlers: Map<MergeStrategy, StrategyHandler>;

  constructor() {
    this.strategyHandlers = new Map([
      [MergeStrategy.COMBINE_IMPORTS, executeImportStrategy],
      [MergeStrategy.HOOKS_FIRST, executeHooksStrategy],
      [MergeStrategy.HOOKS_THEN_WRAP, executeHooksThenWrapStrategy],
      [MergeStrategy.APPEND_FUNCTIONS, executeAppendFunctionsStrategy],
      [MergeStrategy.APPEND_METHODS, executeAppendMethodsStrategy],
      [MergeStrategy.COMBINE_PROPS, executeCombinePropsStrategy],
      [MergeStrategy.ORDER_BY_DEPENDENCY, executeOrderByDependencyStrategy],
      [MergeStrategy.ORDER_BY_TIME, executeOrderByTimeStrategy],
      [MergeStrategy.APPEND_STATEMENTS, executeAppendStatementsStrategy],
    ]);
  }

  /**
   * Perform a merge using the specified strategy.
   */
  merge(context: MergeContext, strategy: MergeStrategy): MergeResult {
    const handler = this.strategyHandlers.get(strategy);

    if (!handler) {
      return {
        decision: MergeDecision.FAILED,
        filePath: context.filePath,
        conflictsResolved: [],
        conflictsRemaining: [],
        aiCallsMade: 0,
        tokensUsed: 0,
        explanation: '',
        error: `No handler for strategy: ${strategy}`,
      };
    }

    try {
      return handler(context);
    } catch (err) {
      return {
        decision: MergeDecision.FAILED,
        filePath: context.filePath,
        conflictsResolved: [],
        conflictsRemaining: [],
        aiCallsMade: 0,
        tokensUsed: 0,
        explanation: '',
        error: `Auto-merge failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  canHandle(strategy: MergeStrategy): boolean {
    return this.strategyHandlers.has(strategy);
  }
}
