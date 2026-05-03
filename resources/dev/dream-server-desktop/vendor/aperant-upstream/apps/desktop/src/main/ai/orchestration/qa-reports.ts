/**
 * QA Report Generation
 * ====================
 *
 * See apps/desktop/src/main/ai/orchestration/qa-reports.ts for the TypeScript implementation.
 *
 * Handles:
 * - QA summary report (qa_report.md)
 * - Escalation report (QA_ESCALATION.md)
 * - Manual test plan (MANUAL_TEST_PLAN.md)
 * - Issue similarity detection
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QAIssue, QAIterationRecord } from './qa-loop';

// =============================================================================
// Constants
// =============================================================================

const RECURRING_ISSUE_THRESHOLD = 3;
const ISSUE_SIMILARITY_THRESHOLD = 0.8;
const MAX_QA_ITERATIONS = 50;

// =============================================================================
// Issue Similarity
// =============================================================================

/**
 * Normalize an issue into a comparison key.
 * Strips common prefixes and lowercases.
 */
function normalizeIssueKey(issue: QAIssue): string {
  let title = (issue.title ?? '').toLowerCase().trim();
  const location = (issue.location ?? '').toLowerCase().trim();

  for (const prefix of ['error:', 'issue:', 'bug:', 'fix:']) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
    }
  }

  return `${title}|${location}`;
}

/**
 * Tokenize a string into a set of words.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0),
  );
}

/**
 * Calculate normalized token overlap (Jaccard similarity) between two strings.
 */
function tokenOverlap(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Determine whether two QA issues are similar based on title + description overlap.
 *
 * @param a First issue
 * @param b Second issue
 * @param threshold Minimum overlap score (default: 0.8)
 */
export function issuesSimilar(a: QAIssue, b: QAIssue, threshold = ISSUE_SIMILARITY_THRESHOLD): boolean {
  const keyA = normalizeIssueKey(a);
  const keyB = normalizeIssueKey(b);

  // Combine key and description for richer comparison
  const textA = `${keyA} ${(a.description ?? '').toLowerCase().trim()}`;
  const textB = `${keyB} ${(b.description ?? '').toLowerCase().trim()}`;

  return tokenOverlap(textA, textB) >= threshold;
}

// =============================================================================
// Report Generation
// =============================================================================

/**
 * Generate a QA summary report for display in the UI.
 * Written to specDir/qa_report.md.
 *
 * @param iterations Full iteration history
 * @param finalStatus Overall outcome
 */
export function generateQAReport(
  iterations: QAIterationRecord[],
  finalStatus: 'approved' | 'escalated' | 'max_iterations',
): string {
  const now = new Date().toISOString();
  const totalIterations = iterations.length;
  const approvedIterations = iterations.filter((r) => r.status === 'approved').length;
  const rejectedIterations = iterations.filter((r) => r.status === 'rejected').length;
  const errorIterations = iterations.filter((r) => r.status === 'error').length;
  const totalIssues = iterations.reduce((sum, r) => sum + r.issues.length, 0);

  const totalDurationMs = iterations.reduce((sum, r) => sum + r.durationMs, 0);
  const totalDurationSec = (totalDurationMs / 1000).toFixed(1);

  const statusLabel =
    finalStatus === 'approved'
      ? 'APPROVED'
      : finalStatus === 'escalated'
        ? 'ESCALATED'
        : 'MAX ITERATIONS REACHED';

  const statusEmoji = finalStatus === 'approved' ? 'PASSED' : 'FAILED';

  let report = `# QA Report

**Generated**: ${now}
**Final Status**: ${statusLabel}
**Result**: ${statusEmoji}

## Summary

| Metric | Value |
|--------|-------|
| Total Iterations | ${totalIterations} |
| Approved Iterations | ${approvedIterations} |
| Rejected Iterations | ${rejectedIterations} |
| Error Iterations | ${errorIterations} |
| Total Issues Found | ${totalIssues} |
| Total Duration | ${totalDurationSec}s |

`;

  if (iterations.length === 0) {
    report += `## No iterations recorded.\n`;
    return report;
  }

  report += `## Iteration History\n\n`;

  for (const record of iterations) {
    const durationSec = (record.durationMs / 1000).toFixed(1);
    const statusIcon = record.status === 'approved' ? 'PASS' : record.status === 'rejected' ? 'FAIL' : 'ERROR';

    report += `### Iteration ${record.iteration} — ${statusIcon}\n\n`;
    report += `- **Status**: ${record.status}\n`;
    report += `- **Duration**: ${durationSec}s\n`;
    report += `- **Timestamp**: ${record.timestamp}\n`;
    report += `- **Issues Found**: ${record.issues.length}\n`;

    if (record.issues.length > 0) {
      report += `\n#### Issues\n\n`;
      for (const issue of record.issues) {
        const typeTag = issue.type ? ` \`[${issue.type.toUpperCase()}]\`` : '';
        report += `- **${issue.title}**${typeTag}\n`;
        if (issue.location) {
          report += `  - Location: \`${issue.location}\`\n`;
        }
        if (issue.description) {
          report += `  - ${issue.description}\n`;
        }
        if (issue.fix_required) {
          report += `  - Fix required: ${issue.fix_required}\n`;
        }
      }
    }

    report += `\n`;
  }

  if (finalStatus === 'approved') {
    report += `## Result\n\nQA validation passed successfully. The implementation meets all acceptance criteria.\n`;
  } else if (finalStatus === 'max_iterations') {
    report += `## Result\n\nQA validation reached the maximum of ${MAX_QA_ITERATIONS} iterations without approval. Human review required.\n`;
  } else {
    report += `## Result\n\nQA validation was escalated to human review due to recurring issues. See QA_ESCALATION.md for details.\n`;
  }

  return report;
}

/**
 * Generate an escalation report for recurring QA issues.
 * Written to specDir/QA_ESCALATION.md.
 *
 * @param iterations Full iteration history
 * @param recurringIssues Issues that have recurred beyond the threshold
 */
export function generateEscalationReport(
  iterations: QAIterationRecord[],
  recurringIssues: QAIssue[],
): string {
  const now = new Date().toISOString();
  const totalIterations = iterations.length;
  const totalIssues = iterations.reduce((sum, r) => sum + r.issues.length, 0);
  const uniqueIssueTitles = new Set(
    iterations.flatMap((r) => r.issues.map((i) => i.title.toLowerCase())),
  ).size;
  const approvedCount = iterations.filter((r) => r.status === 'approved').length;
  const fixSuccessRate = totalIterations > 0 ? (approvedCount / totalIterations).toFixed(1) : '0';

  // Compute most common issues
  const titleCounts = new Map<string, number>();
  for (const record of iterations) {
    for (const issue of record.issues) {
      const key = issue.title.toLowerCase().trim();
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    }
  }
  const topIssues = [...titleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let report = `# QA Escalation — Human Intervention Required

**Generated**: ${now}
**Iteration**: ${totalIterations}/${MAX_QA_ITERATIONS}
**Reason**: Recurring issues detected (${RECURRING_ISSUE_THRESHOLD}+ occurrences)

## Summary

- **Total QA Iterations**: ${totalIterations}
- **Total Issues Found**: ${totalIssues}
- **Unique Issues**: ${uniqueIssueTitles}
- **Fix Success Rate**: ${fixSuccessRate}%

## Recurring Issues

These issues have appeared ${RECURRING_ISSUE_THRESHOLD}+ times without being resolved:

`;

  for (let i = 0; i < recurringIssues.length; i++) {
    const issue = recurringIssues[i];
    report += `### ${i + 1}. ${issue.title}\n\n`;
    report += `- **Location**: ${issue.location ?? 'N/A'}\n`;
    report += `- **Type**: ${issue.type ?? 'N/A'}\n`;
    if (issue.description) {
      report += `- **Description**: ${issue.description}\n`;
    }
    if (issue.fix_required) {
      report += `- **Fix Required**: ${issue.fix_required}\n`;
    }
    report += `\n`;
  }

  if (topIssues.length > 0) {
    report += `## Most Common Issues (All Time)\n\n`;
    for (const [title, count] of topIssues) {
      report += `- **${title}** (${count} occurrence${count === 1 ? '' : 's'})\n`;
    }
    report += `\n`;
  }

  report += `## Recommended Actions

1. Review the recurring issues manually
2. Check if the issue stems from:
   - Unclear specification
   - Complex edge case
   - Infrastructure/environment problem
   - Test framework limitations
3. Update the spec or acceptance criteria if needed
4. Create a fix request in \`QA_FIX_REQUEST.md\` and re-run QA

## Related Files

- \`QA_FIX_REQUEST.md\` — Write human fix instructions here
- \`qa_report.md\` — Latest QA report
- \`implementation_plan.json\` — Full iteration history
`;

  return report;
}

/**
 * Generate a manual test plan for projects with no automated test framework.
 * Written to specDir/MANUAL_TEST_PLAN.md.
 *
 * @param specDir Spec directory path
 * @param projectDir Project root directory path
 */
export async function generateManualTestPlan(specDir: string, projectDir: string): Promise<string> {
  const now = new Date().toISOString();
  const specName = specDir.split('/').pop() ?? specDir;

  // Read spec.md for acceptance criteria if available
  let specContent = '';
  try {
    specContent = await readFile(join(specDir, 'spec.md'), 'utf-8');
  } catch {
    // spec.md not available — proceed without it
  }

  // Extract acceptance criteria from spec content
  const acceptanceCriteria: string[] = [];
  if (specContent.includes('## Acceptance Criteria')) {
    let inCriteria = false;
    for (const line of specContent.split('\n')) {
      if (line.includes('## Acceptance Criteria')) {
        inCriteria = true;
        continue;
      }
      if (inCriteria && line.startsWith('## ')) {
        break;
      }
      if (inCriteria && line.trim().startsWith('- ')) {
        acceptanceCriteria.push(line.trim().slice(2));
      }
    }
  }

  // Detect if this is a no-test project
  const noTest = isNoTestProject(specDir, projectDir);

  let plan = `# Manual Test Plan — ${specName}

**Generated**: ${now}
**Reason**: ${noTest ? 'No automated test framework detected' : 'Supplemental manual verification checklist'}

## Overview

${
    noTest
      ? 'This project does not have automated testing infrastructure. Please perform manual verification of the implementation using the checklist below.'
      : 'Use this checklist as a supplement to automated tests for full verification.'
  }

## Pre-Test Setup

1. [ ] Ensure all dependencies are installed
2. [ ] Start any required services
3. [ ] Set up test environment variables

## Acceptance Criteria Verification

`;

  if (acceptanceCriteria.length > 0) {
    for (let i = 0; i < acceptanceCriteria.length; i++) {
      plan += `${i + 1}. [ ] ${acceptanceCriteria[i]}\n`;
    }
  } else {
    plan += `1. [ ] Core functionality works as expected
2. [ ] Edge cases are handled
3. [ ] Error states are handled gracefully
4. [ ] UI/UX meets requirements (if applicable)
`;
  }

  plan += `

## Functional Tests

### Happy Path
- [ ] Primary use case works correctly
- [ ] Expected outputs are generated
- [ ] No console errors

### Edge Cases
- [ ] Empty input handling
- [ ] Invalid input handling
- [ ] Boundary conditions

### Error Handling
- [ ] Errors display appropriate messages
- [ ] System recovers gracefully from errors
- [ ] No data loss on failure

## Non-Functional Tests

### Performance
- [ ] Response time is acceptable
- [ ] No memory leaks observed
- [ ] No excessive resource usage

### Security
- [ ] Input is properly sanitized
- [ ] No sensitive data exposed
- [ ] Authentication works correctly (if applicable)

## Browser/Environment Testing (if applicable)

- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Mobile viewport

## Sign-off

**Tester**: _______________
**Date**: _______________
**Result**: [ ] PASS  [ ] FAIL

### Notes
_Add any observations or issues found during testing_

`;

  return plan;
}

// =============================================================================
// No-Test Project Detection
// =============================================================================

/**
 * Determine if the project has no automated test infrastructure.
 *
 * @param specDir Spec directory
 * @param projectDir Project root directory
 */
export function isNoTestProject(specDir: string, projectDir: string): boolean {
  // Check for test config files
  const testConfigFiles = [
    'pytest.ini',
    'pyproject.toml',
    'setup.cfg',
    'jest.config.js',
    'jest.config.ts',
    'vitest.config.js',
    'vitest.config.ts',
    'karma.conf.js',
    'cypress.config.js',
    'playwright.config.ts',
    '.rspec',
    join('spec', 'spec_helper.rb'),
  ];

  for (const configFile of testConfigFiles) {
    if (existsSync(join(projectDir, configFile))) {
      return false;
    }
  }

  // Check for test directories with test files
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  const testFilePatterns = [
    /^test_.*\.(py|js|ts)$/,
    /.*_test\.(py|js|ts)$/,
    /.*\.spec\.(js|ts)$/,
    /.*\.test\.(js|ts)$/,
  ];

  for (const testDir of testDirs) {
    const testDirPath = join(projectDir, testDir);
    if (!existsSync(testDirPath)) continue;

    try {
      const entries = readdirSync(testDirPath);
      for (const entry of entries) {
        for (const pattern of testFilePatterns) {
          if (pattern.test(entry)) {
            return false;
          }
        }
      }
    } catch {
      // Can't read directory — skip
    }
  }

  return true;
}
