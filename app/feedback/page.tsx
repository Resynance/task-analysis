import { FeedbackDashboard, type FeedbackRow } from "@/components/feedback-dashboard";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { prisma } from "@/lib/prisma";
import {
  buildEnvFilterOptionsFromRows,
  envFilterInList,
  envMatchesFilter,
  parseEnvFilter,
} from "@/lib/task-environment";
import {
  buildProjectFilterOptionsFromRows,
  parseProjectFilter,
  projectFilterInList,
  type ProjectFilter,
} from "@/lib/task-project";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const bodySearchQuery =
    typeof sp.q === "string"
      ? sp.q.trim()
      : Array.isArray(sp.q) && typeof sp.q[0] === "string"
        ? sp.q[0].trim()
        : "";

  const [guidelineRows, rows] = await Promise.all([
    prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const metaRows = rows.map((r) => ({
    projectKey: r.projectKey,
    envKey: r.envKey,
  }));

  const projectFilterOptions = buildProjectFilterOptionsFromRows(metaRows);
  const requestedProject = parseProjectFilter(sp);
  if (
    requestedProject !== "all" &&
    !projectFilterInList(projectFilterOptions, requestedProject)
  ) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "project") continue;
      if (typeof v === "string") p.set(k, v);
      else if (Array.isArray(v)) {
        for (const s of v) if (typeof s === "string") p.append(k, s);
      }
    }
    const qs = p.toString();
    redirect(qs ? `/feedback?${qs}` : "/feedback");
  }
  const projectFilter: ProjectFilter = requestedProject;

  const envFilterOptions = buildEnvFilterOptionsFromRows(metaRows, projectFilter);
  const envFilter = parseEnvFilter(sp);
  if (envFilter !== "all" && !envFilterInList(envFilterOptions, envFilter)) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "env") continue;
      if (typeof v === "string") p.set(k, v);
      else if (Array.isArray(v)) {
        for (const s of v) if (typeof s === "string") p.append(k, s);
      }
    }
    const qs = p.toString();
    redirect(qs ? `/feedback?${qs}` : "/feedback");
  }

  const guidelines = filterGuidelinesForUi(guidelineRows);
  const guidelineParam = typeof sp.guideline === "string" ? sp.guideline : "";
  const selectedGuidelineId =
    guidelines.find((g) => g.id === guidelineParam)?.id ?? guidelines[0]?.id ?? null;

  let scoped = filterRowsByProject(rows, projectFilter);
  scoped = scoped.filter((r) => envMatchesFilter(r.envKey, envFilter));
  scoped = scoped.filter((r) =>
    bodySearchQuery.trim()
      ? r.body.toLowerCase().includes(bodySearchQuery.toLowerCase())
      : true,
  );

  const feedbackRows: FeedbackRow[] = scoped.map((r) => ({
    id: r.id,
    body: r.body,
    score: r.score,
    rationale: r.rationale,
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    sourceFeedbackId: r.sourceFeedbackId,
    taskKey: r.taskKey,
    projectKey: r.projectKey,
    envKey: r.envKey,
    createdById: r.createdById,
    createdByName: r.createdByName,
    createdByEmail: r.createdByEmail,
  }));

  return (
    <FeedbackDashboard
      rows={feedbackRows}
      guidelines={guidelines}
      projectFilter={projectFilter}
      projectFilterOptions={projectFilterOptions}
      envFilter={envFilter}
      envFilterOptions={envFilterOptions}
      bodySearchQuery={bodySearchQuery}
      selectedGuidelineId={selectedGuidelineId}
    />
  );
}
