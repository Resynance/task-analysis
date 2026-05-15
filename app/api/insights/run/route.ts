import { NextResponse } from "next/server";
import { coachingInsightGuidelineScopeKey } from "@/lib/coaching-insight-keys";
import { prisma } from "@/lib/prisma";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { runCoachingInsights } from "@/lib/coaching-insights";
import {
  buildEnvFilterOptionsFromRows,
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
/** Batch “all environments” may run several LLM calls back-to-back. */
export const maxDuration = 300;

const MAX_ADDITIONAL_CONTEXT_CHARS = 12000;

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
    // default environment
  }

  if (projectFilter === "all") {
    return NextResponse.json(
      {
        error:
          "Select a project (JSON import source). Coaching insights are saved per project and environment.",
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
  const guidelineScopeKey = coachingInsightGuidelineScopeKey(guidelineIds);

  async function upsertInsightRow(
    envKeySerialized: string,
    report: object,
    summary: string,
  ) {
    const reportJson = JSON.parse(JSON.stringify(report)) as object;
    return prisma.coachingInsight.upsert({
      where: {
        projectKey_envKey_guidelineScopeKey: {
          projectKey,
          envKey: envKeySerialized,
          guidelineScopeKey,
        },
      },
      create: {
        projectKey,
        envKey: envKeySerialized,
        guidelineScopeKey,
        reportJson,
        summary,
      },
      update: {
        reportJson,
        summary,
      },
    });
  }

  try {
    if (environment === "all") {
      const scopeRows = await prisma.prompt.findMany({
        select: { envKey: true, projectKey: true },
      });
      const envFilters = buildEnvFilterOptionsFromRows(
        scopeRows,
        projectFilter,
      ).filter((e): e is Exclude<EnvFilter, "all"> => e !== "all");

      if (envFilters.length === 0) {
        return NextResponse.json(
          {
            error:
              "No evaluation environments found for this project. Ingest prompts with env_key, then score tasks before generating insights.",
          },
          { status: 400 },
        );
      }

      type Ok = { envKey: string; savedAt: string; summary: string };
      type Fail = { envKey: string; error: string };
      const ok: Ok[] = [];
      const failed: Fail[] = [];

      for (const env of envFilters) {
        const envKeySerialized = serializeEnvQueryValue(env);
        try {
          const { report, summary } = await runCoachingInsights(
            prisma,
            llmConfig,
            projectFilter,
            env,
            guidelineIds,
            additionalContext,
          );
          const row = await upsertInsightRow(envKeySerialized, report, summary);
          ok.push({
            envKey: envKeySerialized,
            savedAt: row.updatedAt.toISOString(),
            summary,
          });
        } catch (e) {
          failed.push({
            envKey: envKeySerialized,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (ok.length === 0) {
        const detail = failed.map((f) => `${f.envKey}: ${f.error}`).join("; ");
        return NextResponse.json(
          {
            error:
              failed.length === 1
                ? failed[0].error
                : `No environments completed successfully. ${detail}`,
            failures: failed,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        batch: true as const,
        completed: ok.length,
        attempted: envFilters.length,
        results: ok,
        failures: failed.length > 0 ? failed : undefined,
      });
    }

    const { report, summary } = await runCoachingInsights(
      prisma,
      llmConfig,
      projectFilter,
      environment,
      guidelineIds,
      additionalContext,
    );

    const envKeySerialized = serializeEnvQueryValue(environment);
    const row = await upsertInsightRow(envKeySerialized, report, summary);

    return NextResponse.json({
      report,
      summary,
      savedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Insights run failed" },
      { status: 500 },
    );
  }
}
