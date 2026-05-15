import { csvEscape } from "@/lib/csv-export";
import type { QaFlagSnapshot } from "@/lib/feedback-qa-flags";
import type { QaRejectionSnapshot } from "@/lib/qa-rejection-metrics";

export function qaFeedbackReviewerMetricsToCsv(params: {
  qaRejection: QaRejectionSnapshot;
  qaFlags: QaFlagSnapshot;
}): string {
  const { qaRejection, qaFlags } = params;
  const flagRowsByGroup = new Map(
    qaFlags.byUser.map((row) => [row.groupKey, row] as const),
  );
  const headers = [
    "reviewer",
    "reviewer_group_key",
    "total_feedback",
    "approved",
    "rejected",
    "unknown",
    "rejection_rate_percent",
    "flagged",
    "escalated",
    "bugged",
    "flagged_rate_percent",
    "flagged_task_count",
    "escalated_task_count",
    "bugged_task_count",
  ];
  const lines = qaRejection.byUser.map((row) => {
    const flags = flagRowsByGroup.get(row.groupKey);
    return [
      row.label,
      row.groupKey,
      row.total,
      row.approved,
      row.rejected,
      row.unknown,
      row.classifiedRejectionPercent,
      flags?.flagged ?? 0,
      flags?.escalated ?? 0,
      flags?.bugged ?? 0,
      flags?.flaggedPercent ?? null,
      flags?.flaggedTaskCount ?? 0,
      flags?.escalatedTaskCount ?? 0,
      flags?.buggedTaskCount ?? 0,
    ]
      .map((value) => csvEscape(value))
      .join(",");
  });

  return [headers.join(","), ...lines].join("\n") + "\n";
}
