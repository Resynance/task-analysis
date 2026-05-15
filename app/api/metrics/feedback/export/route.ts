import { buildMetricsArtifacts } from "@/lib/metrics-artifacts";
import { qaFeedbackReviewerMetricsToCsv } from "@/lib/metrics-feedback-export";
import { loadMetricsScope } from "@/lib/metrics-scope";
import {
  filterRowsByReviewerMinRecords,
  QA_MIN_REVIEWER_RECORDS,
} from "@/lib/qa-reviewer-record-filter";
import {
  filterRowsForQaRejectionWindow,
  resolveQaRejectionWindow,
} from "@/lib/qa-rejection-window";

export const dynamic = "force-dynamic";

function searchParamsToRecord(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = record[key];
    if (existing === undefined) {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[key] = [existing, value];
    }
  }
  return record;
}

function hasMinQaRecords(searchParams: URLSearchParams): boolean {
  return searchParams
    .getAll("minQaRecords")
    .includes(String(QA_MIN_REVIEWER_RECORDS));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const sp = searchParamsToRecord(searchParams);
  const ctx = await loadMetricsScope(sp, "/metrics/feedback");
  const qaWindow = resolveQaRejectionWindow(sp, "/metrics/feedback");
  const qaFeedbackRowsInWindow = filterRowsForQaRejectionWindow(
    ctx.scopedFeedback,
    qaWindow,
    now,
  );
  const qaFeedbackRows = hasMinQaRecords(searchParams)
    ? filterRowsByReviewerMinRecords(qaFeedbackRowsInWindow)
    : qaFeedbackRowsInWindow;
  const { qaRejection, qaFlags } = buildMetricsArtifacts({
    scopeLabel: ctx.scopeLabel,
    scopedPrompts: ctx.scopedPrompts,
    scopedFeedback: ctx.scopedFeedback,
    qaRejectionFeedbackRows: qaFeedbackRows,
  });
  const csv = qaFeedbackReviewerMetricsToCsv({ qaRejection, qaFlags });
  const stamp = now.toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="metrics-feedback-reviewers-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
