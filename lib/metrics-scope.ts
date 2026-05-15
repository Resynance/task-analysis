import type { PromptScore } from "@/generated/prisma/enums";
import { filterRowsByEnv } from "@/lib/filter-prompts-by-env";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import { prisma } from "@/lib/prisma";
import {
  buildEnvFilterOptionsFromRows,
  envFilterInList,
  getEnvFilterShortLabel,
  parseEnvFilter,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  buildProjectFilterOptionsFromRows,
  getProjectFilterShortLabel,
  parseProjectFilter,
  projectFilterInList,
  type ProjectFilter,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export type PromptRowForMetrics = {
  sourceId: string | null;
  sourceKey: string | null;
  score: PromptScore | null;
  extra: unknown;
  analyzedAt: Date | null;
  createdAt: Date;
  projectKey: string;
  envKey: string | null;
};

export type FeedbackRowForMetrics = {
  body: string;
  taskId: string | null;
  taskKey: string | null;
  sourceFeedbackId: string;
  score: PromptScore | null;
  analyzedAt: Date | null;
  createdAt: Date;
  sourceCreated: Date | null;
  projectKey: string;
  envKey: string | null;
  extra: unknown;
  createdById: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

/** Serialize current filters for `<Link href={...}>` preservation across metric subpages. */
export function metricsQuerySuffix(
  sp: Record<string, string | string[] | undefined>,
): string {
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === "string") p.set(key, val);
    else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") p.append(key, v);
      }
    }
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function redirectPreservingParams(
  basePath: string,
  sp: Record<string, string | string[] | undefined>,
  omitKeys: string[],
): never {
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (omitKeys.includes(key)) continue;
    if (typeof val === "string") p.set(key, val);
    else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") p.append(key, v);
      }
    }
  }
  const qs = p.toString();
  redirect(qs ? `${basePath}?${qs}` : basePath);
}

/**
 * Loads prompt + feedback rows, validates `?project=` / `?env=`, and returns scoped datasets.
 * Invalid filters redirect within `metricsPath` (e.g. `/metrics/prompts`).
 */
export async function loadMetricsScope(
  sp: Record<string, string | string[] | undefined>,
  metricsPath: string,
): Promise<{
  projectFilter: ProjectFilter;
  envFilter: EnvFilter;
  projectFilterOptions: ProjectFilter[];
  envFilterOptions: EnvFilter[];
  scopeLabel: string;
  promptRows: PromptRowForMetrics[];
  feedbackRows: FeedbackRowForMetrics[];
  scopedPrompts: PromptRowForMetrics[];
  scopedFeedback: FeedbackRowForMetrics[];
}> {
  const [promptRowsRaw, feedbackRowsRaw] = await Promise.all([
    prisma.prompt.findMany({
      select: {
        sourceId: true,
        sourceKey: true,
        score: true,
        extra: true,
        analyzedAt: true,
        createdAt: true,
        projectKey: true,
        envKey: true,
      },
    }),
    prisma.feedback.findMany({
      select: {
        body: true,
        taskId: true,
        taskKey: true,
        sourceFeedbackId: true,
        score: true,
        analyzedAt: true,
        createdAt: true,
        sourceCreated: true,
        projectKey: true,
        envKey: true,
        extra: true,
        createdById: true,
        createdByName: true,
        createdByEmail: true,
      },
    }),
  ]);

  const promptRows: PromptRowForMetrics[] = promptRowsRaw;
  const feedbackRows: FeedbackRowForMetrics[] = feedbackRowsRaw;

  const optionRows = [
    ...promptRows.map((r) => ({
      projectKey: r.projectKey,
      envKey: r.envKey,
    })),
    ...feedbackRows.map((r) => ({
      projectKey: r.projectKey,
      envKey: r.envKey,
    })),
  ];

  const requestedProject = parseProjectFilter(sp);
  const projectFilterOptions = buildProjectFilterOptionsFromRows(optionRows);
  if (
    requestedProject !== "all" &&
    !projectFilterInList(projectFilterOptions, requestedProject)
  ) {
    redirectPreservingParams(metricsPath, sp, ["project"]);
  }
  const projectFilter: ProjectFilter = requestedProject;

  const requestedEnv = parseEnvFilter(sp);
  const envFilterOptions = buildEnvFilterOptionsFromRows(
    optionRows,
    projectFilter,
  );
  if (
    requestedEnv !== "all" &&
    !envFilterInList(envFilterOptions, requestedEnv)
  ) {
    redirectPreservingParams(metricsPath, sp, ["env"]);
  }
  const envFilter: EnvFilter = requestedEnv;

  const scopedPrompts = filterRowsByEnv(
    filterRowsByProject(promptRows, projectFilter),
    envFilter,
  );
  const scopedFeedback = filterRowsByEnv(
    filterRowsByProject(feedbackRows, projectFilter),
    envFilter,
  );

  const scopeLabel = `${getProjectFilterShortLabel(projectFilter)} · ${getEnvFilterShortLabel(envFilter)}`;

  return {
    projectFilter,
    envFilter,
    projectFilterOptions,
    envFilterOptions,
    scopeLabel,
    promptRows,
    feedbackRows,
    scopedPrompts,
    scopedFeedback,
  };
}
