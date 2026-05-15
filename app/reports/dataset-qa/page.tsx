import { DatasetQaPanel } from "@/components/dataset-qa-panel";
import { ReportsSubnav } from "@/components/reports-subnav";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import { prisma } from "@/lib/prisma";
import {
  buildEnvFilterOptionsFromRows,
  envFilterInList,
  parseEnvFilter,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  buildProjectFilterOptionsFromRows,
  parseProjectFilter,
  projectFilterInList,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsDatasetQaPage({
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
    redirect(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa");
  }
  const projectFilter: ProjectFilter = requestedProject;

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
      redirect(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa");
    }
  }

  const envFilterOptions = buildEnvFilterOptionsFromRows(
    scopeRows,
    projectFilter,
  );
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
    redirect(qs ? `/reports/dataset-qa?${qs}` : "/reports/dataset-qa");
  }
  const envFilter: EnvFilter = requestedEnv;

  const validGuidelineIds = new Set(guidelines.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validGuidelineIds);

  const projectOptionsNoAll = projectFilterOptions.filter((p) => p !== "all");
  const envOptionsNoAll = envFilterOptions.filter((e) => e !== "all");

  return (
    <>
      <ReportsSubnav active="dataset-qa" />
      <DatasetQaPanel
        projectFilter={projectFilter}
        projectFilterOptions={projectOptionsNoAll}
        envFilter={envFilter}
        envFilterOptions={envFilterOptions}
        guidelines={filterGuidelinesForUi(guidelines)}
        guidelineFilterIds={guidelineFilterIds}
        noEnvironmentAvailable={
          projectOptionsNoAll.length === 0 || envOptionsNoAll.length === 0
        }
      />
    </>
  );
}
