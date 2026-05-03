/**
 * Bot Detector for GitHub Automation
 * =====================================
 *
 * Prevents infinite loops by detecting when the bot is reviewing its own work.
 * See apps/desktop/src/main/ai/runners/github/bot-detector.ts for the TypeScript implementation.
 *
 * Key Features:
 * - Identifies bot user from configured token
 * - Skips PRs authored by the bot
 * - Skips re-reviewing bot commits
 * - Implements cooling-off period to prevent rapid re-reviews
 * - Tracks reviewed commits to avoid duplicate reviews
 * - In-progress tracking to prevent concurrent reviews
 * - Stale review detection with automatic cleanup
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Types
// =============================================================================

interface BotDetectionStateData {
  reviewed_commits: Record<string, string[]>;
  last_review_times: Record<string, string>;
  in_progress_reviews: Record<string, string>;
}

/** PR data shape expected from GitHub API responses. */
export interface PRData {
  author?: { login?: string };
  [key: string]: unknown;
}

/** Commit data shape expected from GitHub API responses. */
export interface CommitData {
  author?: { login?: string };
  committer?: { login?: string };
  oid?: string;
  sha?: string;
  [key: string]: unknown;
}

// =============================================================================
// Constants
// =============================================================================

/** Cooling-off period in minutes between reviews of the same PR. */
const COOLING_OFF_MINUTES = 1;

/** Timeout in minutes before an in-progress review is considered stale. */
const IN_PROGRESS_TIMEOUT_MINUTES = 30;

/** State file name. */
const STATE_FILE = 'bot_detection_state.json';

// =============================================================================
// Bot Detection State
// =============================================================================

class BotDetectionState {
  reviewedCommits: Record<string, string[]>;
  lastReviewTimes: Record<string, string>;
  inProgressReviews: Record<string, string>;

  constructor(data: Partial<BotDetectionStateData> = {}) {
    this.reviewedCommits = data.reviewed_commits ?? {};
    this.lastReviewTimes = data.last_review_times ?? {};
    this.inProgressReviews = data.in_progress_reviews ?? {};
  }

  toJSON(): BotDetectionStateData {
    return {
      reviewed_commits: this.reviewedCommits,
      last_review_times: this.lastReviewTimes,
      in_progress_reviews: this.inProgressReviews,
    };
  }

  static fromJSON(data: BotDetectionStateData): BotDetectionState {
    return new BotDetectionState(data);
  }

  save(stateDir: string): void {
    mkdirSync(stateDir, { recursive: true });
    const stateFile = join(stateDir, STATE_FILE);
    writeFileSync(stateFile, JSON.stringify(this.toJSON(), null, 2), 'utf-8');
  }

  static load(stateDir: string): BotDetectionState {
    const stateFile = join(stateDir, STATE_FILE);
    if (!existsSync(stateFile)) {
      return new BotDetectionState();
    }
    try {
      const raw = JSON.parse(readFileSync(stateFile, 'utf-8')) as BotDetectionStateData;
      return BotDetectionState.fromJSON(raw);
    } catch {
      return new BotDetectionState();
    }
  }
}

// =============================================================================
// Bot Detector
// =============================================================================

/** Configuration for BotDetector. */
export interface BotDetectorConfig {
  /** Directory for storing detection state */
  stateDir: string;
  /** GitHub username of the bot (to skip bot-authored PRs/commits) */
  botUsername?: string;
  /** Whether the bot is allowed to review its own PRs (default: false) */
  reviewOwnPrs?: boolean;
}

/**
 * Detects bot-authored PRs and commits to prevent infinite review loops.
 */
export class BotDetector {
  private readonly stateDir: string;
  private readonly botUsername: string | undefined;
  private readonly reviewOwnPrs: boolean;
  private state: BotDetectionState;

  constructor(config: BotDetectorConfig) {
    this.stateDir = config.stateDir;
    this.botUsername = config.botUsername;
    this.reviewOwnPrs = config.reviewOwnPrs ?? false;
    this.state = BotDetectionState.load(this.stateDir);
  }

  /** Check if PR was created by the bot. */
  isBotPr(prData: PRData): boolean {
    if (!this.botUsername) return false;
    const author = prData.author?.login;
    return author === this.botUsername;
  }

  /** Check if commit was authored or committed by the bot. */
  isBotCommit(commitData: CommitData): boolean {
    if (!this.botUsername) return false;
    const author = commitData.author?.login;
    const committer = commitData.committer?.login;
    return author === this.botUsername || committer === this.botUsername;
  }

  /** Get the SHA of the most recent commit (last in the array). */
  getLastCommitSha(commits: CommitData[]): string | undefined {
    if (commits.length === 0) return undefined;
    const latest = commits[commits.length - 1];
    return (latest.oid ?? latest.sha) as string | undefined;
  }

  /** Check if PR is within the cooling-off period. Returns [isCooling, reason]. */
  isWithinCoolingOff(prNumber: number): [boolean, string] {
    const key = String(prNumber);
    const lastReviewStr = this.state.lastReviewTimes[key];
    if (!lastReviewStr) return [false, ''];

    try {
      const lastReview = new Date(lastReviewStr);
      const elapsedMs = Date.now() - lastReview.getTime();
      const elapsedMinutes = elapsedMs / 60_000;

      if (elapsedMinutes < COOLING_OFF_MINUTES) {
        const minutesLeft = Math.ceil(COOLING_OFF_MINUTES - elapsedMinutes);
        const reason = `Cooling off period active (reviewed ${Math.floor(elapsedMinutes)}m ago, ${minutesLeft}m remaining)`;
        return [true, reason];
      }
    } catch {
      // Invalid date — ignore
    }

    return [false, ''];
  }

  /** Check if we have already reviewed this specific commit SHA. */
  hasReviewedCommit(prNumber: number, commitSha: string): boolean {
    const reviewed = this.state.reviewedCommits[String(prNumber)] ?? [];
    return reviewed.includes(commitSha);
  }

  /** Check if a review is currently in-progress (with stale detection). Returns [isInProgress, reason]. */
  isReviewInProgress(prNumber: number): [boolean, string] {
    const key = String(prNumber);
    const startTimeStr = this.state.inProgressReviews[key];
    if (!startTimeStr) return [false, ''];

    try {
      const startTime = new Date(startTimeStr);
      const elapsedMs = Date.now() - startTime.getTime();
      const elapsedMinutes = elapsedMs / 60_000;

      if (elapsedMinutes > IN_PROGRESS_TIMEOUT_MINUTES) {
        // Stale review — clear it
        this.markReviewFinished(prNumber, false);
        return [false, ''];
      }

      const reason = `Review already in progress (started ${Math.floor(elapsedMinutes)}m ago)`;
      return [true, reason];
    } catch {
      this.markReviewFinished(prNumber, false);
      return [false, ''];
    }
  }

  /** Mark a review as started for this PR (prevents concurrent reviews). */
  markReviewStarted(prNumber: number): void {
    const key = String(prNumber);
    this.state.inProgressReviews[key] = new Date().toISOString();
    this.state.save(this.stateDir);
  }

  /**
   * Mark a review as finished.
   * Clears the in-progress state. Call regardless of success/failure.
   */
  markReviewFinished(prNumber: number, success = true): void {
    const key = String(prNumber);
    if (key in this.state.inProgressReviews) {
      delete this.state.inProgressReviews[key];
      this.state.save(this.stateDir);
    }
    void success; // parameter kept for API parity with Python
  }

  /**
   * Mark a PR as reviewed at a specific commit SHA.
   * Call after successfully posting the review.
   */
  markReviewed(prNumber: number, commitSha: string): void {
    const key = String(prNumber);

    if (!this.state.reviewedCommits[key]) {
      this.state.reviewedCommits[key] = [];
    }

    if (!this.state.reviewedCommits[key].includes(commitSha)) {
      this.state.reviewedCommits[key].push(commitSha);
    }

    this.state.lastReviewTimes[key] = new Date().toISOString();

    // Clear in-progress
    if (key in this.state.inProgressReviews) {
      delete this.state.inProgressReviews[key];
    }

    this.state.save(this.stateDir);
  }

  /**
   * Main entry point: determine if we should skip reviewing this PR.
   * Returns [shouldSkip, reason].
   */
  shouldSkipPrReview(
    prNumber: number,
    prData: PRData,
    commits?: CommitData[],
  ): [boolean, string] {
    // Check 1: Bot-authored PR
    if (!this.reviewOwnPrs && this.isBotPr(prData)) {
      const reason = `PR authored by bot user (${this.botUsername})`;
      return [true, reason];
    }

    // Check 2: Latest commit by the bot
    if (commits && commits.length > 0 && !this.reviewOwnPrs) {
      const latest = commits[commits.length - 1];
      if (latest && this.isBotCommit(latest)) {
        return [true, 'Latest commit authored by bot (likely an auto-fix)'];
      }
    }

    // Check 3: Review already in progress
    const [inProgress, progressReason] = this.isReviewInProgress(prNumber);
    if (inProgress) return [true, progressReason];

    // Check 4: Cooling-off period
    const [cooling, coolingReason] = this.isWithinCoolingOff(prNumber);
    if (cooling) return [true, coolingReason];

    // Check 5: Already reviewed this exact commit
    if (commits && commits.length > 0) {
      const headSha = this.getLastCommitSha(commits);
      if (headSha && this.hasReviewedCommit(prNumber, headSha)) {
        return [true, `Already reviewed commit ${headSha.slice(0, 8)}`];
      }
    }

    return [false, ''];
  }

  /** Reload state from disk (useful if state is updated externally). */
  reloadState(): void {
    this.state = BotDetectionState.load(this.stateDir);
  }

  /** Reset all detection state (for testing). */
  resetState(): void {
    this.state = new BotDetectionState();
    this.state.save(this.stateDir);
  }
}
