/**
 * Timeline Tracker
 * ================
 *
 * Per-file modification timeline using git history.
 * See apps/desktop/src/main/ai/merge/timeline-tracker.ts for the TypeScript implementation.
 *
 * Tracks the "drift" between tasks and main branch,
 * providing full context for merge decisions.
 */

import fs from 'fs';
import path from 'path';

import { spawnSync } from 'child_process';

// =============================================================================
// Timeline Models
// =============================================================================

export interface BranchPoint {
  commitHash: string;
  content: string;
  timestamp: Date;
}

export interface TaskIntent {
  title: string;
  description: string;
  fromPlan: boolean;
}

export interface WorktreeState {
  content: string;
  lastModified: Date;
}

export interface MainBranchEvent {
  commitHash: string;
  timestamp: Date;
  content: string;
  source: 'human' | 'merged_task';
  commitMessage?: string;
  author?: string;
  diffSummary?: string;
  mergedFromTask?: string;
}

export interface TaskFileView {
  taskId: string;
  branchPoint: BranchPoint;
  taskIntent: TaskIntent;
  worktreeState?: WorktreeState;
  commitsBehinMain: number;
  status: 'active' | 'merged' | 'abandoned';
  mergedAt?: Date;
}

export interface FileTimeline {
  filePath: string;
  taskViews: Map<string, TaskFileView>;
  mainBranchEvents: MainBranchEvent[];
}

export interface MergeTimelineContext {
  filePath: string;
  taskId: string;
  taskIntent: TaskIntent;
  taskBranchPoint: BranchPoint;
  mainEvolution: MainBranchEvent[];
  taskWorktreeContent: string;
  currentMainContent: string;
  currentMainCommit: string;
  otherPendingTasks: Array<{
    taskId: string;
    intent: string;
    branchPoint: string;
    commitsBehind: number;
  }>;
  totalCommitsBehind: number;
  totalPendingTasks: number;
}

function createFileTimeline(filePath: string): FileTimeline {
  return { filePath, taskViews: new Map(), mainBranchEvents: [] };
}

function addTaskView(timeline: FileTimeline, view: TaskFileView): void {
  timeline.taskViews.set(view.taskId, view);
}

function getTaskView(timeline: FileTimeline, taskId: string): TaskFileView | undefined {
  return timeline.taskViews.get(taskId);
}

function getActiveTasks(timeline: FileTimeline): TaskFileView[] {
  return [...timeline.taskViews.values()].filter((v) => v.status === 'active');
}

function addMainEvent(timeline: FileTimeline, event: MainBranchEvent): void {
  timeline.mainBranchEvents.push(event);
}

function getEventsSinceCommit(timeline: FileTimeline, commitHash: string): MainBranchEvent[] {
  // Return events after the given commit (simplified: return all for now since
  // we don't have ordering by git commit)
  return timeline.mainBranchEvents.filter((e) => e.commitHash !== commitHash);
}

function getCurrentMainState(timeline: FileTimeline): MainBranchEvent | undefined {
  return timeline.mainBranchEvents[timeline.mainBranchEvents.length - 1];
}

// =============================================================================
// Serialization
// =============================================================================

function fileTimelineToDict(timeline: FileTimeline): Record<string, unknown> {
  return {
    file_path: timeline.filePath,
    task_views: Object.fromEntries(
      [...timeline.taskViews.entries()].map(([id, view]) => [id, taskFileViewToDict(view)])
    ),
    main_branch_events: timeline.mainBranchEvents.map(mainBranchEventToDict),
  };
}

function taskFileViewToDict(view: TaskFileView): Record<string, unknown> {
  return {
    task_id: view.taskId,
    branch_point: {
      commit_hash: view.branchPoint.commitHash,
      content: view.branchPoint.content,
      timestamp: view.branchPoint.timestamp.toISOString(),
    },
    task_intent: {
      title: view.taskIntent.title,
      description: view.taskIntent.description,
      from_plan: view.taskIntent.fromPlan,
    },
    worktree_state: view.worktreeState ? {
      content: view.worktreeState.content,
      last_modified: view.worktreeState.lastModified.toISOString(),
    } : null,
    commits_behind_main: view.commitsBehinMain,
    status: view.status,
    merged_at: view.mergedAt?.toISOString() ?? null,
  };
}

function mainBranchEventToDict(event: MainBranchEvent): Record<string, unknown> {
  return {
    commit_hash: event.commitHash,
    timestamp: event.timestamp.toISOString(),
    content: event.content,
    source: event.source,
    commit_message: event.commitMessage ?? null,
    author: event.author ?? null,
    diff_summary: event.diffSummary ?? null,
    merged_from_task: event.mergedFromTask ?? null,
  };
}

function fileTimelineFromDict(data: Record<string, unknown>): FileTimeline {
  const taskViews = new Map<string, TaskFileView>();
  const rawViews = (data['task_views'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, viewData] of Object.entries(rawViews)) {
    taskViews.set(id, taskFileViewFromDict(viewData));
  }

  return {
    filePath: data['file_path'] as string,
    taskViews,
    mainBranchEvents: ((data['main_branch_events'] ?? []) as Record<string, unknown>[]).map(
      mainBranchEventFromDict
    ),
  };
}

function taskFileViewFromDict(data: Record<string, unknown>): TaskFileView {
  const bp = data['branch_point'] as Record<string, unknown>;
  const ti = data['task_intent'] as Record<string, unknown>;
  const ws = data['worktree_state'] as Record<string, unknown> | null;

  return {
    taskId: data['task_id'] as string,
    branchPoint: {
      commitHash: bp['commit_hash'] as string,
      content: bp['content'] as string,
      timestamp: new Date(bp['timestamp'] as string),
    },
    taskIntent: {
      title: ti['title'] as string,
      description: ti['description'] as string,
      fromPlan: ti['from_plan'] as boolean,
    },
    worktreeState: ws ? {
      content: ws['content'] as string,
      lastModified: new Date(ws['last_modified'] as string),
    } : undefined,
    commitsBehinMain: data['commits_behind_main'] as number,
    status: data['status'] as 'active' | 'merged' | 'abandoned',
    mergedAt: data['merged_at'] ? new Date(data['merged_at'] as string) : undefined,
  };
}

function mainBranchEventFromDict(data: Record<string, unknown>): MainBranchEvent {
  return {
    commitHash: data['commit_hash'] as string,
    timestamp: new Date(data['timestamp'] as string),
    content: data['content'] as string,
    source: data['source'] as 'human' | 'merged_task',
    commitMessage: (data['commit_message'] as string | null) ?? undefined,
    author: (data['author'] as string | null) ?? undefined,
    diffSummary: (data['diff_summary'] as string | null) ?? undefined,
    mergedFromTask: (data['merged_from_task'] as string | null) ?? undefined,
  };
}

// =============================================================================
// Persistence
// =============================================================================

class TimelinePersistence {
  private readonly storagePath: string;
  private readonly timelinesDir: string;
  private readonly indexFile: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.timelinesDir = path.join(storagePath, 'timelines');
    this.indexFile = path.join(this.timelinesDir, 'index.json');

    fs.mkdirSync(this.timelinesDir, { recursive: true });
  }

  saveTimeline(filePath: string, timeline: FileTimeline): void {
    const safeName = filePath.replace(/[/\\]/g, '_').replace(/\./g, '_');
    const timelineFile = path.join(this.timelinesDir, `${safeName}.json`);

    try {
      fs.writeFileSync(timelineFile, JSON.stringify(fileTimelineToDict(timeline), null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  }

  loadAllTimelines(): Map<string, FileTimeline> {
    const timelines = new Map<string, FileTimeline>();

    if (!fs.existsSync(this.indexFile)) return timelines;

    try {
      const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as string[];
      for (const filePath of index) {
        const safeName = filePath.replace(/[/\\]/g, '_').replace(/\./g, '_');
        const timelineFile = path.join(this.timelinesDir, `${safeName}.json`);

        if (fs.existsSync(timelineFile)) {
          const data = JSON.parse(fs.readFileSync(timelineFile, 'utf8')) as Record<string, unknown>;
          timelines.set(filePath, fileTimelineFromDict(data));
        }
      }
    } catch {
      // Return empty if loading fails
    }

    return timelines;
  }

  updateIndex(filePaths: string[]): void {
    try {
      fs.writeFileSync(this.indexFile, JSON.stringify(filePaths, null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  }
}

// =============================================================================
// Git helpers
// =============================================================================

function tryRunGit(args: string[], cwd: string): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function getFileContentAtCommit(filePath: string, commitHash: string, cwd: string): string | undefined {
  const output = tryRunGit(['show', `${commitHash}:${filePath}`], cwd);
  return output ?? undefined;
}

function getCurrentMainCommit(cwd: string): string {
  return tryRunGit(['rev-parse', 'HEAD'], cwd) ?? 'unknown';
}

function getFilesChangedInCommit(commitHash: string, cwd: string): string[] {
  const output = tryRunGit(['diff-tree', '--no-commit-id', '-r', '--name-only', commitHash], cwd);
  if (!output) return [];
  return output.split('\n').filter((f) => f);
}

function getCommitInfo(commitHash: string, cwd: string): Record<string, string> {
  const message = tryRunGit(['log', '--format=%s', '-1', commitHash], cwd);
  const author = tryRunGit(['log', '--format=%an', '-1', commitHash], cwd);
  return {
    message: message ?? '',
    author: author ?? '',
  };
}

function getWorktreeFileContent(taskId: string, filePath: string, projectDir: string): string {
  // Try common worktree locations
  const worktreePath = path.join(projectDir, '.auto-claude', 'worktrees', taskId, filePath);
  if (fs.existsSync(worktreePath)) {
    try {
      return fs.readFileSync(worktreePath, 'utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function getBranchPoint(worktreePath: string, targetBranch?: string): string | undefined {
  const branch = targetBranch ?? detectTargetBranch(worktreePath);
  return tryRunGit(['merge-base', branch, 'HEAD'], worktreePath) ?? undefined;
}

function getChangedFilesInWorktree(worktreePath: string, targetBranch?: string): string[] {
  const branch = targetBranch ?? detectTargetBranch(worktreePath);
  const mergeBase = tryRunGit(['merge-base', branch, 'HEAD'], worktreePath);
  if (!mergeBase) return [];

  const output = tryRunGit(['diff', '--name-only', `${mergeBase}..HEAD`], worktreePath);
  if (!output) return [];
  return output.split('\n').filter((f) => f);
}

function countCommitsBetween(fromCommit: string, toRef: string, cwd: string): number {
  const output = tryRunGit(['rev-list', '--count', `${fromCommit}..${toRef}`], cwd);
  return parseInt(output ?? '0', 10);
}

function detectTargetBranch(worktreePath: string): string {
  for (const branch of ['main', 'master', 'develop']) {
    const result = tryRunGit(['merge-base', branch, 'HEAD'], worktreePath);
    if (result !== null) return branch;
  }
  return 'main';
}

// =============================================================================
// FileTimelineTracker
// =============================================================================

/**
 * Central service managing all file timelines.
 *
 * This service tracks the "drift" between tasks and main branch,
 * providing full context for merge decisions.
 */
export class FileTimelineTracker {
  private readonly projectPath: string;
  private readonly persistence: TimelinePersistence;
  private timelines: Map<string, FileTimeline>;

  constructor(projectPath: string, storagePath?: string) {
    this.projectPath = path.resolve(projectPath);
    const resolvedStoragePath = storagePath ?? path.join(this.projectPath, '.auto-claude');
    this.persistence = new TimelinePersistence(resolvedStoragePath);
    this.timelines = this.persistence.loadAllTimelines();
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  onTaskStart(
    taskId: string,
    filesToModify: string[],
    filesToCreate?: string[],
    branchPointCommit?: string,
    taskIntent = '',
    taskTitle = '',
  ): void {
    const branchPoint = branchPointCommit ?? getCurrentMainCommit(this.projectPath);
    const timestamp = new Date();

    for (const filePath of filesToModify) {
      const timeline = this.getOrCreateTimeline(filePath);

      const content = getFileContentAtCommit(filePath, branchPoint, this.projectPath) ?? '';

      const taskView: TaskFileView = {
        taskId,
        branchPoint: { commitHash: branchPoint, content, timestamp },
        taskIntent: {
          title: taskTitle || taskId,
          description: taskIntent,
          fromPlan: Boolean(taskIntent),
        },
        commitsBehinMain: 0,
        status: 'active',
      };

      addTaskView(timeline, taskView);
      this.persistTimeline(filePath);
    }
  }

  onMainBranchCommit(commitHash: string): void {
    const changedFiles = getFilesChangedInCommit(commitHash, this.projectPath);

    for (const filePath of changedFiles) {
      if (!this.timelines.has(filePath)) continue;

      const timeline = this.timelines.get(filePath)!;
      const content = getFileContentAtCommit(filePath, commitHash, this.projectPath);
      if (!content) continue;

      const commitInfo = getCommitInfo(commitHash, this.projectPath);
      const event: MainBranchEvent = {
        commitHash,
        timestamp: new Date(),
        content,
        source: 'human',
        commitMessage: commitInfo['message'],
        author: commitInfo['author'],
      };

      addMainEvent(timeline, event);
      this.persistTimeline(filePath);
    }
  }

  onTaskWorktreeChange(taskId: string, filePath: string, newContent: string): void {
    const timeline = this.timelines.get(filePath) ?? this.getOrCreateTimeline(filePath);
    const taskView = getTaskView(timeline, taskId);
    if (!taskView) return;

    taskView.worktreeState = { content: newContent, lastModified: new Date() };
    this.persistTimeline(filePath);
  }

  onTaskMerged(taskId: string, mergeCommit: string): void {
    const taskFiles = this.getFilesForTask(taskId);

    for (const filePath of taskFiles) {
      const timeline = this.timelines.get(filePath);
      if (!timeline) continue;

      const taskView = getTaskView(timeline, taskId);
      if (!taskView) continue;

      taskView.status = 'merged';
      taskView.mergedAt = new Date();

      const content = getFileContentAtCommit(filePath, mergeCommit, this.projectPath);
      if (content) {
        addMainEvent(timeline, {
          commitHash: mergeCommit,
          timestamp: new Date(),
          content,
          source: 'merged_task',
          mergedFromTask: taskId,
          commitMessage: `Merged from ${taskId}`,
        });
      }

      this.persistTimeline(filePath);
    }
  }

  onTaskAbandoned(taskId: string): void {
    const taskFiles = this.getFilesForTask(taskId);

    for (const filePath of taskFiles) {
      const timeline = this.timelines.get(filePath);
      if (!timeline) continue;

      const taskView = getTaskView(timeline, taskId);
      if (taskView) taskView.status = 'abandoned';
      this.persistTimeline(filePath);
    }
  }

  // =========================================================================
  // QUERY METHODS
  // =========================================================================

  getMergeContext(taskId: string, filePath: string): MergeTimelineContext | undefined {
    const timeline = this.timelines.get(filePath);
    if (!timeline) return undefined;

    const taskView = getTaskView(timeline, taskId);
    if (!taskView) return undefined;

    const mainEvolution = getEventsSinceCommit(timeline, taskView.branchPoint.commitHash);
    const currentMain = getCurrentMainState(timeline);
    const currentMainContent = currentMain?.content ?? taskView.branchPoint.content;
    const currentMainCommit = currentMain?.commitHash ?? taskView.branchPoint.commitHash;

    const worktreeContent = taskView.worktreeState?.content
      ?? getWorktreeFileContent(taskId, filePath, this.projectPath);

    const otherTasks = getActiveTasks(timeline)
      .filter((tv) => tv.taskId !== taskId)
      .map((tv) => ({
        taskId: tv.taskId,
        intent: tv.taskIntent.description,
        branchPoint: tv.branchPoint.commitHash,
        commitsBehind: tv.commitsBehinMain,
      }));

    return {
      filePath,
      taskId,
      taskIntent: taskView.taskIntent,
      taskBranchPoint: taskView.branchPoint,
      mainEvolution,
      taskWorktreeContent: worktreeContent,
      currentMainContent,
      currentMainCommit,
      otherPendingTasks: otherTasks,
      totalCommitsBehind: taskView.commitsBehinMain,
      totalPendingTasks: otherTasks.length,
    };
  }

  getFilesForTask(taskId: string): string[] {
    const files: string[] = [];
    for (const [filePath, timeline] of this.timelines) {
      if (timeline.taskViews.has(taskId)) files.push(filePath);
    }
    return files;
  }

  getPendingTasksForFile(filePath: string): TaskFileView[] {
    const timeline = this.timelines.get(filePath);
    if (!timeline) return [];
    return getActiveTasks(timeline);
  }

  getTaskDrift(taskId: string): Map<string, number> {
    const drift = new Map<string, number>();
    for (const [filePath, timeline] of this.timelines) {
      const taskView = getTaskView(timeline, taskId);
      if (taskView?.status === 'active') {
        drift.set(filePath, taskView.commitsBehinMain);
      }
    }
    return drift;
  }

  hasTimeline(filePath: string): boolean {
    return this.timelines.has(filePath);
  }

  getTimeline(filePath: string): FileTimeline | undefined {
    return this.timelines.get(filePath);
  }

  // =========================================================================
  // CAPTURE METHODS
  // =========================================================================

  captureWorktreeState(taskId: string, worktreePath: string): void {
    try {
      const changedFiles = getChangedFilesInWorktree(worktreePath);

      for (const filePath of changedFiles) {
        const fullPath = path.join(worktreePath, filePath);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            this.onTaskWorktreeChange(taskId, filePath, content);
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  initializeFromWorktree(
    taskId: string,
    worktreePath: string,
    taskIntent = '',
    taskTitle = '',
    targetBranch?: string,
  ): void {
    try {
      const branchPoint = getBranchPoint(worktreePath, targetBranch);
      if (!branchPoint) return;

      const changedFiles = getChangedFilesInWorktree(worktreePath, targetBranch);
      if (changedFiles.length === 0) return;

      this.onTaskStart(taskId, changedFiles, [], branchPoint, taskIntent, taskTitle);
      this.captureWorktreeState(taskId, worktreePath);

      // Calculate drift
      const actualTarget = targetBranch ?? detectTargetBranch(worktreePath);
      const drift = countCommitsBetween(branchPoint, actualTarget, worktreePath);

      for (const filePath of changedFiles) {
        const timeline = this.timelines.get(filePath);
        if (timeline) {
          const taskView = getTaskView(timeline, taskId);
          if (taskView) taskView.commitsBehinMain = drift;
          this.persistTimeline(filePath);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private getOrCreateTimeline(filePath: string): FileTimeline {
    if (!this.timelines.has(filePath)) {
      this.timelines.set(filePath, createFileTimeline(filePath));
    }
    return this.timelines.get(filePath)!;
  }

  private persistTimeline(filePath: string): void {
    const timeline = this.timelines.get(filePath);
    if (!timeline) return;

    this.persistence.saveTimeline(filePath, timeline);
    this.persistence.updateIndex([...this.timelines.keys()]);
  }
}
