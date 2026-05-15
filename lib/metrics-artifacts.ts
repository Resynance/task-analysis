import {
  computeMetricsSnapshot,
  type FeedbackMetricRow,
  type PromptMetricRow,
  type MetricsSnapshot,
} from "@/lib/metrics-compute";
import {
  computeQaRejectionMetrics,
  type QaRejectionSnapshot,
} from "@/lib/qa-rejection-metrics";
import {
  computeQaFlagMetrics,
  type QaFlagSnapshot,
} from "@/lib/feedback-qa-flags";
import type { FeedbackRowForMetrics, PromptRowForMetrics } from "@/lib/metrics-scope";
import { canonicalKeyFromPromptExtra } from "@/lib/explore/creator-from-extra";
import { canonicalKeyFromFeedbackSlice } from "@/lib/users-directory";

export function buildMetricsArtifacts(params: {
  scopeLabel: string;
  scopedPrompts: PromptRowForMetrics[];
  scopedFeedback: FeedbackRowForMetrics[];
  /** Rows used only for QA rejection metrics (e.g. time-windowed subset). Defaults to full scoped feedback. */
  qaRejectionFeedbackRows?: FeedbackRowForMetrics[];
}): {
  snapshot: MetricsSnapshot;
  qaRejection: QaRejectionSnapshot;
  qaFlags: QaFlagSnapshot;
} {
  const promptsForCompute: PromptMetricRow[] = params.scopedPrompts.map(
    ({ envKey: _e, sourceId: _sid, sourceKey: _sk, extra, ...rest }) => ({
      ...rest,
      extra,
      authorKey: canonicalKeyFromPromptExtra(extra),
    }),
  );
  const feedbackForCompute: FeedbackMetricRow[] = params.scopedFeedback.map(
    (r) => ({
      score: r.score,
      analyzedAt: r.analyzedAt,
      createdAt: r.createdAt,
      authorKey: canonicalKeyFromFeedbackSlice(r),
    }),
  );

  const qaFeedback =
    params.qaRejectionFeedbackRows ?? params.scopedFeedback;

  const qaRejection = computeQaRejectionMetrics(
    qaFeedback.map((r) => ({
      extra: r.extra,
      createdById: r.createdById,
      createdByName: r.createdByName,
      createdByEmail: r.createdByEmail,
    })),
  );

  const qaFlags = computeQaFlagMetrics(
    qaFeedback.map((r) => ({
      taskId: r.taskId,
      taskKey: r.taskKey,
      sourceFeedbackId: r.sourceFeedbackId,
      sourceCreated: r.sourceCreated,
      createdAt: r.createdAt,
      createdById: r.createdById,
      createdByName: r.createdByName,
      createdByEmail: r.createdByEmail,
    })),
    params.scopedPrompts.map((p) => ({
      sourceId: p.sourceId,
      sourceKey: p.sourceKey,
      extra: p.extra,
    })),
  );

  const snapshot = computeMetricsSnapshot(
    promptsForCompute,
    feedbackForCompute,
    params.scopeLabel,
  );

  return { snapshot, qaRejection, qaFlags };
}
