import { NextResponse } from "next/server";
import { ingestFeedbackFromFeedbackDirectory } from "@/lib/dataset/import-feedback-csv";
import { ingestPromptsFromPromptsDirectories } from "@/lib/dataset/import-prompts-json";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const [promptResult, feedbackResult] = await Promise.all([
      ingestPromptsFromPromptsDirectories(prisma),
      ingestFeedbackFromFeedbackDirectory(prisma),
    ]);
    return NextResponse.json({
      message: `${promptResult.message} | ${feedbackResult.message}`,
      prompts: promptResult,
      feedback: feedbackResult,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Ingest failed — check JSON or CSV format.",
      },
      { status: 500 },
    );
  }
}
