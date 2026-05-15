import {
  analyzeRecentOnboards,
  collectRecentOnboardEnvironmentOptions,
  collectRecentOnboardProjectOptions,
  prepareRecentOnboardsList,
  recentOnboardSummariesToCsv,
  RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS,
  type RecentOnboardsEnvironmentFilterMode,
  type RecentOnboardsProjectFilterMode,
  type RecentOnboardsSortMode,
  type RecentOnboardsVisibilityMode,
} from "@/lib/recent-onboards-analysis";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseSortMode(raw: string | null): RecentOnboardsSortMode {
  return raw === "records_first" ? "records_first" : "csv";
}

function parseVisibilityMode(raw: string | null): RecentOnboardsVisibilityMode {
  return raw === "with_tasks" ? "with_tasks" : "all";
}

function parseTaskFilterMode(
  raw: string | null,
): RecentOnboardsProjectFilterMode | RecentOnboardsEnvironmentFilterMode {
  return raw === "include" || raw === "exclude" ? raw : "all";
}

function selectedValues(
  searchParams: URLSearchParams,
  key: string,
  allowedValues: Set<string>,
): string[] {
  return searchParams.getAll(key).filter((value) => allowedValues.has(value));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sortMode = parseSortMode(searchParams.get("sort"));
  const visibilityMode = parseVisibilityMode(searchParams.get("show"));
  const projectMode = parseTaskFilterMode(searchParams.get("projectMode"));
  const environmentMode = parseTaskFilterMode(searchParams.get("envMode"));
  const requireMinFeedback = searchParams
    .getAll("minFeedback")
    .includes(String(RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS));

  const analysis = await analyzeRecentOnboards(prisma);
  const projectOptions = collectRecentOnboardProjectOptions(analysis.summaries);
  const environmentOptions = collectRecentOnboardEnvironmentOptions(
    analysis.summaries,
  );
  const projectValues = selectedValues(
    searchParams,
    "project",
    new Set(projectOptions.map((opt) => opt.value)),
  );
  const environmentValues = selectedValues(
    searchParams,
    "env",
    new Set(environmentOptions.map((opt) => opt.value)),
  );

  const { sortedSummaries } = prepareRecentOnboardsList(
    analysis.summaries,
    {
      sortMode,
      visibilityMode,
      projectFilter: { mode: projectMode, values: new Set(projectValues) },
      environmentFilter: {
        mode: environmentMode,
        values: new Set(environmentValues),
      },
      requireMinFeedback,
    },
  );
  const csv = recentOnboardSummariesToCsv(sortedSummaries);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recent-onboards-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
