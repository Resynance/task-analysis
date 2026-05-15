import { MetricsPromptsDashboard } from "@/components/metrics-prompts-dashboard";
import { MetricsScopeShell } from "@/components/metrics-scope-shell";
import { buildMetricsArtifacts } from "@/lib/metrics-artifacts";
import { loadMetricsScope } from "@/lib/metrics-scope";
import { resolveQaRejectionWindow } from "@/lib/qa-rejection-window";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Metrics · Prompts",
};

export default async function MetricsPromptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  resolveQaRejectionWindow(sp, "/metrics/prompts");
  const ctx = await loadMetricsScope(sp, "/metrics/prompts");
  const { snapshot } = buildMetricsArtifacts({
    scopeLabel: ctx.scopeLabel,
    scopedPrompts: ctx.scopedPrompts,
    scopedFeedback: ctx.scopedFeedback,
  });

  return (
    <MetricsScopeShell
      scopeLabel={ctx.scopeLabel}
      projectFilter={ctx.projectFilter}
      projectFilterOptions={ctx.projectFilterOptions}
      envFilter={ctx.envFilter}
      envFilterOptions={ctx.envFilterOptions}
    >
      <MetricsPromptsDashboard prompts={snapshot.prompts} />
    </MetricsScopeShell>
  );
}
