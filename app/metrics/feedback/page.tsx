import { MetricsFeedbackFilters } from "@/components/metrics-feedback-filters";
import { MetricsFeedbackDashboard } from "@/components/metrics-feedback-dashboard";
import { MetricsScopeShell } from "@/components/metrics-scope-shell";
import { buildMetricsArtifacts } from "@/lib/metrics-artifacts";
import { loadMetricsScope } from "@/lib/metrics-scope";
import {
  filterRowsByReviewerMinRecords,
  QA_MIN_REVIEWER_RECORDS,
} from "@/lib/qa-reviewer-record-filter";
import {
  filterRowsForQaRejectionWindow,
  resolveQaRejectionWindow,
} from "@/lib/qa-rejection-window";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Metrics · Feedback",
};

function parseMinQaRecords(raw: string | string[] | undefined): boolean {
  if (Array.isArray(raw)) {
    return raw.includes(String(QA_MIN_REVIEWER_RECORDS));
  }
  return raw === String(QA_MIN_REVIEWER_RECORDS);
}

export default async function MetricsFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadMetricsScope(sp, "/metrics/feedback");
  const qaWindow = resolveQaRejectionWindow(sp, "/metrics/feedback");
  const requireMinQaRecords = parseMinQaRecords(sp.minQaRecords);
  const now = new Date();
  const qaFeedbackRowsInWindow = filterRowsForQaRejectionWindow(
    ctx.scopedFeedback,
    qaWindow,
    now,
  );
  const qaFeedbackRows = requireMinQaRecords
    ? filterRowsByReviewerMinRecords(qaFeedbackRowsInWindow)
    : qaFeedbackRowsInWindow;
  const { snapshot, qaRejection, qaFlags } = buildMetricsArtifacts({
    scopeLabel: ctx.scopeLabel,
    scopedPrompts: ctx.scopedPrompts,
    scopedFeedback: ctx.scopedFeedback,
    qaRejectionFeedbackRows: qaFeedbackRows,
  });

  return (
    <MetricsScopeShell
      scopeLabel={ctx.scopeLabel}
      projectFilter={ctx.projectFilter}
      projectFilterOptions={ctx.projectFilterOptions}
      envFilter={ctx.envFilter}
      envFilterOptions={ctx.envFilterOptions}
      hideScopeControls
    >
      <MetricsFeedbackFilters
        scopeLabel={ctx.scopeLabel}
        projectFilter={ctx.projectFilter}
        projectFilterOptions={ctx.projectFilterOptions}
        envFilter={ctx.envFilter}
        envFilterOptions={ctx.envFilterOptions}
        qaWindow={qaWindow}
        minQaRecordsEnabled={requireMinQaRecords}
      />
      <MetricsFeedbackDashboard
        feedback={snapshot.feedback}
        qaRejection={qaRejection}
        qaFlags={qaFlags}
        qaWindow={qaWindow}
        minQaRecordsEnabled={requireMinQaRecords}
      />
    </MetricsScopeShell>
  );
}
