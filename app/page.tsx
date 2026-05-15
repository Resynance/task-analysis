import { PromptDashboard } from "@/components/prompt-dashboard";
import { parseAuthorSearchQuery } from "@/lib/explore/filter-by-user";
import { parsePromptBodySearchQuery } from "@/lib/prompt-body-search";
import {
  filterGuidelinesForUi,
  findDatasetImportedTasksGuidelineId,
} from "@/lib/guideline-scope";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import {
  buildPromptLibraryPage,
  fetchPromptLibraryMeta,
  scopePromptLibraryMetaForToolbar,
} from "@/lib/prompt-library-page";
import { loadUserDisplayNames } from "@/lib/users-lookup";
import { parseLibraryPaginationParams } from "@/lib/library-pagination";
import { prisma } from "@/lib/prisma";
import { parseSortParams } from "@/lib/sort-prompts";
import {
  buildEnvFilterOptionsFromRows,
  envFilterInList,
  parseEnvFilter,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  collectAllowedLifecycleValues,
  lifecycleFilterIsValid,
  parseTaskLifecycleFilter,
  TASK_LIFECYCLE_ALL,
  type TaskLifecycleFilter,
} from "@/lib/task-lifecycle-filter";
import {
  buildProjectFilterOptionsFromRows,
  parseProjectFilter,
  projectFilterInList,
  type ProjectFilter,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { sort, order } = parseSortParams(sp);
  const authorSearchQuery = parseAuthorSearchQuery(sp);
  const promptSearchQuery = parsePromptBodySearchQuery(sp);
  const groupByUser = typeof sp.groupBy === "string" && sp.groupBy === "user";
  const { page: libraryPage, perPage: libraryPerPage } =
    parseLibraryPaginationParams(sp);

  const [guidelines, meta] = await Promise.all([
    prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    fetchPromptLibraryMeta(prisma),
  ]);

  const validGuidelineIds = new Set(guidelines.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validGuidelineIds);

  const requestedProject = parseProjectFilter(sp);
  const projectFilterOptions = buildProjectFilterOptionsFromRows(meta);
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
    redirect(qs ? `/?${qs}` : "/");
  }
  const projectFilter: ProjectFilter = requestedProject;

  const requestedEnv = parseEnvFilter(sp);
  const envFilterOptions = buildEnvFilterOptionsFromRows(meta, projectFilter);
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
    redirect(qs ? `/?${qs}` : "/");
  }
  const envFilter: EnvFilter = requestedEnv;

  const datasetImportedGuidelineId =
    findDatasetImportedTasksGuidelineId(guidelines);

  const scopedForLifecycleToolbar = scopePromptLibraryMetaForToolbar(
    meta,
    projectFilter,
    envFilter,
    guidelineFilterIds,
    datasetImportedGuidelineId,
  );
  const allowedLifecycleFilters =
    collectAllowedLifecycleValues(scopedForLifecycleToolbar);

  const hasExplicitTaskStatus =
    typeof sp.taskStatus === "string" && sp.taskStatus.trim() !== "";

  let taskLifecycleFilter: TaskLifecycleFilter = parseTaskLifecycleFilter(sp);

  if (!hasExplicitTaskStatus) {
    taskLifecycleFilter = lifecycleFilterIsValid(
      "production",
      allowedLifecycleFilters,
    )
      ? "production"
      : TASK_LIFECYCLE_ALL;
  }

  if (!lifecycleFilterIsValid(taskLifecycleFilter, allowedLifecycleFilters)) {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) {
      if (key === "taskStatus") continue;
      if (typeof val === "string") p.set(key, val);
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") p.append(key, v);
        }
      }
    }
    const qs = p.toString();
    redirect(qs ? `/?${qs}` : "/");
  }
  const guidelinesForUi = filterGuidelinesForUi(guidelines);

  const nameByUserId = loadUserDisplayNames();

  const library = await buildPromptLibraryPage({
    prisma,
    meta,
    projectFilter,
    envFilter,
    guidelineFilterIds,
    datasetImportedGuidelineId,
    taskLifecycleFilter,
    authorSearchQuery,
    promptSearchQuery,
    sort,
    order,
    page: libraryPage,
    perPage: libraryPerPage,
    nameByUserId,
  });

  return (
    <PromptDashboard
      prompts={library.prompts}
      guidelines={guidelinesForUi}
      sort={sort}
      order={order}
      projectFilter={projectFilter}
      projectFilterOptions={library.projectFilterOptions}
      envFilter={envFilter}
      envFilterOptions={library.envFilterOptions}
      guidelineFilterIds={guidelineFilterIds}
      groupByUser={groupByUser}
      authorSearchQuery={authorSearchQuery}
      promptSearchQuery={promptSearchQuery}
      libraryPage={library.page}
      libraryPerPage={library.perPage}
      libraryTotalFiltered={library.totalFiltered}
      libraryTotalPages={library.totalPages}
      scoredInScope={library.scoredInScope}
      pendingInScope={library.pendingInScope}
      taskLifecycleFilter={taskLifecycleFilter}
      lifecycleFilterOptions={library.lifecycleFilterOptions}
    />
  );
}
