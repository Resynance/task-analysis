import { NextResponse } from "next/server";
import {
  MAX_DATASET_QA_OPERATOR_NOTES_CHARS,
  MAX_DATASET_QA_QUESTION_CHARS,
  runDatasetQa,
} from "@/lib/dataset-qa";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import {
  parseEnvFilter,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  parseProjectFilter,
  type ProjectFilter,
} from "@/lib/task-project";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let projectFilter: ProjectFilter = "all";
  let environment: EnvFilter = "all";
  let guidelineIdsRaw: string[] = [];
  let question = "";
  let operatorNotes: string | undefined;

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json()) as {
        project?: string;
        environment?: string;
        guidelineIds?: unknown;
        question?: unknown;
        operatorNotes?: unknown;
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
      const q = body?.question;
      if (typeof q === "string") {
        question = q.slice(0, MAX_DATASET_QA_QUESTION_CHARS);
      }
      const on = body?.operatorNotes;
      if (typeof on === "string") {
        operatorNotes = on.slice(0, MAX_DATASET_QA_OPERATOR_NOTES_CHARS);
      }
    }
  } catch {
    /* defaults */
  }

  if (projectFilter === "all") {
    return NextResponse.json(
      {
        error:
          "Select a project. Questions are scoped to one JSON import (dataset) at a time.",
      },
      { status: 400 },
    );
  }

  const qTrim = question.trim();
  if (!qTrim) {
    return NextResponse.json(
      { error: "Enter a question about this dataset scope." },
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
        { error: "No matching rubrics for the given guideline ids." },
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

  try {
    const { answer } = await runDatasetQa(prisma, llmConfig, {
      projectFilter,
      envFilter: environment,
      guidelineIds,
      question: qTrim,
      operatorNotes,
    });
    return NextResponse.json({ answer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Dataset Q&A failed";
    const status = msg.includes("too long") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
