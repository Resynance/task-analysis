import type { PromptScore } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalKeyFromPromptExtra } from "@/lib/explore/creator-from-extra";
import { fetchPromptLibraryMeta } from "@/lib/prompt-library-page";
import {
  canonicalKeyFromFeedbackSlice,
  encodeUserKeyForPath,
  resolveDisplayName,
  secondaryContactEmailLine,
} from "@/lib/users-directory";
import { isTryoutsImportProject } from "@/lib/task-project";

/**
 * Default share-of-POOR threshold (percent) used by `/flags`. Tunable via `?threshold=` (max 100,
 * positive integers/decimals). Above this percentage on prompts or feedback the user is flagged.
 */
export const DEFAULT_POOR_PERCENT_THRESHOLD = 40;

/**
 * Default minimum number of scored items (POOR + AVERAGE + EXCELLENT, PRUNED excluded) before a
 * user can be flagged. Avoids 1/2 = 50% style noise; surfaced via `?min=`.
 */
export const DEFAULT_MIN_SCORED_SAMPLE = 5;

/** Hard ceiling on `?min=` to keep the page responsive on edge inputs. */
export const MAX_MIN_SCORED_SAMPLE = 1000;

/** Per-user score breakdown over the full dataset (no time window). */
export type UserScoreBreakdown = {
  /** Tasks with a rubric score (any tier, including PRUNED). */
  scored: number;
  /** Tasks classified POOR. */
  poor: number;
  /**
   * Denominator for `poorPercent`: EXCELLENT + AVERAGE + POOR. PRUNED items are intentionally
   * excluded since they were pulled out of the dataset and don't reflect quality.
   */
  classified: number;
  /**
   * Share of `classified` that scored POOR, rounded to one decimal. `null` if no classified
   * samples (cannot evaluate the rate).
   */
  poorPercent: number | null;
};

export type FlaggedUserRow = {
  /** Canonical `id:` / `email:` / `name:` / `unknown` key — links to `/users/[userKey]`. */
  userKey: string;
  encodedUserKey: string;
  displayName: string;
  /** Secondary email line (when `displayName` is a name/id, not an email) — same rule as `/users`. */
  secondaryEmail: string | null;
  prompts: UserScoreBreakdown;
  feedback: UserScoreBreakdown;
  /** True when `prompts.poorPercent > threshold` AND `prompts.classified >= minScoredSample`. */
  promptsFlagged: boolean;
  /** Same rule for feedback. */
  feedbackFlagged: boolean;
  /** Largest of `prompts.poorPercent` / `feedback.poorPercent` among flagged categories. Used for sorting. */
  maxFlaggedPoorPercent: number;
};

export type FlagsSnapshot = {
  threshold: number;
  minScoredSample: number;
  flagged: FlaggedUserRow[];
  /**
   * Total number of users with at least one prompt or feedback record (post-tryouts filter for
   * prompts) — denominator for "X of Y users flagged" copy.
   */
  totalUsersWithRecords: number;
};

function emptyBreakdown(): { scored: number; poor: number; classified: number } {
  return { scored: 0, poor: 0, classified: 0 };
}

function finalizeBreakdown(b: {
  scored: number;
  poor: number;
  classified: number;
}): UserScoreBreakdown {
  return {
    scored: b.scored,
    poor: b.poor,
    classified: b.classified,
    poorPercent:
      b.classified > 0 ? Math.round((b.poor / b.classified) * 1000) / 10 : null,
  };
}

function shouldCountInClassified(score: PromptScore): boolean {
  return score === "EXCELLENT" || score === "AVERAGE" || score === "POOR";
}

/** Clamp `?threshold=` to a sensible range (0–100, default {@link DEFAULT_POOR_PERCENT_THRESHOLD}). */
export function parseThresholdParam(raw: unknown): number {
  if (typeof raw !== "string") return DEFAULT_POOR_PERCENT_THRESHOLD;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULT_POOR_PERCENT_THRESHOLD;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 10) / 10;
}

/** Clamp `?min=` to a non-negative integer up to {@link MAX_MIN_SCORED_SAMPLE}. */
export function parseMinSampleParam(raw: unknown): number {
  if (typeof raw !== "string") return DEFAULT_MIN_SCORED_SAMPLE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MIN_SCORED_SAMPLE;
  if (n < 0) return 0;
  if (n > MAX_MIN_SCORED_SAMPLE) return MAX_MIN_SCORED_SAMPLE;
  return n;
}

/**
 * Compute per-user POOR rates for prompts and feedback, then return the rows that exceed
 * `threshold` (percent) on either side with at least `minScoredSample` classified items.
 *
 * Prompts from the tryouts import (`projectKey === "tryouts"`) are excluded — they're scratch
 * data. Feedback rows are included regardless of project, since QA reviewers can submit feedback
 * across projects and we want flags for any of it.
 */
export async function computeFlaggedUsers(params: {
  prisma: PrismaClient;
  nameByUserId: Map<string, string>;
  threshold?: number;
  minScoredSample?: number;
}): Promise<FlagsSnapshot> {
  const threshold = params.threshold ?? DEFAULT_POOR_PERCENT_THRESHOLD;
  const minScoredSample = params.minScoredSample ?? DEFAULT_MIN_SCORED_SAMPLE;

  const [feedbackRows, promptMeta] = await Promise.all([
    params.prisma.feedback.findMany({
      select: {
        createdById: true,
        createdByEmail: true,
        createdByName: true,
        score: true,
      },
    }),
    fetchPromptLibraryMeta(params.prisma),
  ]);

  type Aggregate = {
    prompts: ReturnType<typeof emptyBreakdown>;
    feedback: ReturnType<typeof emptyBreakdown>;
    candidate: { name?: string; email?: string; id?: string };
  };
  const byKey = new Map<string, Aggregate>();

  function ensure(key: string): Aggregate {
    let cur = byKey.get(key);
    if (!cur) {
      cur = {
        prompts: emptyBreakdown(),
        feedback: emptyBreakdown(),
        candidate: {},
      };
      byKey.set(key, cur);
    }
    return cur;
  }

  for (const m of promptMeta) {
    if (isTryoutsImportProject(m.projectKey)) continue;
    const key = canonicalKeyFromPromptExtra(m.extra);
    const agg = ensure(key);
    if (key.startsWith("id:") && !agg.candidate.id) {
      agg.candidate.id = key.slice(3);
    }
    if (m.score == null) continue;
    agg.prompts.scored += 1;
    if (shouldCountInClassified(m.score)) {
      agg.prompts.classified += 1;
    }
    if (m.score === "POOR") agg.prompts.poor += 1;
  }

  for (const r of feedbackRows) {
    const key = canonicalKeyFromFeedbackSlice(r);
    const agg = ensure(key);
    if (!agg.candidate.name && r.createdByName?.trim()) {
      agg.candidate.name = r.createdByName.trim();
    }
    if (!agg.candidate.email && r.createdByEmail?.trim()) {
      agg.candidate.email = r.createdByEmail.trim();
    }
    if (!agg.candidate.id && r.createdById?.trim()) {
      agg.candidate.id = r.createdById.trim();
    }
    if (r.score == null) continue;
    agg.feedback.scored += 1;
    if (shouldCountInClassified(r.score)) {
      agg.feedback.classified += 1;
    }
    if (r.score === "POOR") agg.feedback.poor += 1;
  }

  const flagged: FlaggedUserRow[] = [];
  let totalUsersWithRecords = 0;

  for (const [key, agg] of byKey) {
    const totalRecords =
      agg.prompts.scored +
      agg.feedback.scored +
      // We don't track unscored counts here; the directory already does.
      0;
    if (totalRecords === 0 && key === "unknown") {
      // skip phantom unknown buckets with no scored rows
      continue;
    }
    totalUsersWithRecords += 1;

    const prompts = finalizeBreakdown(agg.prompts);
    const feedback = finalizeBreakdown(agg.feedback);

    const promptsFlagged =
      prompts.poorPercent != null &&
      prompts.classified >= minScoredSample &&
      prompts.poorPercent > threshold;
    const feedbackFlagged =
      feedback.poorPercent != null &&
      feedback.classified >= minScoredSample &&
      feedback.poorPercent > threshold;

    if (!promptsFlagged && !feedbackFlagged) continue;

    const displayName = resolveDisplayName(key, agg.candidate, params.nameByUserId);
    const secondaryEmail = secondaryContactEmailLine({
      key,
      displayName,
      contactEmail: agg.candidate.email ?? null,
    });

    const maxFlaggedPoorPercent = Math.max(
      promptsFlagged ? (prompts.poorPercent ?? 0) : 0,
      feedbackFlagged ? (feedback.poorPercent ?? 0) : 0,
    );

    flagged.push({
      userKey: key,
      encodedUserKey: encodeUserKeyForPath(key),
      displayName,
      secondaryEmail,
      prompts,
      feedback,
      promptsFlagged,
      feedbackFlagged,
      maxFlaggedPoorPercent,
    });
  }

  flagged.sort((a, b) => {
    if (b.maxFlaggedPoorPercent !== a.maxFlaggedPoorPercent) {
      return b.maxFlaggedPoorPercent - a.maxFlaggedPoorPercent;
    }
    const aSamples = a.prompts.classified + a.feedback.classified;
    const bSamples = b.prompts.classified + b.feedback.classified;
    if (bSamples !== aSamples) return bSamples - aSamples;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });

  return {
    threshold,
    minScoredSample,
    flagged,
    totalUsersWithRecords,
  };
}
