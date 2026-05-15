import { Prisma } from "@/generated/prisma/client";
import { getDatasetImportedTasksGuidelineId } from "@/lib/guideline-scope";
import { prisma } from "@/lib/prisma";
import { analyzePromptAgainstGuidelines } from "@/lib/analyze-prompt";
import { getUserStoryForPrompt } from "@/lib/scenarios/task-user-story";
import {
  assertLlmConfigured,
  resolveLlmConfig,
  type ResolvedLlmConfig,
} from "@/lib/llm-config";
import type { BatchStreamEvent } from "@/lib/batch-analyze-stream";
import {
  collectPrunedStemsFromPromptRows,
  loadPrunedKeySetsForEnvStems,
  PRUNED_SCORE_RATIONALE,
  promptMatchesPrunedSet,
} from "@/lib/pruned-task-keys";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import {
  envMatchesFilter,
  parseEnvFilter,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  lifecycleMatchesFilter,
  parseTaskLifecycleFilter,
  TASK_LIFECYCLE_ALL,
  type TaskLifecycleFilter,
} from "@/lib/task-lifecycle-filter";
import { parseProjectFilter, type ProjectFilter } from "@/lib/task-project";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_EXTRA_INSTRUCTIONS = 8000;

export async function POST(request: Request) {
  const signal = request.signal;

  let includeScored = false;
  let projectFilter: ProjectFilter = "all";
  let environment: EnvFilter = "all";
  let guidelineIdsBody: string[] = [];
  let taskLifecycleFilter: TaskLifecycleFilter = TASK_LIFECYCLE_ALL;
  let batchExtraInstructions: string | undefined;

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as {
        includeScored?: boolean;
        project?: string;
        environment?: string;
        guidelineIds?: unknown;
        taskStatus?: string;
        extraInstructions?: string;
      };
      includeScored = Boolean(body?.includeScored);
      const proj = body?.project;
      if (typeof proj === "string") {
        projectFilter = parseProjectFilter({ project: proj });
      }
      const e = body?.environment;
      if (typeof e === "string") {
        environment = parseEnvFilter({ env: e });
      }
      const g = body?.guidelineIds;
      if (Array.isArray(g)) {
        guidelineIdsBody = g.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        );
      }
      const tls = body?.taskStatus;
      if (typeof tls === "string" && tls.trim()) {
        taskLifecycleFilter = parseTaskLifecycleFilter({ taskStatus: tls });
      }
      const xi = body?.extraInstructions;
      if (typeof xi === "string" && xi.trim()) {
        batchExtraInstructions = xi.trim().slice(0, MAX_BATCH_EXTRA_INSTRUCTIONS);
      }
    }
  } catch {
    // Default batch options
  }

  let pending = await prisma.prompt.findMany({
    where: includeScored ? {} : { score: null },
    include: { guideline: true },
    orderBy: { createdAt: "asc" },
  });

  pending = filterRowsByProject(pending, projectFilter);
  pending = pending.filter((p) => envMatchesFilter(p.envKey, environment));
  if (taskLifecycleFilter !== TASK_LIFECYCLE_ALL) {
    pending = pending.filter((p) =>
      lifecycleMatchesFilter(p.extra, taskLifecycleFilter),
    );
  }
  pending = pending.filter((p) =>
    taskLifecycleEligibleForLlmAnalysis(p.extra),
  );

  if (guidelineIdsBody.length > 0) {
    const valid = await prisma.guideline.findMany({
      where: { id: { in: guidelineIdsBody } },
      select: { id: true },
    });
    const allowed = new Set(valid.map((r) => r.id));
    if (allowed.size === 0) {
      pending = [];
    } else {
      const datasetId = await getDatasetImportedTasksGuidelineId(prisma);
      pending = pending.filter(
        (p) =>
          allowed.has(p.guidelineId) ||
          (datasetId != null && p.guidelineId === datasetId),
      );
    }
  }

  const prunedByStem = await loadPrunedKeySetsForEnvStems(
    collectPrunedStemsFromPromptRows(pending),
  );
  const needsLlm = pending.some(
    (p) => !promptMatchesPrunedSet(p.envKey, p.sourceKey, prunedByStem),
  );

  let llmConfig: ResolvedLlmConfig | undefined;
  if (needsLlm) {
    try {
      llmConfig = await resolveLlmConfig(prisma);
      assertLlmConfigured(llmConfig);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "LLM not configured" },
        { status: 400 },
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (evt: BatchStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(evt)}\n`));
      };

      try {
        write({ type: "start", total: pending.length });

        let okCount = 0;
        let failCount = 0;

        for (let i = 0; i < pending.length; i++) {
          if (signal.aborted) {
            write({
              type: "cancelled",
              processedSoFar: i,
              okCount,
              failCount,
            });
            break;
          }

          const row = pending[i];
          try {
            if (promptMatchesPrunedSet(row.envKey, row.sourceKey, prunedByStem)) {
              await prisma.prompt.update({
                where: { id: row.id },
                data: {
                  score: "PRUNED",
                  rationale: PRUNED_SCORE_RATIONALE,
                  analyzedAt: new Date(),
                  analysisClarification: Prisma.DbNull,
                },
              });
              okCount += 1;
              write({
                type: "progress",
                index: i + 1,
                total: pending.length,
                id: row.id,
                ok: true,
                sourceKey: row.sourceKey ?? null,
              });
              continue;
            }

            if (!llmConfig) {
              throw new Error("LLM not configured");
            }

            const userStory = getUserStoryForPrompt(row.envKey, row.extra);

            const result = await analyzePromptAgainstGuidelines(
              {
                promptBody: row.body,
                guidelineContent: row.guideline.content,
                userStory,
                extraInstructions: batchExtraInstructions,
              },
              llmConfig,
            );
            await prisma.prompt.update({
              where: { id: row.id },
              data: {
                score: result.score,
                rationale: result.rationale,
                analyzedAt: new Date(),
                analysisClarification: Prisma.DbNull,
              },
            });
            okCount += 1;
            write({
              type: "progress",
              index: i + 1,
              total: pending.length,
              id: row.id,
              ok: true,
              sourceKey: row.sourceKey ?? null,
            });
          } catch (err) {
            failCount += 1;
            write({
              type: "progress",
              index: i + 1,
              total: pending.length,
              id: row.id,
              ok: false,
              sourceKey: row.sourceKey ?? null,
              error:
                err instanceof Error ? err.message : "Analysis failed",
            });
          }
        }

        if (!signal.aborted) {
          write({
            type: "complete",
            processed: pending.length,
            okCount,
            failCount,
          });
        }
      } catch (e) {
        write({
          type: "error",
          message: e instanceof Error ? e.message : "Batch failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
