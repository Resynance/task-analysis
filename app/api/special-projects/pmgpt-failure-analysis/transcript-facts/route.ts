import { NextResponse } from "next/server";

import {
  analyzeTaskTranscriptFacts,
  transcriptFactsToMarkdown,
} from "@/lib/pmgpt-transcript-facts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId")?.trim() ?? "";
  const json = url.searchParams.get("format") === "json";

  const result = await analyzeTaskTranscriptFacts(taskId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const markdown = transcriptFactsToMarkdown(taskId, result.runs);
  if (json) {
    return NextResponse.json({
      taskId,
      markdown,
      runs: result.runs,
    });
  }
  return NextResponse.json({ taskId, markdown });
}
