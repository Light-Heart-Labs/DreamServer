/**
 * GitHub Issue Triage IPC handlers
 *
 * Handles AI-powered issue triage:
 * 1. Detect duplicates, spam, feature creep
 * 2. Suggest labels and priority
 * 3. Apply labels to issues
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  IPC_CHANNELS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from '../../../shared/constants';
import { getGitHubConfig, githubFetch } from './utils';
import { readSettingsFile } from '../../settings-utils';
import { getAugmentedEnv } from '../../env-utils';
import type { Project, AppSettings } from '../../../shared/types';
import { createContextLogger } from './utils/logger';
import { withProjectOrNull } from './utils/project-middleware';
import { createIPCCommunicators } from './utils/ipc-communicator';
import {
  triageBatchIssues,
  type GitHubIssue as TriageGitHubIssue,
  type TriageResult as EngineTriageResult,
} from '../../ai/runners/github/triage-engine';
import type { ModelShorthand, ThinkingLevel } from '../../ai/config/types';

// Debug logging
const { debug: debugLog } = createContextLogger('GitHub Triage');

/**
 * Triage categories
 */
export type TriageCategory =
  | 'bug'
  | 'feature'
  | 'documentation'
  | 'question'
  | 'duplicate'
  | 'spam'
  | 'feature_creep';

/**
 * Triage result for a single issue
 */
export interface TriageResult {
  issueNumber: number;
  repo: string;
  category: TriageCategory;
  confidence: number;
  labelsToAdd: string[];
  labelsToRemove: string[];
  isDuplicate: boolean;
  duplicateOf?: number;
  isSpam: boolean;
  isFeatureCreep: boolean;
  suggestedBreakdown: string[];
  priority: 'high' | 'medium' | 'low';
  comment?: string;
  triagedAt: string;
}

/**
 * Triage configuration
 */
export interface TriageConfig {
  enabled: boolean;
  duplicateThreshold: number;
  spamThreshold: number;
  featureCreepThreshold: number;
  enableComments: boolean;
}

/**
 * Triage progress status
 */
export interface TriageProgress {
  phase: 'fetching' | 'analyzing' | 'applying' | 'complete';
  issueNumber?: number;
  progress: number;
  message: string;
  totalIssues: number;
  processedIssues: number;
}

/**
 * Get the GitHub directory for a project
 */
function getGitHubDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'github');
}

/**
 * Get triage config for a project
 */
function getTriageConfig(project: Project): TriageConfig {
  const configPath = path.join(getGitHubDir(project), 'config.json');

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      enabled: data.triage_enabled ?? false,
      duplicateThreshold: data.duplicate_threshold ?? 0.8,
      spamThreshold: data.spam_threshold ?? 0.75,
      featureCreepThreshold: data.feature_creep_threshold ?? 0.7,
      enableComments: data.enable_triage_comments ?? false,
    };
  } catch {
    // Return defaults if file doesn't exist or is invalid
  }

  return {
    enabled: false,
    duplicateThreshold: 0.8,
    spamThreshold: 0.75,
    featureCreepThreshold: 0.7,
    enableComments: false,
  };
}

/**
 * Save triage config for a project
 */
function saveTriageConfig(project: Project, config: TriageConfig): void {
  const githubDir = getGitHubDir(project);
  fs.mkdirSync(githubDir, { recursive: true });

  const configPath = path.join(githubDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Use empty config if file doesn't exist or is invalid
  }

  const updatedConfig = {
    ...existingConfig,
    triage_enabled: config.enabled,
    duplicate_threshold: config.duplicateThreshold,
    spam_threshold: config.spamThreshold,
    feature_creep_threshold: config.featureCreepThreshold,
    enable_triage_comments: config.enableComments,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get saved triage results for a project
 */
function getTriageResults(project: Project): TriageResult[] {
  const issuesDir = path.join(getGitHubDir(project), 'issues');
  const results: TriageResult[] = [];

  try {
    const files = fs.readdirSync(issuesDir);

    for (const file of files) {
      if (file.startsWith('triage_') && file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(issuesDir, file), 'utf-8'));
          results.push({
            issueNumber: data.issue_number,
            repo: data.repo,
            category: data.category,
            confidence: data.confidence,
            labelsToAdd: data.labels_to_add ?? [],
            labelsToRemove: data.labels_to_remove ?? [],
            isDuplicate: data.is_duplicate ?? false,
            duplicateOf: data.duplicate_of,
            isSpam: data.is_spam ?? false,
            isFeatureCreep: data.is_feature_creep ?? false,
            suggestedBreakdown: data.suggested_breakdown ?? [],
            priority: data.priority ?? 'medium',
            comment: data.comment,
            triagedAt: data.triaged_at ?? new Date().toISOString(),
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Return empty array if directory doesn't exist
    return [];
  }

  return results.sort(
    (a, b) => new Date(b.triagedAt).getTime() - new Date(a.triagedAt).getTime(),
  );
}

/**
 * Save a single triage result to disk in the format expected by getTriageResults().
 */
function saveTriageResultToDisk(project: Project, result: TriageResult): void {
  const issuesDir = path.join(getGitHubDir(project), 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });

  const data = {
    issue_number: result.issueNumber,
    repo: result.repo,
    category: result.category,
    confidence: result.confidence,
    labels_to_add: result.labelsToAdd,
    labels_to_remove: result.labelsToRemove,
    is_duplicate: result.isDuplicate,
    duplicate_of: result.duplicateOf ?? null,
    is_spam: result.isSpam,
    is_feature_creep: result.isFeatureCreep,
    suggested_breakdown: result.suggestedBreakdown,
    priority: result.priority,
    comment: result.comment ?? null,
    triaged_at: result.triagedAt,
  };

  fs.writeFileSync(
    path.join(issuesDir, `triage_${result.issueNumber}.json`),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

/**
 * Get GitHub Issues model and thinking settings from app settings.
 * Returns the model shorthand (for TypeScript engine) and thinkingLevel.
 */
function getGitHubIssuesSettings(): { modelShorthand: ModelShorthand; thinkingLevel: ThinkingLevel } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;

  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;

  const modelShorthand = (featureModels.githubIssues ??
    DEFAULT_FEATURE_MODELS.githubIssues) as ModelShorthand;
  const thinkingLevel = (featureThinking.githubIssues ??
    DEFAULT_FEATURE_THINKING.githubIssues) as ThinkingLevel;

  debugLog('GitHub Issues settings', { modelShorthand, thinkingLevel });

  return { modelShorthand, thinkingLevel };
}

/**
 * Convert engine TriageResult to handler TriageResult format.
 */
function convertEngineResult(
  engineResult: EngineTriageResult,
  repo: string,
): TriageResult {
  return {
    issueNumber: engineResult.issueNumber,
    repo,
    category: engineResult.category as TriageCategory,
    confidence: engineResult.confidence,
    labelsToAdd: engineResult.labelsToAdd,
    labelsToRemove: engineResult.labelsToRemove,
    isDuplicate: engineResult.isDuplicate,
    duplicateOf: engineResult.duplicateOf ?? undefined,
    isSpam: engineResult.isSpam,
    isFeatureCreep: engineResult.isFeatureCreep,
    suggestedBreakdown: engineResult.suggestedBreakdown,
    priority: engineResult.priority as 'high' | 'medium' | 'low',
    comment: engineResult.comment ?? undefined,
    triagedAt: new Date().toISOString(),
  };
}

/**
 * Run the TypeScript triage engine on a set of issues.
 */
async function runTriage(
  project: Project,
  issueNumbers: number[] | null,
  mainWindow: BrowserWindow,
): Promise<TriageResult[]> {
  const { sendProgress } = createIPCCommunicators<TriageProgress, TriageResult[]>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
      error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
      complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
    },
    project.id,
  );

  const config = getGitHubConfig(project);
  if (!config) {
    throw new Error('No GitHub configuration found for project');
  }

  const { modelShorthand, thinkingLevel } = getGitHubIssuesSettings();

  debugLog('Starting TypeScript triage', { modelShorthand, thinkingLevel });

  // Fetch issues from GitHub API
  sendProgress({
    phase: 'fetching',
    progress: 10,
    message: 'Fetching issues from GitHub...',
    totalIssues: 0,
    processedIssues: 0,
  });

  let issuesToTriage: TriageGitHubIssue[];

  if (issueNumbers && issueNumbers.length > 0) {
    // Fetch specific issues
    const fetchedIssues = await Promise.all(
      issueNumbers.map(async (n): Promise<TriageGitHubIssue | null> => {
        try {
          const issue = (await githubFetch(
            config.token,
            `/repos/${config.repo}/issues/${n}`,
          )) as {
            number: number;
            title: string;
            body?: string;
            user: { login: string };
            created_at: string;
            labels?: Array<{ name: string }>;
          };
          return {
            number: issue.number,
            title: issue.title,
            body: issue.body,
            author: { login: issue.user.login },
            createdAt: issue.created_at,
            labels: issue.labels,
          };
        } catch {
          return null;
        }
      }),
    );
    issuesToTriage = fetchedIssues.filter((i): i is TriageGitHubIssue => i !== null);
  } else {
    // Fetch open issues (up to 100)
    const issues = (await githubFetch(
      config.token,
      `/repos/${config.repo}/issues?state=open&per_page=100`,
    )) as Array<{
      number: number;
      title: string;
      body?: string;
      user: { login: string };
      created_at: string;
      labels?: Array<{ name: string }>;
      pull_request?: unknown;
    }>;

    // Filter out pull requests (GitHub API includes PRs in /issues)
    issuesToTriage = issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        author: { login: i.user.login },
        createdAt: i.created_at,
        labels: i.labels,
      }));
  }

  const totalIssues = issuesToTriage.length;
  debugLog('Issues to triage', { count: totalIssues });

  sendProgress({
    phase: 'analyzing',
    progress: 20,
    message: `Triaging ${totalIssues} issues...`,
    totalIssues,
    processedIssues: 0,
  });

  // Run triage engine
  const engineResults = await triageBatchIssues(
    issuesToTriage,
    { repo: config.repo, model: modelShorthand, thinkingLevel },
    (update) => {
      sendProgress({
        phase: 'analyzing',
        progress: 20 + Math.round(update.progress * 0.7),
        message: update.message,
        totalIssues,
        processedIssues: Math.round((update.progress / 100) * totalIssues),
      });
    },
  );

  // Convert and save results to disk
  const results: TriageResult[] = [];
  for (const engineResult of engineResults) {
    const result = convertEngineResult(engineResult, config.repo);
    results.push(result);
    saveTriageResultToDisk(project, result);
  }

  debugLog('Triage completed, results saved', { count: results.length });
  return results;
}

/**
 * Register triage-related handlers
 */
export function registerTriageHandlers(getMainWindow: () => BrowserWindow | null): void {
  debugLog('Registering Triage handlers');

  // Get triage config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_GET_CONFIG,
    async (_, projectId: string): Promise<TriageConfig | null> => {
      debugLog('getTriageConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        const config = getTriageConfig(project);
        debugLog('Triage config loaded', { enabled: config.enabled });
        return config;
      });
    },
  );

  // Save triage config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_SAVE_CONFIG,
    async (_, projectId: string, config: TriageConfig): Promise<boolean> => {
      debugLog('saveTriageConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveTriageConfig(project, config);
        debugLog('Triage config saved');
        return true;
      });
      return result ?? false;
    },
  );

  // Get triage results
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_GET_RESULTS,
    async (_, projectId: string): Promise<TriageResult[]> => {
      debugLog('getTriageResults handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const results = getTriageResults(project);
        debugLog('Triage results loaded', { count: results.length });
        return results;
      });
      return result ?? [];
    },
  );

  // Run triage
  ipcMain.on(
    IPC_CHANNELS.GITHUB_TRIAGE_RUN,
    async (_, projectId: string, issueNumbers?: number[]) => {
      debugLog('runTriage handler called', { projectId, issueNumbers });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendError: _sendError, sendComplete } =
            createIPCCommunicators<TriageProgress, TriageResult[]>(
              mainWindow,
              {
                progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
                error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
                complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
              },
              projectId,
            );

          debugLog('Starting triage');
          sendProgress({
            phase: 'fetching',
            progress: 5,
            message: 'Starting triage...',
            totalIssues: 0,
            processedIssues: 0,
          });

          const results = await runTriage(project, issueNumbers ?? null, mainWindow);

          debugLog('Triage completed', { resultsCount: results.length });
          sendProgress({
            phase: 'complete',
            progress: 100,
            message: `Triaged ${results.length} issues`,
            totalIssues: results.length,
            processedIssues: results.length,
          });

          sendComplete(results);
        });
      } catch (error) {
        debugLog('Triage failed', { error: error instanceof Error ? error.message : error });
        const { sendError } = createIPCCommunicators<TriageProgress, TriageResult[]>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_TRIAGE_PROGRESS,
            error: IPC_CHANNELS.GITHUB_TRIAGE_ERROR,
            complete: IPC_CHANNELS.GITHUB_TRIAGE_COMPLETE,
          },
          projectId,
        );
        sendError(error instanceof Error ? error.message : 'Failed to run triage');
      }
    },
  );

  // Apply labels to issues
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_TRIAGE_APPLY_LABELS,
    async (_, projectId: string, issueNumbers: number[]): Promise<boolean> => {
      debugLog('applyTriageLabels handler called', { projectId, issueNumbers });
      const applyResult = await withProjectOrNull(projectId, async (project) => {
        const config = getGitHubConfig(project);
        if (!config) {
          debugLog('No GitHub config found');
          return false;
        }

        try {
          for (const issueNumber of issueNumbers) {
            const triageResults = getTriageResults(project);
            const result = triageResults.find((r) => r.issueNumber === issueNumber);

            if (result && result.labelsToAdd.length > 0) {
              debugLog('Applying labels to issue', { issueNumber, labels: result.labelsToAdd });

              // Validate issueNumber to prevent command injection
              if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
                throw new Error('Invalid issue number');
              }

              // Validate labels - reject any that contain shell metacharacters
              const safeLabels = result.labelsToAdd.filter((label: string) =>
                /^[\w\s\-.:]+$/.test(label),
              );
              if (safeLabels.length !== result.labelsToAdd.length) {
                debugLog('Some labels were filtered due to invalid characters', {
                  original: result.labelsToAdd,
                  filtered: safeLabels,
                });
              }

              if (safeLabels.length > 0) {
                const { execFileSync } = await import('child_process');
                // Use execFileSync with arguments array to prevent command injection
                execFileSync(
                  'gh',
                  ['issue', 'edit', String(issueNumber), '--add-label', safeLabels.join(',')],
                  {
                    cwd: project.path,
                    env: getAugmentedEnv(),
                  },
                );
              }
            }
          }
          debugLog('Labels applied successfully');
          return true;
        } catch (error) {
          debugLog('Failed to apply labels', {
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      });
      return applyResult ?? false;
    },
  );

  debugLog('Triage handlers registered');
}
