import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clarifyPromptAnalysisResult } from "@/lib/prompt-analysis-clarify";
import {
  buildClarificationPayload,
  promptAnalysisClarificationSchema,
} from "@/lib/prompt-analysis-clarification";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { getUserStoryForPrompt } from "@/lib/scenarios/task-user-story";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  question: z.string().min(1).max(4000),
});

function evaluationBlock(
  score: string | null,
  rationale: string | null,
): string | null {
  if (!rationale?.trim()) return null;
  const tier = score ?? "NOT_SCORED";
  return `Tier: ${tier}\nRationale:\n${rationale.trim()}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse((await request.json()) as unknown);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

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
          "Follow-up clarification is only available for tasks eligible for rubric analysis (production lifecycle, or legacy imports without lifecycle metadata).",
      },
      { status: 400 },
    );
  }

  const block = evaluationBlock(prompt.score, prompt.rationale);
  if (!block) {
    return NextResponse.json(
      {
        error:
          "This prompt has no model rationale yet. Run analysis first, then ask a follow-up.",
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
      { status: 503 },
    );
  }

  try {
    const userStory = getUserStoryForPrompt(prompt.envKey, prompt.extra);
    const { answer } = await clarifyPromptAnalysisResult(
      {
        promptBody: prompt.body,
        guidelineContent: prompt.guideline.content,
        userStory,
        evaluationBlock: block,
        operatorQuestion: body.question,
      },
      llmConfig,
    );

    const payload = buildClarificationPayload({
      question: body.question,
      answer,
    });
    const validated = promptAnalysisClarificationSchema.parse(payload);

    const updated = await prisma.prompt.update({
      where: { id },
      data: {
        analysisClarification: JSON.parse(JSON.stringify(validated)) as object,
      },
      include: { guideline: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      clarification: validated,
      prompt: updated,
    });
  } catch (e) {
    console.error("[prompts/clarify]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Clarification failed" },
      { status: 500 },
    );
  }
}
