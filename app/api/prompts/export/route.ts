import { getDatasetImportedTasksGuidelineId } from "@/lib/guideline-scope";
import { prisma } from "@/lib/prisma";
import { promptsToCsv } from "@/lib/csv-export";
import { parseGuidelineIdsParam } from "@/lib/guideline-query";
import { envMatchesFilter, parseEnvFilter, resolveCanonicalEnvId } from "@/lib/task-environment";
import {
  lifecycleMatchesFilter,
  parseTaskLifecycleFilter,
  TASK_LIFECYCLE_ALL,
} from "@/lib/task-lifecycle-filter";
import {
  parseProjectFilter,
  projectMatchesFilter,
  serializeProjectQueryValue,
} from "@/lib/task-project";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scoredOnly = searchParams.get("scoredOnly") !== "false";
  const sp = Object.fromEntries(searchParams.entries());
  const projectFilter = parseProjectFilter(sp);
  const envFilter = parseEnvFilter(sp);
  const taskLifecycleFilter = parseTaskLifecycleFilter(sp);

  const guidelineRows = await prisma.guideline.findMany({
    select: { id: true },
  });
  const validGuidelineIds = new Set(guidelineRows.map((g) => g.id));
  const guidelineFilterIds = parseGuidelineIdsParam(sp, validGuidelineIds);

  let rows = await prisma.prompt.findMany({
    where: scoredOnly ? { score: { not: null } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { guideline: { select: { name: true } } },
  });

  rows = rows.filter((r) => projectMatchesFilter(r, projectFilter));
  rows = rows.filter((r) => envMatchesFilter(r.envKey, envFilter));
  if (taskLifecycleFilter !== TASK_LIFECYCLE_ALL) {
    rows = rows.filter((r) =>
      lifecycleMatchesFilter(r.extra, taskLifecycleFilter),
    );
  }
  if (guidelineFilterIds.length > 0) {
    const datasetId = await getDatasetImportedTasksGuidelineId(prisma);
    rows = rows.filter(
      (r) =>
        guidelineFilterIds.includes(r.guidelineId) ||
        (datasetId != null && r.guidelineId === datasetId),
    );
  }

  const csv = promptsToCsv(
    rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      sourceKey: r.sourceKey,
      projectKey: r.projectKey,
      guidelineName: r.guideline.name,
      score: r.score,
      rationale: r.rationale,
      body: r.body,
      envKey: r.envKey,
      canonicalEnv: resolveCanonicalEnvId(r.envKey) ?? "unmapped",
      taskModality: r.taskModality,
      analyzedAt: r.analyzedAt,
      createdAt: r.createdAt,
    })),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  const projectSuffix =
    projectFilter === "all" ? "" : `-${serializeProjectQueryValue(projectFilter)}`;
  const envSuffix =
    envFilter === "all" ? "" : `-${envFilter}`;
  const filename = scoredOnly
    ? `task-analysis-scored${projectSuffix}${envSuffix}-${stamp}.csv`
    : `task-analysis-all${projectSuffix}${envSuffix}-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
