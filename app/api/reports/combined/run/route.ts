import { NextResponse } from "next/server";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import { buildCombinedWriterReport } from "@/lib/combined-writer-report";
import { runCoachingInsights } from "@/lib/coaching-insights";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import { runPrunedTasksAnalysis } from "@/lib/pruned-analysis";
import {
  parseEnvFilter,
  serializeEnvQueryValue,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  parseProjectFilter,
  projectFilterToDbKey,
  type ProjectFilter,
} from "@/lib/task-project";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ADDITIONAL_CONTEXT_CHARS = 12000;

/**
 * Runs coaching insights and pruned analysis back-to-back for the same env +
 * rubric scope, upserts both rows, and returns fresh payloads. Ensures the
 * combined report always pairs two newly generated versions.
 */
export async function POST(request: Request) {
  let projectFilter: ProjectFilter = "all";
  let environment: EnvFilter = "all";
  let guidelineIdsRaw: string[] = [];
  let additionalContext: string | undefined;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as {
        project?: string;
        environment?: string;
        guidelineIds?: unknown;
        additionalContext?: unknown;
      };
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
        guidelineIdsRaw = g.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        );
      }
      const ac = body?.additionalContext;
      if (typeof ac === "string") {
        additionalContext = ac.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
      }
    }
  } catch {
    // optional body
  }

  if (projectFilter === "all") {
    return NextResponse.json(
      {
        error:
          "Select a project (JSON import source) for the combined report.",
      },
      { status: 400 },
    );
  }

  if (environment === "all" || environment === "unmapped") {
    return NextResponse.json(
      {
        error:
          "Select a specific evaluation environment for the combined report.",
      },
      { status: 400 },
    );
  }

  let guidelineIds: string[] = [];
  if (guidelineIdsRaw.length > 0) {
    const valid = await prisma.guideline.findMany({
      where: { id: { in: guidelineIdsRaw } },
      select: { id: true },
    });
    guidelineIds = valid.map((r) => r.id);
    if (guidelineIds.length === 0) {
      return NextResponse.json(
        { error: "No matching guideline sets for the given ids." },
        { status: 400 },
      );
    }
  }

  let llmConfig;
  try {
    llmConfig = await resolveLlmConfig(prisma);
    assertLlmConfigured(llmConfig);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "LLM not configured" },
      { status: 400 },
    );
  }

  const projectKey = projectFilterToDbKey(projectFilter);
  const envKey = serializeEnvQueryValue(environment);
  const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineIds);

  try {
    const { report: insightsReport, summary } = await runCoachingInsights(
      prisma,
      llmConfig,
      projectFilter,
      environment,
      guidelineIds,
      additionalContext,
    );

    const insightsReportJson = JSON.parse(
      JSON.stringify(insightsReport),
    ) as object;
    const insightsRow = await prisma.coachingInsight.upsert({
      where: {
        projectKey_envKey_guidelineScopeKey: {
          projectKey,
          envKey,
          guidelineScopeKey,
        },
      },
      create: {
        projectKey,
        envKey,
        guidelineScopeKey,
        reportJson: insightsReportJson,
        summary,
      },
      update: {
        reportJson: insightsReportJson,
        summary,
      },
    });

    const guidelineRows = await prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, content: true },
    });
    const visibleGuidelines = filterGuidelinesForUi(guidelineRows);
    let guidelinesForPruned = visibleGuidelines;
    if (guidelineIds.length > 0) {
      const selected = visibleGuidelines.filter((g) =>
        guidelineIds.includes(g.id),
      );
      if (selected.length === 0) {
        return NextResponse.json(
          { error: "No matching guideline sets for pruned analysis." },
          { status: 400 },
        );
      }
      guidelinesForPruned = selected;
    }

    const {
      report: prunedReport,
      sampleCount,
      sourcePath,
    } = await runPrunedTasksAnalysis(
      llmConfig,
      environment,
      guidelinesForPruned,
      additionalContext,
    );

    const prunedReportJson = JSON.parse(JSON.stringify(prunedReport)) as object;
    const prunedRow = await prisma.prunedTaskAnalysis.upsert({
      where: {
        projectKey_envKey_guidelineScopeKey: {
          projectKey,
          envKey,
          guidelineScopeKey,
        },
      },
      create: {
        projectKey,
        envKey,
        guidelineScopeKey,
        reportJson: prunedReportJson,
      },
      update: {
        reportJson: prunedReportJson,
      },
    });

    return NextResponse.json({
      report: buildCombinedWriterReport(insightsReport, prunedReport),
      summary,
      savedAt: new Date(
        Math.max(insightsRow.updatedAt.getTime(), prunedRow.updatedAt.getTime()),
      ).toISOString(),
      source: {
        insightsSavedAt: insightsRow.updatedAt.toISOString(),
        prunedSavedAt: prunedRow.updatedAt.toISOString(),
        sampleCount,
        sourcePath,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Combined report generation failed",
      },
      { status: 500 },
    );
  }
}
