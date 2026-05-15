import { NextResponse } from "next/server";
import { generateOverviewReport } from "@/lib/pmgpt-failure-analysis";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
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

  const result = await generateOverviewReport(llmConfig);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    writtenPath: result.writtenPath,
    sourceTaskCount: result.sourceTaskCount,
  });
}
