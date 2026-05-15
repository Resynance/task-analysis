import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeFeedbackAgainstGuidelines } from "@/lib/analyze-feedback";
import type { BatchStreamEvent } from "@/lib/batch-analyze-stream";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import { envMatchesFilter, parseEnvFilter } from "@/lib/task-environment";
import { parseProjectFilter } from "@/lib/task-project";

const bodySchema = z.object({
  guidelineId: z.string().min(1),
  includeScored: z.boolean().optional(),
  project: z.string().optional(),
  environment: z.string().optional(),
  extraInstructions: z.string().max(8000).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signal = request.signal;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "guidelineId is required" },
      { status: 400 },
    );
  }

  const guideline = await prisma.guideline.findUnique({
    where: { id: parsed.data.guidelineId },
    select: { id: true, content: true },
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

  const projectFilter =
    typeof parsed.data.project === "string"
      ? parseProjectFilter({ project: parsed.data.project })
      : "all";
  const envFilter =
    typeof parsed.data.environment === "string"
      ? parseEnvFilter({ env: parsed.data.environment })
      : "all";
  const includeScored = Boolean(parsed.data.includeScored);

  let rows = await prisma.feedback.findMany({
    where: includeScored ? {} : { score: null },
    orderBy: { createdAt: "asc" },
  });
  rows = filterRowsByProject(rows, projectFilter);
  rows = rows.filter((r) => envMatchesFilter(r.envKey, envFilter));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (evt: BatchStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(evt)}\n`));
      };

      try {
        write({ type: "start", total: rows.length });

        let okCount = 0;
        let failCount = 0;

        for (let i = 0; i < rows.length; i++) {
          if (signal.aborted) {
            write({
              type: "cancelled",
              processedSoFar: i,
              okCount,
              failCount,
            });
            break;
          }

          const row = rows[i];
          try {
            const result = await analyzeFeedbackAgainstGuidelines(
              {
                feedbackBody: row.body,
                guidelineContent: guideline.content,
                extraInstructions: parsed.data.extraInstructions,
              },
              llmConfig,
            );
            await prisma.feedback.update({
              where: { id: row.id },
              data: {
                guidelineId: guideline.id,
                score: result.score,
                rationale: result.rationale,
                analyzedAt: new Date(),
              },
            });
            okCount += 1;
            write({
              type: "progress",
              index: i + 1,
              total: rows.length,
              id: row.id,
              ok: true,
              sourceKey: row.taskKey?.trim() || row.sourceFeedbackId || null,
            });
          } catch (err) {
            failCount += 1;
            write({
              type: "progress",
              index: i + 1,
              total: rows.length,
              id: row.id,
              ok: false,
              sourceKey: row.taskKey?.trim() || row.sourceFeedbackId || null,
              error:
                err instanceof Error ? err.message : "Analysis failed",
            });
          }
        }

        if (!signal.aborted) {
          write({
            type: "complete",
            processed: rows.length,
            okCount,
            failCount,
          });
        }
      } catch (e) {
        write({
          type: "error",
          message: e instanceof Error ? e.message : "Batch failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
