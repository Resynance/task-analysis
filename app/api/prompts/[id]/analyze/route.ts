import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { analyzePromptAgainstGuidelines } from "@/lib/analyze-prompt";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import {
  collectPrunedStemsFromPromptRows,
  loadPrunedKeySetsForEnvStems,
  PRUNED_SCORE_RATIONALE,
  promptMatchesPrunedSet,
} from "@/lib/pruned-task-keys";
import { getUserStoryForPrompt } from "@/lib/scenarios/task-user-story";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

const PRUNED_RAW_PLACEHOLDER = '{"score":"pruned","rationale":"dataset"}';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const prompt = await prisma.prompt.findUnique({
    where: { id },
    include: { guideline: true },
  });

  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  if (!taskLifecycleEligibleForLlmAnalysis(prompt.extra)) {
    return NextResponse.json(
      {
        error:
          "Rubric analysis only runs for tasks in production lifecycle status. This task has a different status in its import metadata.",
      },
      { status: 400 },
    );
  }

  const prunedByStem = await loadPrunedKeySetsForEnvStems(
    collectPrunedStemsFromPromptRows([prompt]),
  );
  if (promptMatchesPrunedSet(prompt.envKey, prompt.sourceKey, prunedByStem)) {
    const updated = await prisma.prompt.update({
      where: { id },
      data: {
        score: "PRUNED",
        rationale: PRUNED_SCORE_RATIONALE,
        analyzedAt: new Date(),
        analysisClarification: Prisma.DbNull,
      },
      include: { guideline: { select: { id: true, name: true } } },
    });
    return NextResponse.json({
      prompt: updated,
      rawModelOutput: PRUNED_RAW_PLACEHOLDER,
      prunedShortCircuit: true,
    });
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
    const userStory = getUserStoryForPrompt(prompt.envKey, prompt.extra);

    const result = await analyzePromptAgainstGuidelines(
      {
        promptBody: prompt.body,
        guidelineContent: prompt.guideline.content,
        userStory,
      },
      llmConfig,
    );

    const updated = await prisma.prompt.update({
      where: { id },
      data: {
        score: result.score,
        rationale: result.rationale,
        analyzedAt: new Date(),
        analysisClarification: Prisma.DbNull,
      },
      include: { guideline: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ prompt: updated, rawModelOutput: result.raw });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis failed" },
      { status: 500 },
    );
  }
}
