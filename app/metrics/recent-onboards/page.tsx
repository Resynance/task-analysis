import { MetricsRecentOnboardsDashboard } from "@/components/metrics-recent-onboards-dashboard";
import { MetricsScopeShell } from "@/components/metrics-scope-shell";
import {
  loadRecentOnboardsMetrics,
  type RecentOnboardsSortDirection,
  type RecentOnboardsSortKey,
} from "@/lib/recent-onboards-metrics";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Metrics · Recent Onboards",
};

function parseSortKey(raw: string | string[] | undefined): RecentOnboardsSortKey {
  return raw === "user" || raw === "total" || raw === "7d" || raw === "30d"
    ? raw
    : "joined";
}

function parseSortDirection(
  raw: string | string[] | undefined,
): RecentOnboardsSortDirection {
  return raw === "asc" ? "asc" : "desc";
}

export default async function MetricsRecentOnboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const metrics = loadRecentOnboardsMetrics();
  const view = {
    searchQuery: typeof sp.search === "string" ? sp.search : "",
    sortKey: parseSortKey(sp.sort),
    sortDirection: parseSortDirection(sp.dir),
  };

  return (
    <MetricsScopeShell
      scopeLabel="Recent onboard export"
      projectFilter="all"
      projectFilterOptions={["all"]}
      envFilter="all"
      envFilterOptions={["all"]}
      hideScopeControls
    >
      <MetricsRecentOnboardsDashboard metrics={metrics} view={view} />
    </MetricsScopeShell>
  );
}
