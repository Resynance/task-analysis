import { CombinedReportsPanel } from "@/components/combined-reports-panel";
import { ReportsSubnav } from "@/components/reports-subnav";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import { buildCombinedWriterReport } from "@/lib/combined-writer-report";
import { safeParseStoredCoachingInsightReport } from "@/lib/coaching-insight-report";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import { prisma } from "@/lib/prisma";
import { safeParseStoredPrunedTasksAnalysis } from "@/lib/pruned-analysis";
import {
  buildEnvFilterOptionsFromRows,
  envFilterInList,
  parseEnvFilter,
  serializeEnvQueryValue,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  buildProjectFilterOptionsFromRows,
  parseProjectFilter,
  projectFilterInList,
  projectFilterToDbKey,
  serializeProjectQueryValue,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CombinedReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const [guidelines, scopeRows] = await Promise.all([
    prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.prompt.findMany({ select: { envKey: true, projectKey: true } }),
  ]);

  const projectFilterOptions = buildProjectFilterOptionsFromRows(scopeRows);
  const projectFilter = parseProjectFilter(sp);
  if (
    projectFilter !== "all" &&
    !projectFilterInList(projectFilterOptions, projectFilter)
  ) {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) {
      if (key === "project") continue;
      if (typeof val === "string") p.set(key, val);
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") p.append(key, v);
        }
      }
    }
    const qs = p.toString();
    redirect(qs ? `/reports/combined?${qs}` : "/reports/combined");
  }

  if (projectFilter === "all") {
    const firstConcrete = projectFilterOptions.find((e) => e !== "all");
    if (firstConcrete) {
      const p = new URLSearchParams();
      p.set("project", serializeProjectQueryValue(firstConcrete));
      for (const [key, val] of Object.entries(sp)) {
        if (key === "project") continue;
        if (typeof val === "string") p.set(key, val);
        else if (Array.isArray(val)) {
          for (const v of val) {
            if (typeof v === "string") p.append(key, v);
          }
        }
      }
      const qs = p.toString();
      redirect(qs ? `/reports/combined?${qs}` : "/reports/combined");
    }
  }

  const envFilterOptionsFull = buildEnvFilterOptionsFromRows(
    scopeRows,
    projectFilter,
  );
  const envFilterOptions = envFilterOptionsFull.filter(
    (e) => e !== "all" && e !== "unmapped",
  );

  if (envFilterOptions.length === 0) {
    return (
      <>
        <ReportsSubnav active="combined" />
        <CombinedReportsPanel
          projectFilter="all"
          projectFilterOptions={[]}
          envFilter="all"
          envFilterOptions={[]}
          guidelines={filterGuidelinesForUi(guidelines)}
          guidelineFilterIds={[]}
          initialReport={null}
          initialSummary={null}
          initialSavedAtIso={null}
          initialInsightsSavedAtIso={null}
          initialPrunedSavedAtIso={null}
          noEnvironmentAvailable
        />
      </>
    );
  }

  const requestedEnv = parseEnvFilter(sp);
  if (
    requestedEnv === "all" ||
    requestedEnv === "unmapped" ||
    !envFilterInList(envFilterOptions, requestedEnv)
  ) {
    const firstConcrete = envFilterOptions[0];
    const p = new URLSearchParams();
    if (firstConcrete) p.set("env", serializeEnvQueryValue(firstConcrete));
    for (const [key, val] of Object.entries(sp)) {
      if (key === "env") continue;
      if (typeof val === "string") p.set(key, val);
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") p.append(key, v);
        }
      }
    }
    const qs = p.toString();
    redirect(qs ? `/reports/combined?${qs}` : "/reports/combined");
  }
  const envFilter: EnvFilter = requestedEnv;

  const validGuidelineIds = new Set(guidelines.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validGuidelineIds);
  const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineFilterIds);
  const projectKeyDb = projectFilterToDbKey(projectFilter);
  const envKey = serializeEnvQueryValue(envFilter);

  const [insightsRow, prunedRow] = await Promise.all([
    prisma.coachingInsight.findUnique({
      where: {
        projectKey_envKey_guidelineScopeKey: {
          projectKey: projectKeyDb,
          envKey,
          guidelineScopeKey,
        },
      },
    }),
    (
      prisma as unknown as {
        prunedTaskAnalysis?: {
          findUnique(args: unknown): Promise<{
            reportJson: unknown;
            updatedAt: Date;
          } | null>;
        };
      }
    ).prunedTaskAnalysis?.findUnique({
      where: {
        projectKey_envKey_guidelineScopeKey: {
          projectKey: projectKeyDb,
          envKey,
          guidelineScopeKey,
        },
      },
    }) ?? Promise.resolve(null),
  ]);
  const parsedInsights = insightsRow
    ? safeParseStoredCoachingInsightReport(insightsRow.reportJson)
    : null;
  const parsedPruned = prunedRow
    ? safeParseStoredPrunedTasksAnalysis(prunedRow.reportJson)
    : null;
  const initialCombined =
    parsedInsights && parsedPruned
      ? buildCombinedWriterReport(parsedInsights, parsedPruned)
      : null;
  const initialSavedAtIso =
    insightsRow && prunedRow
      ? new Date(
          Math.max(insightsRow.updatedAt.getTime(), prunedRow.updatedAt.getTime()),
        ).toISOString()
      : null;

  const projectOptionsNoAll = projectFilterOptions.filter((p) => p !== "all");

  return (
    <>
      <ReportsSubnav active="combined" />
      <CombinedReportsPanel
        projectFilter={projectFilter}
        projectFilterOptions={projectOptionsNoAll}
        envFilter={envFilter}
        envFilterOptions={envFilterOptions}
        guidelines={filterGuidelinesForUi(guidelines)}
        guidelineFilterIds={guidelineFilterIds}
        initialReport={initialCombined}
        initialSummary={insightsRow?.summary ?? null}
        initialSavedAtIso={initialSavedAtIso}
        initialInsightsSavedAtIso={insightsRow?.updatedAt.toISOString() ?? null}
        initialPrunedSavedAtIso={prunedRow?.updatedAt.toISOString() ?? null}
        noEnvironmentAvailable={envFilterOptions.length === 0}
      />
    </>
  );
}
