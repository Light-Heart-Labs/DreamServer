/**
 * GitHub Auto-Fix IPC handlers
 *
 * Handles automatic fixing of GitHub issues by:
 * 1. Detecting issues with configured labels (e.g., "auto-fix")
 * 2. Creating specs from issues
 * 3. Running the build pipeline
 * 4. Creating PRs when complete
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../../shared/constants';
import { getGitHubConfig, githubFetch } from './utils';
import { createSpecForIssue, buildIssueContext, buildInvestigationTask, updateImplementationPlanStatus } from './spec-utils';
import type { Project } from '../../../shared/types';
import { createContextLogger } from './utils/logger';
import { withProjectOrNull } from './utils/project-middleware';
import { createIPCCommunicators } from './utils/ipc-communicator';
import { AgentManager } from '../../agent/agent-manager';
import { BatchProcessor } from '../../ai/runners/github/batch-processor';
import type { GitHubIssue } from '../../ai/runners/github/duplicate-detector';
import type { ModelShorthand, ThinkingLevel } from '../../ai/config/types';

// Debug logging
const { debug: debugLog } = createContextLogger('GitHub AutoFix');

/**
 * Auto-fix configuration stored in .auto-claude/github/config.json
 */
export interface AutoFixConfig {
  enabled: boolean;
  labels: string[];
  requireHumanApproval: boolean;
  botToken?: string;
  model: string;
  thinkingLevel: string;
}

/**
 * Auto-fix queue item
 */
export interface AutoFixQueueItem {
  issueNumber: number;
  repo: string;
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  prNumber?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Progress status for auto-fix operations
 */
export interface AutoFixProgress {
  phase: 'checking' | 'fetching' | 'analyzing' | 'batching' | 'creating_spec' | 'building' | 'qa_review' | 'creating_pr' | 'complete';
  issueNumber: number;
  progress: number;
  message: string;
}

/**
 * Issue batch for grouped fixing
 */
export interface IssueBatch {
  batchId: string;
  repo: string;
  primaryIssue: number;
  issues: Array<{
    issueNumber: number;
    title: string;
    similarityToPrimary: number;
  }>;
  commonThemes: string[];
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  prNumber?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Batch progress status
 */
export interface BatchProgress {
  phase: 'analyzing' | 'batching' | 'creating_specs' | 'complete';
  progress: number;
  message: string;
  totalIssues: number;
  batchCount: number;
}

/**
 * Get the GitHub directory for a project
 */
function getGitHubDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'github');
}

/**
 * Get the auto-fix config for a project
 */
function getAutoFixConfig(project: Project): AutoFixConfig {
  const configPath = path.join(getGitHubDir(project), 'config.json');

  // Use try/catch instead of existsSync to avoid TOCTOU race condition
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      enabled: data.auto_fix_enabled ?? false,
      labels: data.auto_fix_labels ?? ['auto-fix'],
      requireHumanApproval: data.require_human_approval ?? true,
      botToken: data.bot_token,
      model: data.model ?? 'claude-sonnet-4-6',
      thinkingLevel: data.thinking_level ?? 'medium',
    };
  } catch {
    // File doesn't exist or is invalid - return defaults
  }

  return {
    enabled: false,
    labels: ['auto-fix'],
    requireHumanApproval: true,
    model: 'claude-sonnet-4-6',
    thinkingLevel: 'medium',
  };
}

/**
 * Save the auto-fix config for a project
 */
function saveAutoFixConfig(project: Project, config: AutoFixConfig): void {
  const githubDir = getGitHubDir(project);
  fs.mkdirSync(githubDir, { recursive: true });

  const configPath = path.join(githubDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  // Use try/catch instead of existsSync to avoid TOCTOU race condition
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or is invalid - use empty config
  }

  const updatedConfig = {
    ...existingConfig,
    auto_fix_enabled: config.enabled,
    auto_fix_labels: config.labels,
    require_human_approval: config.requireHumanApproval,
    bot_token: config.botToken,
    model: config.model,
    thinking_level: config.thinkingLevel,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get the auto-fix queue for a project
 */
function getAutoFixQueue(project: Project): AutoFixQueueItem[] {
  const issuesDir = path.join(getGitHubDir(project), 'issues');

  // Use try/catch instead of existsSync to avoid TOCTOU race condition
  let files: string[];
  try {
    files = fs.readdirSync(issuesDir);
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }

  const queue: AutoFixQueueItem[] = [];

  for (const file of files) {
    if (file.startsWith('autofix_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(issuesDir, file), 'utf-8'));
        queue.push({
          issueNumber: data.issue_number,
          repo: data.repo,
          status: data.status,
          specId: data.spec_id,
          prNumber: data.pr_number,
          error: data.error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return queue.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// IPC communication helpers removed - using createIPCCommunicators instead

/**
 * Check for issues with auto-fix labels
 */
async function checkAutoFixLabels(project: Project): Promise<number[]> {
  const config = getAutoFixConfig(project);
  if (!config.enabled || config.labels.length === 0) {
    return [];
  }

  const ghConfig = getGitHubConfig(project);
  if (!ghConfig) {
    return [];
  }

  // Fetch open issues
  const issues = await githubFetch(
    ghConfig.token,
    `/repos/${ghConfig.repo}/issues?state=open&per_page=100`
  ) as Array<{
    number: number;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter for issues (not PRs) with matching labels
  const queue = getAutoFixQueue(project);
  const pendingIssues = new Set(queue.map(q => q.issueNumber));

  const matchingIssues: number[] = [];

  for (const issue of issues) {
    // Skip pull requests
    if (issue.pull_request) continue;

    // Skip already in queue
    if (pendingIssues.has(issue.number)) continue;

    // Check for matching labels
    const issueLabels = issue.labels.map(l => l.name.toLowerCase());
    const hasMatchingLabel = config.labels.some(
      label => issueLabels.includes(label.toLowerCase())
    );

    if (hasMatchingLabel) {
      matchingIssues.push(issue.number);
    }
  }

  return matchingIssues;
}

/**
 * Check for NEW issues not yet in the auto-fix queue (no labels required).
 * Uses GitHub API directly instead of Python subprocess.
 */
async function checkNewIssues(project: Project): Promise<Array<{ number: number }>> {
  const config = getAutoFixConfig(project);
  if (!config.enabled) {
    return [];
  }

  const ghConfig = getGitHubConfig(project);
  if (!ghConfig) {
    throw new Error('No GitHub configuration found');
  }

  // Fetch open issues from GitHub API (no label filter - any new issue)
  const issues = await githubFetch(
    ghConfig.token,
    `/repos/${ghConfig.repo}/issues?state=open&per_page=100`
  ) as Array<{
    number: number;
    pull_request?: unknown;
  }>;

  // Get current queue to exclude already-tracked issues
  const queue = getAutoFixQueue(project);
  const queuedIssueNumbers = new Set(queue.map(q => q.issueNumber));

  return issues
    .filter(issue => !issue.pull_request && !queuedIssueNumbers.has(issue.number))
    .map(issue => ({ number: issue.number }));
}

/**
 * Start auto-fix for an issue
 */
async function startAutoFix(
  project: Project,
  issueNumber: number,
  mainWindow: BrowserWindow,
  agentManager: AgentManager
): Promise<void> {
  const { sendProgress, sendComplete } = createIPCCommunicators<AutoFixProgress, AutoFixQueueItem>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_AUTOFIX_PROGRESS,
      error: IPC_CHANNELS.GITHUB_AUTOFIX_ERROR,
      complete: IPC_CHANNELS.GITHUB_AUTOFIX_COMPLETE,
    },
    project.id
  );

  const ghConfig = getGitHubConfig(project);
  if (!ghConfig) {
    throw new Error('No GitHub configuration found');
  }

  sendProgress({ phase: 'fetching', issueNumber, progress: 10, message: `Fetching issue #${issueNumber}...` });

  // Fetch the issue
  const issue = await githubFetch(ghConfig.token, `/repos/${ghConfig.repo}/issues/${issueNumber}`) as {
    number: number;
    title: string;
    body?: string;
    labels: Array<{ name: string }>;
    html_url: string;
  };

  // Fetch comments
  const comments = await githubFetch(ghConfig.token, `/repos/${ghConfig.repo}/issues/${issueNumber}/comments`) as Array<{
    id: number;
    body: string;
    user: { login: string };
  }>;

  sendProgress({ phase: 'analyzing', issueNumber, progress: 30, message: 'Analyzing issue...' });

  // Build context
  const labels = issue.labels.map(l => l.name);
  const issueContext = buildIssueContext(
    issue.number,
    issue.title,
    issue.body,
    labels,
    issue.html_url,
    comments.map(c => ({
      id: c.id,
      body: c.body,
      user: { login: c.user.login },
      created_at: '',
      html_url: '',
    }))
  );

  sendProgress({ phase: 'creating_spec', issueNumber, progress: 50, message: 'Creating spec from issue...' });

  // Create spec
  const taskDescription = buildInvestigationTask(issue.number, issue.title, issueContext);
  const specData = await createSpecForIssue(
    project,
    issue.number,
    issue.title,
    taskDescription,
    issue.html_url,
    labels,
    project.settings?.mainBranch  // Pass project's configured main branch
  );

  // Save auto-fix state
  const issuesDir = path.join(getGitHubDir(project), 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });

  const state: AutoFixQueueItem = {
    issueNumber,
    repo: ghConfig.repo,
    status: 'creating_spec',
    specId: specData.specId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Validate and sanitize network data before writing to file
  const sanitizedIssueUrl = typeof issue.html_url === 'string' ? issue.html_url : '';
  const sanitizedRepo = typeof ghConfig.repo === 'string' ? ghConfig.repo : '';
  const sanitizedSpecId = typeof specData.specId === 'string' ? specData.specId : '';

  fs.writeFileSync(
    path.join(issuesDir, `autofix_${issueNumber}.json`),
    JSON.stringify({
      issue_number: issueNumber,
      repo: sanitizedRepo,
      status: state.status,
      spec_id: sanitizedSpecId,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      issue_url: sanitizedIssueUrl,
    }, null, 2),
    'utf-8'
  );

  sendProgress({ phase: 'creating_spec', issueNumber, progress: 70, message: 'Starting spec creation...' });

  // Automatically start spec creation using the TypeScript agent system
  try {
    agentManager.startSpecCreation(
      specData.specId,
      project.path,
      specData.taskDescription,
      specData.specDir,
      specData.metadata
    );

    // Immediately update the plan status to 'planning' so the frontend shows the task as "In Progress"
    updateImplementationPlanStatus(specData.specDir, 'planning');

    sendProgress({ phase: 'complete', issueNumber, progress: 100, message: 'Auto-fix spec creation started!' });
    sendComplete(state);
  } catch (error) {
    debugLog('Failed to start spec creation', { error });
    sendProgress({ phase: 'complete', issueNumber, progress: 100, message: 'Spec directory created. Click Start to begin.' });
    sendComplete(state);
  }
}

/**
 * Register auto-fix related handlers
 */
export function registerAutoFixHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering AutoFix handlers');

  // Get auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_GET_CONFIG,
    async (_, projectId: string): Promise<AutoFixConfig | null> => {
      debugLog('getAutoFixConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        const config = getAutoFixConfig(project);
        debugLog('AutoFix config loaded', { enabled: config.enabled, labels: config.labels });
        return config;
      });
    }
  );

  // Save auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_SAVE_CONFIG,
    async (_, projectId: string, config: AutoFixConfig): Promise<boolean> => {
      debugLog('saveAutoFixConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveAutoFixConfig(project, config);
        debugLog('AutoFix config saved');
        return true;
      });
      return result ?? false;
    }
  );

  // Get auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_GET_QUEUE,
    async (_, projectId: string): Promise<AutoFixQueueItem[]> => {
      debugLog('getAutoFixQueue handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const queue = getAutoFixQueue(project);
        debugLog('AutoFix queue loaded', { count: queue.length });
        return queue;
      });
      return result ?? [];
    }
  );

  // Check for issues with auto-fix labels
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_CHECK_LABELS,
    async (_, projectId: string): Promise<number[]> => {
      debugLog('checkAutoFixLabels handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const issues = await checkAutoFixLabels(project);
        debugLog('Issues with auto-fix labels', { count: issues.length, issues });
        return issues;
      });
      return result ?? [];
    }
  );

  // Check for NEW issues not yet in auto-fix queue (no labels required)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_CHECK_NEW,
    async (_, projectId: string): Promise<Array<{ number: number }>> => {
      debugLog('checkNewIssues handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const issues = await checkNewIssues(project);
        debugLog('New issues found', { count: issues.length, issues });
        return issues;
      });
      return result ?? [];
    }
  );

  // Start auto-fix for an issue
  ipcMain.on(
    IPC_CHANNELS.GITHUB_AUTOFIX_START,
    async (_, projectId: string, issueNumber: number) => {
      debugLog('startAutoFix handler called', { projectId, issueNumber });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          debugLog('Starting auto-fix for issue', { issueNumber });
          await startAutoFix(project, issueNumber, mainWindow, agentManager);
          debugLog('Auto-fix completed for issue', { issueNumber });
        });
      } catch (error) {
        debugLog('Auto-fix failed', { issueNumber, error: error instanceof Error ? error.message : error });
        const { sendError } = createIPCCommunicators<AutoFixProgress, AutoFixQueueItem>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_AUTOFIX_PROGRESS,
            error: IPC_CHANNELS.GITHUB_AUTOFIX_ERROR,
            complete: IPC_CHANNELS.GITHUB_AUTOFIX_COMPLETE,
          },
          projectId
        );
        sendError(error instanceof Error ? error.message : 'Failed to start auto-fix');
      }
    }
  );

  // Batch auto-fix for multiple issues using TypeScript BatchProcessor
  ipcMain.on(
    IPC_CHANNELS.GITHUB_AUTOFIX_BATCH,
    async (_, projectId: string, issueNumbers?: number[]) => {
      debugLog('batchAutoFix handler called', { projectId, issueNumbers });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendComplete } = createIPCCommunicators<BatchProgress, IssueBatch[]>(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_PROGRESS,
              error: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_ERROR,
              complete: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_COMPLETE,
            },
            projectId
          );

          debugLog('Starting batch auto-fix');
          sendProgress({
            phase: 'analyzing',
            progress: 10,
            message: 'Analyzing issues for similarity...',
            totalIssues: issueNumbers?.length ?? 0,
            batchCount: 0,
          });

          const ghConfig = getGitHubConfig(project);
          if (!ghConfig) {
            throw new Error('No GitHub configuration found');
          }

          // Fetch issues to batch from GitHub API
          const rawIssues = await githubFetch(
            ghConfig.token,
            `/repos/${ghConfig.repo}/issues?state=open&per_page=100`
          ) as Array<Record<string, unknown>>;

          const issuesToBatch: GitHubIssue[] = rawIssues
            .filter(i => !i.pull_request)
            .filter(i => !issueNumbers || issueNumbers.includes(i.number as number))
            .map(i => ({
              number: i.number as number,
              title: (i.title as string) ?? '',
              body: (i.body as string) ?? undefined,
              author: { login: ((i.user as Record<string, unknown>)?.login as string) ?? 'unknown' },
              createdAt: (i.created_at as string) ?? '',
              labels: ((i.labels as Array<Record<string, unknown>>) ?? []).map(l => ({ name: l.name as string })),
            }));

          debugLog('Fetched issues for batching', { count: issuesToBatch.length });
          sendProgress({
            phase: 'batching',
            progress: 30,
            message: `Grouping ${issuesToBatch.length} issues into batches...`,
            totalIssues: issuesToBatch.length,
            batchCount: 0,
          });

          // Use TypeScript BatchProcessor instead of Python subprocess
          const batchProcessor = new BatchProcessor({
            model: 'sonnet' as ModelShorthand,
            thinkingLevel: 'low' as ThinkingLevel,
          });
          const suggestions = await batchProcessor.groupIssues(issuesToBatch);
          const engineBatches = batchProcessor.buildBatches(issuesToBatch, suggestions);

          // Persist batches to disk in the format expected by getBatches()
          const batchesDir = path.join(getGitHubDir(project), 'batches');
          fs.mkdirSync(batchesDir, { recursive: true });

          const savedBatches: IssueBatch[] = [];
          for (const batch of engineBatches) {
            const primaryIssue = batch.issues[0]?.number ?? 0;
            const batchData = {
              batch_id: batch.batchId,
              repo: ghConfig.repo,
              primary_issue: primaryIssue,
              issues: batch.issues.map(i => ({
                issue_number: i.number,
                title: i.title ?? '',
                similarity_to_primary: 1.0,
              })),
              common_themes: [batch.theme],
              status: 'pending',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            fs.writeFileSync(
              path.join(batchesDir, `batch_${batch.batchId}.json`),
              JSON.stringify(batchData, null, 2),
              'utf-8'
            );
            savedBatches.push({
              batchId: batch.batchId,
              repo: ghConfig.repo,
              primaryIssue,
              issues: batch.issues.map(i => ({
                issueNumber: i.number,
                title: i.title ?? '',
                similarityToPrimary: 1.0,
              })),
              commonThemes: [batch.theme],
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          debugLog('Batch auto-fix completed', { batchCount: savedBatches.length });
          sendProgress({
            phase: 'complete',
            progress: 100,
            message: `Created ${savedBatches.length} batches`,
            totalIssues: issuesToBatch.length,
            batchCount: savedBatches.length,
          });

          sendComplete(savedBatches);
        });
      } catch (error) {
        debugLog('Batch auto-fix failed', { error: error instanceof Error ? error.message : error });
        const { sendError } = createIPCCommunicators<BatchProgress, IssueBatch[]>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_PROGRESS,
            error: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_ERROR,
            complete: IPC_CHANNELS.GITHUB_AUTOFIX_BATCH_COMPLETE,
          },
          projectId
        );
        sendError(error instanceof Error ? error.message : 'Failed to batch issues');
      }
    }
  );

  // Get batches for a project
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_GET_BATCHES,
    async (_, projectId: string): Promise<IssueBatch[]> => {
      debugLog('getBatches handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        const batches = getBatches(project);
        debugLog('Batches loaded', { count: batches.length });
        return batches;
      });
      return result ?? [];
    }
  );

  // Analyze issues and preview proposed batches (proactive workflow)
  ipcMain.on(
    IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW,
    async (_, projectId: string, issueNumbers?: number[], maxIssues?: number) => {
      debugLog('analyzePreview handler called', { projectId, issueNumbers, maxIssues });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          interface AnalyzePreviewProgress {
            phase: 'analyzing';
            progress: number;
            message: string;
          }

          const { sendProgress, sendComplete } = createIPCCommunicators<
            AnalyzePreviewProgress,
            AnalyzePreviewResult
          >(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
              error: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_ERROR,
              complete: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE,
            },
            projectId
          );

          debugLog('Starting analyze-preview');
          sendProgress({ phase: 'analyzing', progress: 10, message: 'Fetching issues for analysis...' });

          const ghConfig = getGitHubConfig(project);
          if (!ghConfig) {
            throw new Error('No GitHub configuration found');
          }

          // Fetch issues from GitHub API
          const rawIssues = await githubFetch(
            ghConfig.token,
            `/repos/${ghConfig.repo}/issues?state=open&per_page=100`
          ) as Array<Record<string, unknown>>;

          let issuesForAnalysis: GitHubIssue[] = rawIssues
            .filter(i => !i.pull_request)
            .filter(i => !issueNumbers || issueNumbers.includes(i.number as number))
            .map(i => ({
              number: i.number as number,
              title: (i.title as string) ?? '',
              body: (i.body as string) ?? undefined,
              author: { login: ((i.user as Record<string, unknown>)?.login as string) ?? 'unknown' },
              createdAt: (i.created_at as string) ?? '',
              labels: ((i.labels as Array<Record<string, unknown>>) ?? []).map(l => ({ name: l.name as string })),
            }));

          if (maxIssues && maxIssues > 0) {
            issuesForAnalysis = issuesForAnalysis.slice(0, maxIssues);
          }

          // Already batched issues
          const existingBatches = getBatches(project);
          const batchedIssueNumbers = new Set(
            existingBatches.flatMap(b => b.issues.map(i => i.issueNumber))
          );

          const alreadyBatched = issuesForAnalysis.filter(i => batchedIssueNumbers.has(i.number)).length;
          const newIssues = issuesForAnalysis.filter(i => !batchedIssueNumbers.has(i.number));

          sendProgress({ phase: 'analyzing', progress: 40, message: `Analyzing ${newIssues.length} issues...` });

          // Use TypeScript BatchProcessor for AI-powered grouping analysis
          const batchProcessor = new BatchProcessor({
            model: 'sonnet' as ModelShorthand,
            thinkingLevel: 'low' as ThinkingLevel,
          });
          const suggestions = newIssues.length > 0 ? await batchProcessor.groupIssues(newIssues) : [];

          // Transform to AnalyzePreviewResult format
          const singleIssueSuggestions = suggestions.filter(s => s.issueNumbers.length === 1);
          const batchSuggestions = suggestions.filter(s => s.issueNumbers.length > 1);
          const issueMap = new Map(newIssues.map(i => [i.number, i]));

          const analyzeResult: AnalyzePreviewResult = {
            success: true,
            totalIssues: issuesForAnalysis.length,
            analyzedIssues: newIssues.length,
            alreadyBatched,
            proposedBatches: batchSuggestions.map(s => ({
              primaryIssue: s.issueNumbers[0] ?? 0,
              issues: s.issueNumbers.map(n => ({
                issueNumber: n,
                title: issueMap.get(n)?.title ?? '',
                labels: (issueMap.get(n)?.labels ?? []).map(l => l.name),
                similarityToPrimary: s.confidence,
              })),
              issueCount: s.issueNumbers.length,
              commonThemes: [s.theme],
              validated: false,
              confidence: s.confidence,
              reasoning: s.reasoning,
              theme: s.theme,
            })),
            singleIssues: singleIssueSuggestions.map(s => ({
              issueNumber: s.issueNumbers[0] ?? 0,
              title: issueMap.get(s.issueNumbers[0] ?? 0)?.title ?? '',
              labels: (issueMap.get(s.issueNumbers[0] ?? 0)?.labels ?? []).map(l => l.name),
            })),
            message: `Analyzed ${newIssues.length} issues, proposed ${batchSuggestions.length} batches`,
          };

          debugLog('Analyze preview completed', { batchCount: analyzeResult.proposedBatches.length });
          sendComplete(analyzeResult);
        });
      } catch (error) {
        debugLog('Analyze preview failed', { error: error instanceof Error ? error.message : error });
        const { sendError } = createIPCCommunicators<{ phase: 'analyzing'; progress: number; message: string }, AnalyzePreviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
            error: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_ERROR,
            complete: IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE,
          },
          projectId
        );

        let userMessage = 'Failed to analyze issues';
        if (error instanceof Error) {
          userMessage = error.message;
        }

        sendError(userMessage);
      }
    }
  );

  // Approve and execute selected batches - save directly to disk (no Python subprocess)
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_APPROVE_BATCHES,
    async (_, projectId: string, approvedBatches: Array<Record<string, unknown>>): Promise<{ success: boolean; batches?: IssueBatch[]; error?: string }> => {
      debugLog('approveBatches handler called', { projectId, batchCount: approvedBatches.length });
      const result = await withProjectOrNull(projectId, async (project) => {
        try {
          const ghConfig = getGitHubConfig(project);
          if (!ghConfig) {
            throw new Error('No GitHub configuration found');
          }

          // Save approved batches directly to disk
          const batchesDir = path.join(getGitHubDir(project), 'batches');
          fs.mkdirSync(batchesDir, { recursive: true });

          for (const b of approvedBatches) {
            const primaryIssue = (b.primaryIssue as number) ?? 0;
            const batchId = (b.batchId as string) ?? `batch-${String(primaryIssue).padStart(3, '0')}`;
            const batchData = {
              batch_id: batchId,
              repo: ghConfig.repo,
              primary_issue: primaryIssue,
              issues: ((b.issues as Array<Record<string, unknown>>) ?? []).map((i: Record<string, unknown>) => ({
                issue_number: i.issueNumber as number,
                title: (i.title as string) ?? '',
                labels: (i.labels as string[]) ?? [],
                similarity_to_primary: (i.similarityToPrimary as number) ?? 1.0,
              })),
              common_themes: (b.commonThemes as string[]) ?? [],
              validated: (b.validated as boolean) ?? true,
              confidence: (b.confidence as number) ?? 1.0,
              reasoning: (b.reasoning as string) ?? 'User approved',
              theme: (b.theme as string) ?? '',
              status: 'pending',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            fs.writeFileSync(
              path.join(batchesDir, `batch_${batchId}.json`),
              JSON.stringify(batchData, null, 2),
              'utf-8'
            );
          }

          const batches = getBatches(project);
          debugLog('Batches approved and created', { count: batches.length });

          return { success: true, batches };
        } catch (error) {
          debugLog('Approve batches failed', { error: error instanceof Error ? error.message : error });
          return { success: false, error: error instanceof Error ? error.message : 'Failed to approve batches' };
        }
      });
      return result ?? { success: false, error: 'Project not found' };
    }
  );

  debugLog('AutoFix handlers registered');
}

/**
 * Preview result for analyze-preview command
 */
export interface AnalyzePreviewResult {
  success: boolean;
  totalIssues: number;
  analyzedIssues: number;
  alreadyBatched: number;
  proposedBatches: Array<{
    primaryIssue: number;
    issues: Array<{
      issueNumber: number;
      title: string;
      labels: string[];
      similarityToPrimary: number;
    }>;
    issueCount: number;
    commonThemes: string[];
    validated: boolean;
    confidence: number;
    reasoning: string;
    theme: string;
  }>;
  singleIssues: Array<{
    issueNumber: number;
    title: string;
    labels: string[];
  }>;
  message: string;
  error?: string;
}

/**
 * Get batches from disk
 */
function getBatches(project: Project): IssueBatch[] {
  const batchesDir = path.join(getGitHubDir(project), 'batches');

  // Use try/catch instead of existsSync to avoid TOCTOU race condition
  let files: string[];
  try {
    files = fs.readdirSync(batchesDir);
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }

  const batches: IssueBatch[] = [];

  for (const file of files) {
    if (file.startsWith('batch_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf-8'));
        batches.push({
          batchId: data.batch_id,
          repo: data.repo,
          primaryIssue: data.primary_issue,
          issues: data.issues.map((i: Record<string, unknown>) => ({
            issueNumber: i.issue_number,
            title: i.title,
            similarityToPrimary: i.similarity_to_primary,
          })),
          commonThemes: data.common_themes ?? [],
          status: data.status,
          specId: data.spec_id,
          prNumber: data.pr_number,
          error: data.error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return batches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
