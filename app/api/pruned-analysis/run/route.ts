import { NextResponse } from "next/server";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import { filterGuidelinesForUi } from "@/lib/guideline-scope";
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
import { prisma } from "@/lib/prisma";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { runPrunedTasksAnalysis } from "@/lib/pruned-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ADDITIONAL_CONTEXT_CHARS = 12000;

export async function POST(request: Request) {
  let projectFilter: ProjectFilter = "all";
  let environment: EnvFilter = "all";
  let additionalContext: string | undefined;
  let guidelineIdsRaw: string[] = [];
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as {
        project?: unknown;
        environment?: unknown;
        additionalContext?: unknown;
        guidelineIds?: unknown;
      };
      if (typeof body.project === "string") {
        projectFilter = parseProjectFilter({ project: body.project });
      }
      if (typeof body.environment === "string") {
        environment = parseEnvFilter({ env: body.environment });
      }
      if (typeof body.additionalContext === "string") {
        additionalContext = body.additionalContext.slice(
          0,
          MAX_ADDITIONAL_CONTEXT_CHARS,
        );
      }
      if (Array.isArray(body.guidelineIds)) {
        guidelineIdsRaw = body.guidelineIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        );
      }
    }
  } catch {
    // optional body
  }

  if (projectFilter === "all") {
    return NextResponse.json(
      {
        error:
          "Select a project (JSON import source) for pruned analysis.",
      },
      { status: 400 },
    );
  }

  if (environment === "all" || environment === "unmapped") {
    return NextResponse.json(
      {
        error:
          "Select a specific environment with ingested prompts for pruned analysis.",
      },
      { status: 400 },
    );
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

  try {
    const guidelineRows = await prisma.guideline.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, content: true },
    });
    const visibleGuidelines = filterGuidelinesForUi(guidelineRows);

    let guidelines = visibleGuidelines;
    if (guidelineIdsRaw.length > 0) {
      const selected = visibleGuidelines.filter((g) =>
        guidelineIdsRaw.includes(g.id),
      );
      if (selected.length === 0) {
        return NextResponse.json(
          { error: "No matching guideline sets for the given ids." },
          { status: 400 },
        );
      }
      guidelines = selected;
    }

    const { report, sampleCount, sourcePath } = await runPrunedTasksAnalysis(
      llmConfig,
      environment,
      guidelines,
      additionalContext,
    );

    const projectKey = projectFilterToDbKey(projectFilter);
    const envKey = serializeEnvQueryValue(environment);
    const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineIdsRaw);
    const reportJson = JSON.parse(JSON.stringify(report)) as object;
    const delegate = (
      prisma as unknown as {
        prunedTaskAnalysis: {
          upsert(args: unknown): Promise<{ updatedAt: Date }>;
        };
      }
    ).prunedTaskAnalysis;
    let savedAt: string | null = null;
    if (delegate && typeof delegate.upsert === "function") {
      const row = await delegate.upsert({
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
          reportJson,
        },
        update: {
          reportJson,
        },
      });
      savedAt = row.updatedAt.toISOString();
    }

    return NextResponse.json({
      report,
      sampleCount,
      sourcePath,
      savedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Pruned analysis failed" },
      { status: 500 },
    );
  }
}
