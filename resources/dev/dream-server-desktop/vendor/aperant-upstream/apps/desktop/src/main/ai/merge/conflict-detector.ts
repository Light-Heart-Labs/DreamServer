/**
 * Conflict Detector
 * =================
 *
 * Detects conflicts between multiple task changes using rule-based analysis.
 * See apps/desktop/src/main/ai/merge/conflict-detector.ts for the TypeScript implementation.
 *
 * 80+ compatibility rules encode domain knowledge about which changes conflict.
 * The detector determines:
 * 1. Which changes from different tasks overlap
 * 2. Whether overlapping changes are compatible
 * 3. What merge strategy can be used for compatible changes
 * 4. Which conflicts need AI or human intervention
 */

import {
  ChangeType,
  ConflictSeverity,
  MergeStrategy,
  type ConflictRegion,
  type FileAnalysis,
  type SemanticChange,
} from './types';

// =============================================================================
// Compatibility Rule
// =============================================================================

export interface CompatibilityRule {
  changeTypeA: ChangeType;
  changeTypeB: ChangeType;
  compatible: boolean;
  strategy?: MergeStrategy;
  reason: string;
  bidirectional: boolean;
}

type RuleIndex = Map<string, CompatibilityRule>;

function ruleKey(a: ChangeType, b: ChangeType): string {
  return `${a}::${b}`;
}

// =============================================================================
// Default Rules (80+ compatibility rules)
// =============================================================================

function buildDefaultRules(): CompatibilityRule[] {
  const rules: CompatibilityRule[] = [];

  // ========================================
  // IMPORT RULES - Generally compatible
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.ADD_IMPORT,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Adding different imports is always compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.REMOVE_IMPORT,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Import add/remove may conflict if same module',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_IMPORT,
    changeTypeB: ChangeType.REMOVE_IMPORT,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Removing same imports from both tasks is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.MODIFY_IMPORT,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Import add and modification may conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_IMPORT,
    changeTypeB: ChangeType.MODIFY_IMPORT,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple import modifications need analysis',
    bidirectional: true,
  });

  // ========================================
  // FUNCTION RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_FUNCTION,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding different functions is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_FUNCTION,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: "Adding a function doesn't affect modifications to other functions",
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_FUNCTION,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple modifications to same function need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_FUNCTION,
    changeTypeB: ChangeType.REMOVE_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Adding and removing functions needs analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_FUNCTION,
    changeTypeB: ChangeType.REMOVE_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Removing same function from both tasks is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_FUNCTION,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'One task removes function, another modifies it - conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_FUNCTION,
    changeTypeB: ChangeType.RENAME_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Function addition with rename needs careful handling',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.RENAME_FUNCTION,
    changeTypeB: ChangeType.RENAME_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple renames need analysis',
    bidirectional: true,
  });

  // ========================================
  // REACT HOOK RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.ADD_HOOK_CALL,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_DEPENDENCY,
    reason: 'Multiple hooks can be added with correct ordering',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.WRAP_JSX,
    compatible: true,
    strategy: MergeStrategy.HOOKS_THEN_WRAP,
    reason: 'Hooks are added at function start, wrap is on return',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.HOOKS_FIRST,
    reason: 'Hooks go at start, other modifications likely elsewhere',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.REMOVE_HOOK_CALL,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Adding and removing hooks may conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_HOOK_CALL,
    changeTypeB: ChangeType.REMOVE_HOOK_CALL,
    compatible: true,
    strategy: MergeStrategy.HOOKS_FIRST,
    reason: 'Removing different hooks is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.HOOKS_FIRST,
    reason: 'Hook addition and new function are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.ADD_VARIABLE,
    compatible: true,
    strategy: MergeStrategy.HOOKS_FIRST,
    reason: 'Hook and variable additions are independent',
    bidirectional: true,
  });

  // ========================================
  // JSX RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.WRAP_JSX,
    changeTypeB: ChangeType.WRAP_JSX,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_DEPENDENCY,
    reason: 'Multiple wraps can be nested in correct order',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.WRAP_JSX,
    changeTypeB: ChangeType.ADD_JSX_ELEMENT,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Wrapping and adding elements are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_JSX_PROPS,
    changeTypeB: ChangeType.MODIFY_JSX_PROPS,
    compatible: true,
    strategy: MergeStrategy.COMBINE_PROPS,
    reason: 'Props can usually be combined if different',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.WRAP_JSX,
    changeTypeB: ChangeType.UNWRAP_JSX,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'One task wraps JSX, another unwraps - conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.UNWRAP_JSX,
    changeTypeB: ChangeType.UNWRAP_JSX,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple unwrap operations need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_JSX_ELEMENT,
    changeTypeB: ChangeType.ADD_JSX_ELEMENT,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding different JSX elements is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.WRAP_JSX,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'JSX wrapping combined with function modification needs analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_HOOK_CALL,
    changeTypeB: ChangeType.MODIFY_JSX_PROPS,
    compatible: true,
    strategy: MergeStrategy.HOOKS_FIRST,
    reason: 'Hook and prop changes are independent',
    bidirectional: true,
  });

  // ========================================
  // CLASS/METHOD RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_METHOD,
    changeTypeB: ChangeType.ADD_METHOD,
    compatible: true,
    strategy: MergeStrategy.APPEND_METHODS,
    reason: 'Adding different methods is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_METHOD,
    changeTypeB: ChangeType.MODIFY_METHOD,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple modifications to same method need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_CLASS,
    changeTypeB: ChangeType.MODIFY_CLASS,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: "New classes don't conflict with modifications",
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_CLASS,
    changeTypeB: ChangeType.ADD_CLASS,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding different classes is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_CLASS,
    changeTypeB: ChangeType.MODIFY_CLASS,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple class modifications need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_CLASS,
    changeTypeB: ChangeType.MODIFY_CLASS,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'One task removes class, another modifies it - conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_METHOD,
    changeTypeB: ChangeType.MODIFY_METHOD,
    compatible: true,
    strategy: MergeStrategy.APPEND_METHODS,
    reason: 'Adding and modifying different methods is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_METHOD,
    changeTypeB: ChangeType.MODIFY_METHOD,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'One task removes method, another modifies it - conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_PROPERTY,
    changeTypeB: ChangeType.ADD_PROPERTY,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding different properties is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_METHOD,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding methods and functions are independent',
    bidirectional: true,
  });

  // ========================================
  // VARIABLE RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_VARIABLE,
    changeTypeB: ChangeType.ADD_VARIABLE,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding different variables is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_CONSTANT,
    changeTypeB: ChangeType.ADD_VARIABLE,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Constants and variables are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_CONSTANT,
    changeTypeB: ChangeType.ADD_CONSTANT,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding different constants is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_VARIABLE,
    changeTypeB: ChangeType.MODIFY_VARIABLE,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple variable modifications need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_VARIABLE,
    changeTypeB: ChangeType.MODIFY_VARIABLE,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding and modifying different variables is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_VARIABLE,
    changeTypeB: ChangeType.MODIFY_VARIABLE,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'One task removes variable, another modifies it - conflict',
    bidirectional: true,
  });

  // ========================================
  // TYPE RULES (TypeScript)
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_TYPE,
    changeTypeB: ChangeType.ADD_TYPE,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding different types is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_INTERFACE,
    changeTypeB: ChangeType.ADD_INTERFACE,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding different interfaces is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_INTERFACE,
    changeTypeB: ChangeType.MODIFY_INTERFACE,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple interface modifications need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_TYPE,
    changeTypeB: ChangeType.MODIFY_TYPE,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding and modifying different types is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.MODIFY_TYPE,
    changeTypeB: ChangeType.MODIFY_TYPE,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Multiple type modifications need analysis',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_INTERFACE,
    changeTypeB: ChangeType.MODIFY_INTERFACE,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding and modifying different interfaces is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_TYPE,
    changeTypeB: ChangeType.ADD_INTERFACE,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Adding types and interfaces is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_TYPE,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Type and function additions are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_INTERFACE,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Interface and function additions are independent',
    bidirectional: true,
  });

  // ========================================
  // DECORATOR RULES (Python)
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_DECORATOR,
    changeTypeB: ChangeType.ADD_DECORATOR,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_DEPENDENCY,
    reason: 'Decorators can be stacked with correct order',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.REMOVE_DECORATOR,
    changeTypeB: ChangeType.REMOVE_DECORATOR,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_DEPENDENCY,
    reason: 'Removing different decorators is compatible',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_DECORATOR,
    changeTypeB: ChangeType.REMOVE_DECORATOR,
    compatible: false,
    strategy: MergeStrategy.AI_REQUIRED,
    reason: 'Decorator add/remove may conflict',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_DECORATOR,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_DEPENDENCY,
    reason: 'Decorator addition and function modification are usually independent',
    bidirectional: true,
  });

  // ========================================
  // COMMENT RULES - Low priority
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_COMMENT,
    changeTypeB: ChangeType.ADD_COMMENT,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Comments are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_COMMENT,
    changeTypeB: ChangeType.MODIFY_COMMENT,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Adding and modifying comments are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_COMMENT,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_FUNCTIONS,
    reason: 'Comment and function additions are independent',
    bidirectional: true,
  });

  // Formatting changes are always compatible
  rules.push({
    changeTypeA: ChangeType.FORMATTING_ONLY,
    changeTypeB: ChangeType.FORMATTING_ONLY,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_TIME,
    reason: "Formatting doesn't affect semantics",
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.FORMATTING_ONLY,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_TIME,
    reason: 'Formatting and function addition are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.FORMATTING_ONLY,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.ORDER_BY_TIME,
    reason: 'Formatting change and function modification are independent',
    bidirectional: true,
  });

  // ========================================
  // CROSS-CATEGORY RULES
  // ========================================

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Import and function additions are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.ADD_CLASS,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Import and class additions are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.ADD_VARIABLE,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Import and variable additions are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_IMPORT,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.COMBINE_IMPORTS,
    reason: 'Import addition and function modification are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_VARIABLE,
    changeTypeB: ChangeType.ADD_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Variable and function additions are independent',
    bidirectional: true,
  });

  rules.push({
    changeTypeA: ChangeType.ADD_VARIABLE,
    changeTypeB: ChangeType.MODIFY_FUNCTION,
    compatible: true,
    strategy: MergeStrategy.APPEND_STATEMENTS,
    reason: 'Variable addition and function modification are likely independent',
    bidirectional: true,
  });

  return rules;
}

function indexRules(rules: CompatibilityRule[]): RuleIndex {
  const index: RuleIndex = new Map();
  for (const rule of rules) {
    index.set(ruleKey(rule.changeTypeA, rule.changeTypeB), rule);
    if (rule.bidirectional && rule.changeTypeA !== rule.changeTypeB) {
      index.set(ruleKey(rule.changeTypeB, rule.changeTypeA), rule);
    }
  }
  return index;
}

// =============================================================================
// Conflict detection
// =============================================================================

function rangesOverlap(ranges: Array<[number, number]>): boolean {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i][1] >= sorted[i + 1][0]) return true;
  }
  return false;
}

function assessSeverity(changeTypes: ChangeType[], changes: SemanticChange[]): ConflictSeverity {
  const modifyTypes = new Set([
    ChangeType.MODIFY_FUNCTION,
    ChangeType.MODIFY_METHOD,
    ChangeType.MODIFY_CLASS,
  ]);
  const modifyCount = changeTypes.filter((ct) => modifyTypes.has(ct)).length;

  if (modifyCount >= 2) {
    const lineRanges: Array<[number, number]> = changes.map((c) => [c.lineStart, c.lineEnd]);
    if (rangesOverlap(lineRanges)) return ConflictSeverity.CRITICAL;
  }

  const structuralTypes = new Set([
    ChangeType.WRAP_JSX,
    ChangeType.UNWRAP_JSX,
    ChangeType.REMOVE_FUNCTION,
    ChangeType.REMOVE_CLASS,
  ]);
  if (changeTypes.some((ct) => structuralTypes.has(ct))) return ConflictSeverity.HIGH;
  if (modifyCount >= 1) return ConflictSeverity.MEDIUM;
  return ConflictSeverity.LOW;
}

function analyzeLocationConflict(
  filePath: string,
  location: string,
  taskChanges: Array<[string, SemanticChange]>,
  ruleIndex: RuleIndex,
): ConflictRegion | null {
  const tasks = taskChanges.map(([tid]) => tid);
  const changes = taskChanges.map(([, change]) => change);
  const changeTypes = changes.map((c) => c.changeType);

  // Check if all changes target the same thing
  const targets = new Set(changes.map((c) => c.target));
  if (targets.size > 1) {
    // Different targets at same location - likely compatible
    return null;
  }

  let allCompatible = true;
  let finalStrategy: MergeStrategy | undefined;
  const reasons: string[] = [];

  for (let i = 0; i < changeTypes.length; i++) {
    for (let j = i + 1; j < changeTypes.length; j++) {
      const rule = ruleIndex.get(ruleKey(changeTypes[i], changeTypes[j]));
      if (rule) {
        if (!rule.compatible) {
          allCompatible = false;
          reasons.push(rule.reason);
        } else if (rule.strategy) {
          finalStrategy = rule.strategy;
        }
      } else {
        allCompatible = false;
        reasons.push(`No rule for ${changeTypes[i]} + ${changeTypes[j]}`);
      }
    }
  }

  const severity = allCompatible ? ConflictSeverity.NONE : assessSeverity(changeTypes, changes);

  return {
    filePath,
    location,
    tasksInvolved: tasks,
    changeTypes,
    severity,
    canAutoMerge: allCompatible,
    mergeStrategy: allCompatible ? finalStrategy : MergeStrategy.AI_REQUIRED,
    reason: reasons.length > 0 ? reasons.join(' | ') : 'Changes are compatible',
  };
}

function detectConflictsInternal(
  taskAnalyses: Map<string, FileAnalysis>,
  ruleIndex: RuleIndex,
): ConflictRegion[] {
  if (taskAnalyses.size <= 1) return [];

  const conflicts: ConflictRegion[] = [];
  const locationChanges = new Map<string, Array<[string, SemanticChange]>>();

  for (const [taskId, analysis] of taskAnalyses) {
    for (const change of analysis.changes) {
      if (!locationChanges.has(change.location)) {
        locationChanges.set(change.location, []);
      }
      locationChanges.get(change.location)!.push([taskId, change]);
    }
  }

  const filePath = taskAnalyses.values().next().value?.filePath ?? '';

  for (const [location, taskChanges] of locationChanges) {
    if (taskChanges.length <= 1) continue;

    const conflict = analyzeLocationConflict(filePath, location, taskChanges, ruleIndex);
    if (conflict) conflicts.push(conflict);
  }

  return conflicts;
}

function analyzeCompatibility(
  changeA: SemanticChange,
  changeB: SemanticChange,
  ruleIndex: RuleIndex,
): [boolean, MergeStrategy | undefined, string] {
  const rule = ruleIndex.get(ruleKey(changeA.changeType, changeB.changeType));
  if (rule) {
    return [rule.compatible, rule.strategy, rule.reason];
  }
  return [false, MergeStrategy.AI_REQUIRED, 'No compatibility rule defined'];
}

function explainConflict(conflict: ConflictRegion): string {
  const lines: string[] = [
    `Conflict at ${conflict.filePath}:${conflict.location}`,
    `Tasks involved: ${conflict.tasksInvolved.join(', ')}`,
    `Change types: ${conflict.changeTypes.join(', ')}`,
    `Severity: ${conflict.severity}`,
    `Can auto-merge: ${conflict.canAutoMerge}`,
    `Merge strategy: ${conflict.mergeStrategy ?? 'none'}`,
    `Reason: ${conflict.reason}`,
  ];
  return lines.join('\n');
}

function getCompatiblePairs(rules: CompatibilityRule[]): Array<[ChangeType, ChangeType, MergeStrategy]> {
  return rules
    .filter((r) => r.compatible && r.strategy)
    .map((r) => [r.changeTypeA, r.changeTypeB, r.strategy!] as [ChangeType, ChangeType, MergeStrategy]);
}

// =============================================================================
// ConflictDetector class
// =============================================================================

/**
 * Detects and classifies conflicts between task changes.
 *
 * Uses a comprehensive rule base to determine compatibility
 * between different semantic change types, enabling maximum
 * auto-merge capability.
 */
export class ConflictDetector {
  private readonly rules: CompatibilityRule[];
  private readonly ruleIndex: RuleIndex;

  constructor() {
    this.rules = buildDefaultRules();
    this.ruleIndex = indexRules(this.rules);
  }

  addRule(rule: CompatibilityRule): void {
    this.rules.push(rule);
    this.ruleIndex.set(ruleKey(rule.changeTypeA, rule.changeTypeB), rule);
    if (rule.bidirectional && rule.changeTypeA !== rule.changeTypeB) {
      this.ruleIndex.set(ruleKey(rule.changeTypeB, rule.changeTypeA), rule);
    }
  }

  detectConflicts(taskAnalyses: Map<string, FileAnalysis>): ConflictRegion[] {
    return detectConflictsInternal(taskAnalyses, this.ruleIndex);
  }

  analyzeCompatibility(
    changeA: SemanticChange,
    changeB: SemanticChange,
  ): [boolean, MergeStrategy | undefined, string] {
    return analyzeCompatibility(changeA, changeB, this.ruleIndex);
  }

  getCompatiblePairs(): Array<[ChangeType, ChangeType, MergeStrategy]> {
    return getCompatiblePairs(this.rules);
  }

  explainConflict(conflict: ConflictRegion): string {
    return explainConflict(conflict);
  }
}

// Convenience function
export function analyzeChangeCompatibility(
  changeA: SemanticChange,
  changeB: SemanticChange,
  detector?: ConflictDetector,
): [boolean, MergeStrategy | undefined, string] {
  const d = detector ?? new ConflictDetector();
  return d.analyzeCompatibility(changeA, changeB);
}
