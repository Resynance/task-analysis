import { MetricsOverviewDashboard } from "@/components/metrics-overview-dashboard";
import { MetricsScopeShell } from "@/components/metrics-scope-shell";
import { buildMetricsArtifacts } from "@/lib/metrics-artifacts";
import { computeDailyCreationSeries } from "@/lib/metrics-daily-series";
import { loadMetricsScope, metricsQuerySuffix } from "@/lib/metrics-scope";
import {
  filterRowsForQaRejectionWindow,
  resolveQaRejectionWindow,
} from "@/lib/qa-rejection-window";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Metrics · Overview",
};

export default async function MetricsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadMetricsScope(sp, "/metrics");
  const qaWindow = resolveQaRejectionWindow(sp, "/metrics");
  const now = new Date();
  const qaFeedbackRows = filterRowsForQaRejectionWindow(
    ctx.scopedFeedback,
    qaWindow,
    now,
  );
  const { snapshot, qaRejection } = buildMetricsArtifacts({
    scopeLabel: ctx.scopeLabel,
    scopedPrompts: ctx.scopedPrompts,
    scopedFeedback: ctx.scopedFeedback,
    qaRejectionFeedbackRows: qaFeedbackRows,
  });

  const dailyCreationSeries = computeDailyCreationSeries(
    ctx.scopedPrompts,
    ctx.scopedFeedback,
    30,
  );

  return (
    <MetricsScopeShell
      scopeLabel={ctx.scopeLabel}
      projectFilter={ctx.projectFilter}
      projectFilterOptions={ctx.projectFilterOptions}
      envFilter={ctx.envFilter}
      envFilterOptions={ctx.envFilterOptions}
    >
      <MetricsOverviewDashboard
        snapshot={snapshot}
        qaRejection={qaRejection}
        linkQuery={metricsQuerySuffix(sp)}
        dailyCreationSeries={dailyCreationSeries}
        creationChartScopeLabel={ctx.scopeLabel}
        qaWindow={qaWindow}
      />
    </MetricsScopeShell>
  );
}
