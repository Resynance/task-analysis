import type { PromptScore } from "@/generated/prisma/enums";
import { isTryoutsImportProject } from "@/lib/task-project";
import {
  getTaskLifecycleStatusFromExtra,
  taskLifecycleEligibleForLlmAnalysis,
} from "@/lib/task-lifecycle";

/**
 * Aggregates prompt and feedback rows into **rolling-window metrics** (counts, author buckets,
 * score distributions) used by `/metrics` dashboards. Excludes tryout-only imports where noted.
 */
const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3_600_000;

/** Distinct authors with more than this many tasks in the rolling 7d window count toward {@link MetricsSnapshot.prompts.authorsOverTaskThresholdLast7Days}. */
export const PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD = 5;

export type PromptMetricRow = {
  score: PromptScore | null;
  extra: unknown;
  analyzedAt: Date | null;
  createdAt: Date;
  /** Import source slug (`Prompt.projectKey`); used to exclude tryouts from writer counts. */
  projectKey: string;
  /** Stable task-author bucket from import `created_by` (`id:…`), same as prompt library / users directory. */
  authorKey: string;
};

export type FeedbackMetricRow = {
  score: PromptScore | null;
  analyzedAt: Date | null;
  createdAt: Date;
  /** Stable reviewer bucket (id → email → name), same as feedback library / users directory. */
  authorKey: string;
};

export type ScoreBreakdown = {
  EXCELLENT: number;
  AVERAGE: number;
  POOR: number;
  PRUNED: number;
};

export type PromptLifecycleBreakdown = {
  /** No `task_lifecycle_status` in import metadata */
  unset: number;
  /** Explicit production (case-insensitive) */
  production: number;
  /** Any other non-empty lifecycle value */
  nonProduction: number;
};

export type MetricsSnapshot = {
  scopeLabel: string;
  prompts: {
    total: number;
    pending: number;
    scored: number;
    /** Share of prompts with any rubric score */
    scoredPercent: number | null;
    byScore: ScoreBreakdown;
    lifecycle: PromptLifecycleBreakdown;
    /** Unscored rows that qualify for rubric LLM analysis */
    pendingEligibleForRubricAnalysis: number;
    /**
     * Prompts whose `createdAt` is in the rolling last 7 days and whose lifecycle is
     * eligible for rubric analysis (no status = legacy, or `production`; excludes staging etc.).
     */
    createdLast7Days: number;
    analyzedLast7Days: number;
    /** Scored prompts whose `analyzedAt` is in the rolling last 24 hours. */
    analyzedLast24Hours: number;
    /** Distinct task authors (`extra.created_by`) with ≥1 non-tryouts-import prompt in scope whose `createdAt` is in the last 7 days. */
    authorsLast7Days: number;
    /** Distinct non-tryouts authors with ≥1 prompt whose `createdAt` is in the last 24 hours. */
    authorsLast24Hours: number;
    /**
     * Distinct authors with more than `PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD` non-tryouts prompts
     * whose `createdAt` falls in the last 7 days.
     */
    authorsOverTaskThresholdLast7Days: number;
    /** Same threshold, rolling 24 hours by `createdAt`. */
    authorsOverTaskThresholdLast24Hours: number;
    oldestPendingDays: number | null;
  };
  feedback: {
    total: number;
    pending: number;
    analyzed: number;
    analyzedPercent: number | null;
    byScore: ScoreBreakdown;
    analyzedLast7Days: number;
    /** Analyzed feedback rows whose `analyzedAt` is in the rolling last 24 hours. */
    analyzedLast24Hours: number;
    /** Distinct reviewers with at least one submission in scope whose `createdAt` is in the last 7 days. */
    authorsLast7Days: number;
    /** Distinct reviewers with ≥1 row whose `createdAt` is in the last 24 hours. */
    authorsLast24Hours: number;
  };
};

function emptyScoreBreakdown(): ScoreBreakdown {
  return { EXCELLENT: 0, AVERAGE: 0, POOR: 0, PRUNED: 0 };
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function computeMetricsSnapshot(
  prompts: PromptMetricRow[],
  feedback: FeedbackMetricRow[],
  scopeLabel: string,
): MetricsSnapshot {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * MS_PER_HOUR);

  const byScore = emptyScoreBreakdown();
  let pending = 0;
  let pendingEligibleForRubricAnalysis = 0;
  let createdLast7Days = 0;
  let analyzedLast7Days = 0;
  let analyzedLast24Hours = 0;
  const lifecycle: PromptLifecycleBreakdown = {
    unset: 0,
    production: 0,
    nonProduction: 0,
  };

  let oldestPending: Date | null = null;
  const promptTasksByAuthorLast7 = new Map<string, number>();
  const promptTasksByAuthorLast24 = new Map<string, number>();

  for (const p of prompts) {
    if (
      p.createdAt >= sevenDaysAgo &&
      taskLifecycleEligibleForLlmAnalysis(p.extra)
    ) {
      createdLast7Days += 1;
    }
    if (
      p.createdAt >= sevenDaysAgo &&
      !isTryoutsImportProject(p.projectKey)
    ) {
      const k = p.authorKey;
      promptTasksByAuthorLast7.set(
        k,
        (promptTasksByAuthorLast7.get(k) ?? 0) + 1,
      );
    }
    if (
      p.createdAt >= twentyFourHoursAgo &&
      !isTryoutsImportProject(p.projectKey)
    ) {
      const k = p.authorKey;
      promptTasksByAuthorLast24.set(
        k,
        (promptTasksByAuthorLast24.get(k) ?? 0) + 1,
      );
    }
    const ls = getTaskLifecycleStatusFromExtra(p.extra);
    if (ls == null) lifecycle.unset += 1;
    else if (ls.toLowerCase() === "production") lifecycle.production += 1;
    else lifecycle.nonProduction += 1;

    if (p.score == null) {
      pending += 1;
      if (taskLifecycleEligibleForLlmAnalysis(p.extra)) {
        pendingEligibleForRubricAnalysis += 1;
      }
      const c = p.createdAt;
      if (!oldestPending || c < oldestPending) oldestPending = c;
    } else {
      byScore[p.score] += 1;
      if (p.analyzedAt && p.analyzedAt >= sevenDaysAgo) {
        analyzedLast7Days += 1;
      }
      if (p.analyzedAt && p.analyzedAt >= twentyFourHoursAgo) {
        analyzedLast24Hours += 1;
      }
    }
  }

  const scored = prompts.length - pending;
  const scoredPercent =
    prompts.length > 0 ? Math.round((scored / prompts.length) * 1000) / 10 : null;

  const fbBy = emptyScoreBreakdown();
  let fbPending = 0;
  let fbAnalyzedLast7 = 0;
  let fbAnalyzedLast24 = 0;
  const authorsSeenLast7 = new Set<string>();
  const authorsSeenLast24 = new Set<string>();

  for (const f of feedback) {
    if (f.createdAt >= sevenDaysAgo) {
      authorsSeenLast7.add(f.authorKey);
    }
    if (f.createdAt >= twentyFourHoursAgo) {
      authorsSeenLast24.add(f.authorKey);
    }
    if (f.score == null) {
      fbPending += 1;
    } else {
      fbBy[f.score] += 1;
      if (f.analyzedAt && f.analyzedAt >= sevenDaysAgo) {
        fbAnalyzedLast7 += 1;
      }
      if (f.analyzedAt && f.analyzedAt >= twentyFourHoursAgo) {
        fbAnalyzedLast24 += 1;
      }
    }
  }

  const fbAnalyzed = feedback.length - fbPending;
  const analyzedPercent =
    feedback.length > 0
      ? Math.round((fbAnalyzed / feedback.length) * 1000) / 10
      : null;

  let authorsOverTaskThresholdLast7Days = 0;
  for (const n of promptTasksByAuthorLast7.values()) {
    if (n > PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD) {
      authorsOverTaskThresholdLast7Days += 1;
    }
  }

  let authorsOverTaskThresholdLast24Hours = 0;
  for (const n of promptTasksByAuthorLast24.values()) {
    if (n > PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD) {
      authorsOverTaskThresholdLast24Hours += 1;
    }
  }

  return {
    scopeLabel,
    prompts: {
      total: prompts.length,
      pending,
      scored,
      scoredPercent,
      byScore,
      lifecycle,
      pendingEligibleForRubricAnalysis: pendingEligibleForRubricAnalysis,
      createdLast7Days,
      analyzedLast7Days,
      analyzedLast24Hours,
      authorsLast7Days: promptTasksByAuthorLast7.size,
      authorsLast24Hours: promptTasksByAuthorLast24.size,
      authorsOverTaskThresholdLast7Days,
      authorsOverTaskThresholdLast24Hours,
      oldestPendingDays:
        pending > 0 && oldestPending != null
          ? daysBetween(oldestPending, now)
          : null,
    },
    feedback: {
      total: feedback.length,
      pending: fbPending,
      analyzed: fbAnalyzed,
      analyzedPercent,
      byScore: fbBy,
      analyzedLast7Days: fbAnalyzedLast7,
      analyzedLast24Hours: fbAnalyzedLast24,
      authorsLast7Days: authorsSeenLast7.size,
      authorsLast24Hours: authorsSeenLast24.size,
    },
  };
}
