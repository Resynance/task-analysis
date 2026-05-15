import { InsightsPanel } from "@/components/insights-panel";
import { ReportsSubnav } from "@/components/reports-subnav";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import { safeParseStoredCoachingInsightReport } from "@/lib/coaching-insight-report";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import { computeEnvInsightsStaleFlags } from "@/lib/insights-stale";
import { prisma } from "@/lib/prisma";
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
  type ProjectFilter,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsInsightsPage({
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
  const requestedProject = parseProjectFilter(sp);
  if (
    requestedProject !== "all" &&
    !projectFilterInList(projectFilterOptions, requestedProject)
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
    redirect(qs ? `/reports/insights?${qs}` : "/reports/insights");
  }
  let projectFilter: ProjectFilter = requestedProject;

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
      redirect(qs ? `/reports/insights?${qs}` : "/reports/insights");
    }
  }

  const validGuidelineIds = new Set(guidelines.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validGuidelineIds);
  const projectKeyDb = projectFilterToDbKey(projectFilter);
  const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineFilterIds);

  let envFilterOptions = buildEnvFilterOptionsFromRows(
    scopeRows,
    projectFilter,
  );

  /** Saved rows can outlive current prompt `env_key` values — still list them so reports stay openable. */
  let insightSavedEnvKeyRows: { envKey: string }[] = [];
  if (projectFilter !== "all") {
    insightSavedEnvKeyRows = await prisma.coachingInsight.findMany({
      where: { projectKey: projectKeyDb, guidelineScopeKey },
      select: { envKey: true },
    });
    for (const ek of new Set(insightSavedEnvKeyRows.map((r) => r.envKey))) {
      const f = parseEnvFilter({ env: ek });
      if (f !== "all" && !envFilterInList(envFilterOptions, f)) {
        envFilterOptions = [...envFilterOptions, f];
      }
    }
  }

  const requestedEnv = parseEnvFilter(sp);
  if (requestedEnv !== "all" && !envFilterInList(envFilterOptions, requestedEnv)) {
    const p = new URLSearchParams();
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
    redirect(qs ? `/reports/insights?${qs}` : "/reports/insights");
  }
  const envFilter: EnvFilter = requestedEnv;

  const envKey = serializeEnvQueryValue(envFilter);

  const savedRow =
    projectFilter !== "all" && envFilter !== "all"
      ? await prisma.coachingInsight.findUnique({
          where: {
            projectKey_envKey_guidelineScopeKey: {
              projectKey: projectKeyDb,
              envKey,
              guidelineScopeKey,
            },
          },
        })
      : null;

  const insightSavedEnvKeys = [...new Set(insightSavedEnvKeyRows.map((r) => r.envKey))];

  const initialReport = savedRow
    ? safeParseStoredCoachingInsightReport(savedRow.reportJson)
    : null;
  const initialSummary = savedRow?.summary ?? null;
  const savedAtIso = savedRow?.updatedAt.toISOString() ?? null;

  const projectOptionsNoAll = projectFilterOptions.filter((p) => p !== "all");
  const envOptionsNoAll = envFilterOptions.filter((e) => e !== "all");
  const envStaleBySerializedKey =
    projectFilter !== "all" && envOptionsNoAll.length > 0
      ? await computeEnvInsightsStaleFlags(
          prisma,
          projectKeyDb,
          envOptionsNoAll,
          guidelineFilterIds,
        )
      : {};

  return (
    <>
      <ReportsSubnav active="insights" />
      <InsightsPanel
        projectFilter={projectFilter}
        projectFilterOptions={projectOptionsNoAll}
        envFilter={envFilter}
        envFilterOptions={envFilterOptions}
        envStaleBySerializedKey={envStaleBySerializedKey}
        guidelines={filterGuidelinesForUi(guidelines)}
        guidelineFilterIds={guidelineFilterIds}
        insightSavedEnvKeys={insightSavedEnvKeys}
        initialReport={initialReport}
        initialSummary={initialSummary}
        savedAtIso={savedAtIso}
        noEnvironmentAvailable={
          projectOptionsNoAll.length === 0 || envOptionsNoAll.length === 0
        }
      />
    </>
  );
}
