import type { PromptRow } from "@/components/prompt-dashboard";
import { rowMatchesUserSearch } from "@/lib/explore/filter-by-user";
import { filterRowsByEnv } from "@/lib/filter-prompts-by-env";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import { matchesRubricFilter } from "@/lib/guideline-scope";
import type { PrismaClient } from "@/generated/prisma/client";
import { prismaPromptToPromptRow } from "@/lib/prompt-row-serialize";
import {
  sortPromptMetaRows,
  type SortKey,
  type SortOrder,
} from "@/lib/sort-prompts";
import {
  buildEnvFilterOptionsFromRows,
  type EnvFilter,
} from "@/lib/task-environment";
import type { ProjectFilter } from "@/lib/task-project";
import { buildProjectFilterOptionsFromRows } from "@/lib/task-project";
import {
  buildTaskLifecycleFilterOptions,
  lifecycleMatchesFilter,
  type TaskLifecycleFilter,
  type TaskLifecycleOption,
} from "@/lib/task-lifecycle-filter";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

/** Library row without prompt body — keeps homepage RAM low for large datasets. */
export type PromptLibraryMetaRow = {
  id: string;
  projectKey: string;
  envKey: string | null;
  guidelineId: string;
  extra: unknown;
  createdAt: Date;
  analyzedAt: Date | null;
  score: PromptRow["score"];
  rationale: string | null;
  sourceKey: string | null;
  sourceId: string | null;
  taskModality: string | null;
  sourceCreated: Date | null;
};

const BODY_SEARCH_CHUNK = 280;

/** Rows matching project / environment / rubric toolbar filters — before lifecycle, author, or body search. */
export function scopePromptLibraryMetaForToolbar(
  meta: PromptLibraryMetaRow[],
  projectFilter: ProjectFilter,
  envFilter: EnvFilter,
  guidelineFilterIds: string[],
  datasetImportedGuidelineId: string | null,
): PromptLibraryMetaRow[] {
  let scoped = filterRowsByProject(meta, projectFilter);
  scoped = filterRowsByEnv(scoped, envFilter);
  if (guidelineFilterIds.length > 0) {
    scoped = scoped.filter((p) =>
      matchesRubricFilter(
        p.guidelineId,
        guidelineFilterIds,
        datasetImportedGuidelineId,
      ),
    );
  }
  return scoped;
}

export async function fetchPromptLibraryMeta(
  prisma: PrismaClient,
): Promise<PromptLibraryMetaRow[]> {
  return prisma.prompt.findMany({
    select: {
      id: true,
      projectKey: true,
      envKey: true,
      guidelineId: true,
      extra: true,
      createdAt: true,
      analyzedAt: true,
      score: true,
      rationale: true,
      sourceKey: true,
      sourceId: true,
      taskModality: true,
      sourceCreated: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function narrowMetaByPromptBodySearch(
  prisma: PrismaClient,
  meta: PromptLibraryMetaRow[],
  query: string,
): Promise<PromptLibraryMetaRow[]> {
  const q = query.trim();
  if (!q) return meta;
  const ql = q.toLowerCase();
  const ids = meta.map((m) => m.id);
  const matched = new Set<string>();
  for (let i = 0; i < ids.length; i += BODY_SEARCH_CHUNK) {
    const chunk = ids.slice(i, i + BODY_SEARCH_CHUNK);
    const rows = await prisma.prompt.findMany({
      where: { id: { in: chunk } },
      select: { id: true, body: true },
    });
    for (const r of rows) {
      if (r.body.toLowerCase().includes(ql)) matched.add(r.id);
    }
  }
  return meta.filter((m) => matched.has(m.id));
}

export async function buildPromptLibraryPage(options: {
  prisma: PrismaClient;
  meta: PromptLibraryMetaRow[];
  projectFilter: ProjectFilter;
  envFilter: EnvFilter;
  guidelineFilterIds: string[];
  datasetImportedGuidelineId: string | null;
  taskLifecycleFilter: TaskLifecycleFilter;
  /** Filter by resolved author name or raw user id (see {@link rowMatchesUserSearch}). */
  authorSearchQuery: string;
  promptSearchQuery: string;
  sort: SortKey;
  order: SortOrder;
  page: number;
  perPage: number;
  /** Optional id → display name from `users/users.json`. */
  nameByUserId?: Map<string, string>;
}): Promise<{
  prompts: PromptRow[];
  projectFilterOptions: ProjectFilter[];
  envFilterOptions: EnvFilter[];
  totalFiltered: number;
  page: number;
  perPage: number;
  totalPages: number;
  scoredInScope: number;
  pendingInScope: number;
  lifecycleFilterOptions: TaskLifecycleOption[];
}> {
  const {
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
    page,
    perPage,
    nameByUserId,
  } = options;

  const projectFilterOptions = buildProjectFilterOptionsFromRows(meta);
  const envFilterOptions = buildEnvFilterOptionsFromRows(meta, projectFilter);

  const scopedToolbar = scopePromptLibraryMetaForToolbar(
    meta,
    projectFilter,
    envFilter,
    guidelineFilterIds,
    datasetImportedGuidelineId,
  );
  const lifecycleFilterOptions =
    buildTaskLifecycleFilterOptions(scopedToolbar);

  let filtered = scopedToolbar.filter((p) =>
    lifecycleMatchesFilter(p.extra, taskLifecycleFilter),
  );
  if (authorSearchQuery.trim()) {
    filtered = filtered.filter((p) =>
      rowMatchesUserSearch(p.extra, authorSearchQuery, nameByUserId),
    );
  }
  if (promptSearchQuery.trim()) {
    filtered = await narrowMetaByPromptBodySearch(
      prisma,
      filtered,
      promptSearchQuery,
    );
  }

  const scoredInScope = filtered.filter((p) => p.score != null).length;
  const pendingInScope = filtered.filter(
    (p) =>
      p.score == null && taskLifecycleEligibleForLlmAnalysis(p.extra),
  ).length;

  const sortedMeta = sortPromptMetaRows(
    filtered.map((m) => ({
      id: m.id,
      score: m.score ?? null,
      createdAt: m.createdAt,
    })),
    sort,
    order,
  );

  const totalFiltered = sortedMeta.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / perPage));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const start = (pageClamped - 1) * perPage;
  const pageIds = sortedMeta.slice(start, start + perPage).map((m) => m.id);

  const fullRows =
    pageIds.length === 0
      ? []
      : await prisma.prompt.findMany({
          where: { id: { in: pageIds } },
          include: { guideline: { select: { id: true, name: true } } },
        });

  const orderIndex = new Map(pageIds.map((id, idx) => [id, idx] as const));
  fullRows.sort(
    (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
  );

  const prompts = fullRows.map((row) =>
    prismaPromptToPromptRow(row, nameByUserId),
  );

  return {
    prompts,
    projectFilterOptions,
    envFilterOptions,
    totalFiltered,
    page: pageClamped,
    perPage,
    totalPages,
    scoredInScope,
    pendingInScope,
    lifecycleFilterOptions,
  };
}
