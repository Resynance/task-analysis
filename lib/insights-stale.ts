import type { PrismaClient } from "@/generated/prisma/client";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import {
  getDatasetImportedTasksGuidelineId,
  matchesRubricFilter,
} from "@/lib/guideline-scope";
import { isInsightsEligibleScore } from "@/lib/prompt-score-insights";
import {
  envMatchesFilter,
  serializeEnvQueryValue,
  type EnvFilter,
} from "@/lib/task-environment";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

/**
 * For each environment option, whether scored prompts in the current rubric scope
 * were analyzed (or created if never analyzed) after the saved coaching report for
 * that env + scope — or whether there is scored data but no report yet.
 */
export async function computeEnvInsightsStaleFlags(
  prisma: PrismaClient,
  /** Matches `CoachingInsight.projectKey` / `Prompt.projectKey` for this report scope. */
  projectKeyDb: string,
  envOptionsNoAll: EnvFilter[],
  guidelineFilterIds: string[],
): Promise<Record<string, boolean>> {
  const guidelineScopeKey =
    coachingInsightGuidelineScopeKey(guidelineFilterIds);
  const datasetImportedGuidelineId =
    await getDatasetImportedTasksGuidelineId(prisma);

  const [insights, prompts] = await Promise.all([
    prisma.coachingInsight.findMany({
      where: { guidelineScopeKey, projectKey: projectKeyDb },
      select: { envKey: true, updatedAt: true },
    }),
    prisma.prompt.findMany({
      where: { score: { not: null }, projectKey: projectKeyDb },
      select: {
        envKey: true,
        guidelineId: true,
        analyzedAt: true,
        createdAt: true,
        score: true,
        extra: true,
      },
    }),
  ]);

  const reportUpdatedAt = new Map(
    insights.map((r) => [r.envKey, r.updatedAt] as const),
  );

  const out: Record<string, boolean> = {};

  for (const opt of envOptionsNoAll) {
    const serialized = serializeEnvQueryValue(opt);
    let latestPromptActivity: Date | null = null;

    for (const p of prompts) {
      if (!isInsightsEligibleScore(p.score)) continue;
      if (!taskLifecycleEligibleForLlmAnalysis(p.extra)) continue;
      if (!envMatchesFilter(p.envKey, opt)) continue;
      if (
        !matchesRubricFilter(
          p.guidelineId,
          guidelineFilterIds,
          datasetImportedGuidelineId,
        )
      ) {
        continue;
      }
      const t = p.analyzedAt ?? p.createdAt;
      if (!latestPromptActivity || t > latestPromptActivity) {
        latestPromptActivity = t;
      }
    }

    if (!latestPromptActivity) {
      out[serialized] = false;
      continue;
    }

    const savedAt = reportUpdatedAt.get(serialized);
    if (!savedAt) {
      out[serialized] = true;
      continue;
    }

    out[serialized] = latestPromptActivity > savedAt;
  }

  return out;
}
