import type { PromptScore } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalKeyFromPromptExtra } from "@/lib/explore/creator-from-extra";
import {
  fetchPromptLibraryMeta,
  type PromptLibraryMetaRow,
} from "@/lib/prompt-library-page";
import {
  canonicalKeyFromFeedbackSlice,
  getDisplayNameForUserKey,
  normalizeCanonicalUserKeyString,
} from "@/lib/users-directory";

function emptyScoreBreakdown(): Record<
  "EXCELLENT" | "AVERAGE" | "POOR" | "PRUNED",
  number
> {
  return { EXCELLENT: 0, AVERAGE: 0, POOR: 0, PRUNED: 0 };
}

export type MenteePodMetricRow = {
  userKey: string;
  label: string;
  feedbackCount: number;
  /** Feedback rows with a rubric score (analyzed). */
  feedbackScored: number;
  /** Breakdown of rubric scores on feedback for this mentee. */
  feedbackByScore: {
    EXCELLENT: number;
    AVERAGE: number;
    POOR: number;
    PRUNED: number;
  };
  promptCount: number;
  scoredPrompts: number;
  pendingPrompts: number;
  byScore: {
    EXCELLENT: number;
    AVERAGE: number;
    POOR: number;
    PRUNED: number;
  };
};

export type PodMenteeMetricsSnapshot = {
  mentees: MenteePodMetricRow[];
  totals: {
    feedbackCount: number;
    feedbackScored: number;
    feedbackByScore: MenteePodMetricRow["feedbackByScore"];
    promptCount: number;
    scoredPrompts: number;
    pendingPrompts: number;
    byScore: MenteePodMetricRow["byScore"];
  };
};

const SCORE_TIERS: Array<keyof MenteePodMetricRow["byScore"]> = [
  "EXCELLENT",
  "AVERAGE",
  "POOR",
  "PRUNED",
];

type FeedbackAgg = {
  count: number;
  scored: number;
  byScore: MenteePodMetricRow["feedbackByScore"];
};

type PromptAgg = {
  promptCount: number;
  scoredPrompts: number;
  pendingPrompts: number;
  byScore: MenteePodMetricRow["byScore"];
};

function emptyFeedbackAgg(): FeedbackAgg {
  return { count: 0, scored: 0, byScore: emptyScoreBreakdown() };
}

function emptyPromptAgg(): PromptAgg {
  return {
    promptCount: 0,
    scoredPrompts: 0,
    pendingPrompts: 0,
    byScore: emptyScoreBreakdown(),
  };
}

function isPromptScore(v: unknown): v is PromptScore {
  return (
    v === "EXCELLENT" ||
    v === "AVERAGE" ||
    v === "POOR" ||
    v === "PRUNED"
  );
}

export async function computePodMenteeMetrics(
  prisma: PrismaClient,
  menteeUserKeys: string[],
  nameByUserId: Map<string, string>,
): Promise<PodMenteeMetricsSnapshot> {
  const [feedbackRows, promptMeta] = await Promise.all([
    prisma.feedback.findMany({
      select: {
        createdById: true,
        createdByEmail: true,
        createdByName: true,
        score: true,
      },
    }),
    fetchPromptLibraryMeta(prisma),
  ]);

  const feedbackByKey = new Map<string, FeedbackAgg>();

  for (const r of feedbackRows) {
    const k = canonicalKeyFromFeedbackSlice(r);
    let agg = feedbackByKey.get(k);
    if (!agg) {
      agg = emptyFeedbackAgg();
      feedbackByKey.set(k, agg);
    }
    agg.count += 1;
    if (r.score == null) {
      /* pending feedback — no rubric score */
    } else {
      agg.scored += 1;
      if (isPromptScore(r.score)) {
        agg.byScore[r.score] += 1;
      }
    }
  }

  const promptAggByKey = new Map<string, PromptAgg>();

  for (const m of promptMeta) {
    const pk = canonicalKeyFromPromptExtra(m.extra);
    let agg = promptAggByKey.get(pk);
    if (!agg) {
      agg = emptyPromptAgg();
      promptAggByKey.set(pk, agg);
    }
    agg.promptCount += 1;
    if (m.score == null) {
      agg.pendingPrompts += 1;
    } else {
      agg.scoredPrompts += 1;
      if (isPromptScore(m.score)) {
        agg.byScore[m.score] += 1;
      }
    }
  }

  const mentees: MenteePodMetricRow[] = [];

  for (const rawKey of menteeUserKeys) {
    const mk = normalizeCanonicalUserKeyString(rawKey);
    const fb = feedbackByKey.get(mk) ?? emptyFeedbackAgg();
    const pa = promptAggByKey.get(mk) ?? emptyPromptAgg();

    mentees.push({
      userKey: rawKey,
      label: getDisplayNameForUserKey(mk, nameByUserId),
      feedbackCount: fb.count,
      feedbackScored: fb.scored,
      feedbackByScore: { ...fb.byScore },
      promptCount: pa.promptCount,
      scoredPrompts: pa.scoredPrompts,
      pendingPrompts: pa.pendingPrompts,
      byScore: { ...pa.byScore },
    });
  }

  mentees.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );

  const totals = {
    feedbackCount: 0,
    feedbackScored: 0,
    feedbackByScore: emptyScoreBreakdown(),
    promptCount: 0,
    scoredPrompts: 0,
    pendingPrompts: 0,
    byScore: emptyScoreBreakdown(),
  };

  for (const m of mentees) {
    totals.feedbackCount += m.feedbackCount;
    totals.feedbackScored += m.feedbackScored;
    totals.promptCount += m.promptCount;
    totals.scoredPrompts += m.scoredPrompts;
    totals.pendingPrompts += m.pendingPrompts;
    for (const k of SCORE_TIERS) {
      totals.feedbackByScore[k] += m.feedbackByScore[k];
      totals.byScore[k] += m.byScore[k];
    }
  }

  return { mentees, totals };
}
