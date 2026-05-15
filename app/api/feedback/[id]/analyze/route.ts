import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeFeedbackAgainstGuidelines } from "@/lib/analyze-feedback";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  guidelineId: z.string().min(1),
  extraInstructions: z.string().max(8000).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const row = await prisma.feedback.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "Feedback row not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "guidelineId is required" }, { status: 400 });
  }
  const guideline = await prisma.guideline.findUnique({
    where: { id: parsed.data.guidelineId },
    select: { id: true, name: true, content: true },
  });
  if (!guideline) {
    return NextResponse.json({ error: "Guideline not found" }, { status: 400 });
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
    const result = await analyzeFeedbackAgainstGuidelines(
      {
        feedbackBody: row.body,
        guidelineContent: guideline.content,
        extraInstructions: parsed.data.extraInstructions,
      },
      llmConfig,
    );
    const updated = await prisma.feedback.update({
      where: { id },
      data: {
        guidelineId: guideline.id,
        score: result.score,
        rationale: result.rationale,
        analyzedAt: new Date(),
      },
      include: { guideline: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ feedback: updated, rawModelOutput: result.raw });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis failed" },
      { status: 500 },
    );
  }
}
