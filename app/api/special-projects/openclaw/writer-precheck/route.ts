import { NextResponse } from "next/server";

import type { PromptScore } from "@/generated/prisma/enums";
import type { PromptAnalysisProblemArea } from "@/lib/analyze-prompt";
import { analyzePromptAgainstGuidelines } from "@/lib/analyze-prompt";
import { assertLlmConfigured, resolveLlmConfig, type ResolvedLlmConfig } from "@/lib/llm-config";
import {
  parseWriterPrecheckCsv,
  WRITER_PRECHECK_MAX_ROWS,
  type WriterPrecheckCsvRow,
} from "@/lib/openclaw-writer-precheck-csv";
import {
  buildWriterPrecheckAuditLookup,
  findWriterPrecheckPriorAudit,
  type WriterPrecheckPriorAudit,
} from "@/lib/openclaw-writer-precheck-prior-audit";
import { prisma } from "@/lib/prisma";

/**
 * Writer draft **pre-check** API: score each CSV row’s prompt against a stored guideline, optionally
 * with a **saved world** (database) or pasted persona text as **user story** context.
 *
 * Response is **NDJSON** (`text/x-ndjson`): a `start` event, one `row` per sheet line (LLM result
 * plus optional **prior workflow audit** from on-disk `task_*.md` reports), then `complete` or
 * `error` / `aborted`. Client: `components/openclaw-writer-precheck-panel.tsx`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 12_000_000;
const MAX_EXTRA_INSTRUCTIONS = 200_000;
/** Pasted persona / world text; saved DB bodies can be large — cap avoids runaway payloads. */
const MAX_USER_STORY_CHARS = 400_000;

export type WriterPrecheckUserStorySource = "saved_world" | "pasted" | "none";

export type { WriterPrecheckPriorAudit } from "@/lib/openclaw-writer-precheck-prior-audit";

export type WriterPrecheckApiRowResult = {
  rowIndex: number;
  externalId: string | null;
  /** Task writer from intake when the spreadsheet includes a name-style column. */
  writerName: string | null;
  score: PromptScore | null;
  rationale: string | null;
  error: string | null;
  /** Targeted issues (prompt vs writer rubric vs guidelines, etc.); empty when none. */
  problemAreas?: PromptAnalysisProblemArea[];
  /**
   * When a matching on-disk workflow audit (`task_*.md` under trace-exports/reports) exists — by
   * task id from the sheet or by normalized prompt prefix (YAML prompt, ≤140 chars).
   */
  priorAudit: WriterPrecheckPriorAudit | null;
};

export type WriterPrecheckStreamStart = {
  type: "start";
  guideline: { id: string; name: string };
  targetWorld: { id: string; name: string } | null;
  userStorySource: WriterPrecheckUserStorySource;
  parseWarnings: string[];
  maxRows: number;
  totalRows: number;
};

export type WriterPrecheckStreamRow = {
  type: "row";
  completed: number;
  total: number;
  result: WriterPrecheckApiRowResult;
};

export type WriterPrecheckStreamComplete = {
  type: "complete";
  summary: {
    total: number;
    excellent: number;
    average: number;
    poor: number;
    failed: number;
  };
};

export type WriterPrecheckStreamAborted = {
  type: "aborted";
  completed: number;
  total: number;
};

export type WriterPrecheckStreamError = {
  type: "error";
  message: string;
  parseErrors?: string[];
};

function buildExtraInstructions(input: {
  writerRubric: string | null;
  notes: string | null;
  writerName: string | null;
  personaName: string | null;
}): string | undefined {
  const parts: string[] = [
    "This is a **pre-recording QA** pass: recordings have not been made yet. " +
      "The writer may have supplied a draft rubric and notes below. " +
      "Use them only as supporting context. The official GUIDELINES block in the main prompt remains **authoritative** for scoring the PROMPT.",
  ];
  if (input.writerName?.trim()) {
    parts.push(`Writer (from intake sheet): ${input.writerName.trim()}`);
  }
  if (input.personaName?.trim()) {
    parts.push(
      `Named persona on intake sheet (label only; use USER STORY / saved world for full persona spec when provided): ${input.personaName.trim()}`,
    );
  }
  if (input.writerRubric?.trim()) {
    parts.push(`Writer-provided rubric (draft):\n${input.writerRubric.trim()}`);
  }
  if (input.notes?.trim()) {
    parts.push(`Notes / comments from intake sheet:\n${input.notes.trim()}`);
  }
  const s = parts.join("\n\n");
  if (s.length <= MAX_EXTRA_INSTRUCTIONS) return s;
  return `${s.slice(0, MAX_EXTRA_INSTRUCTIONS)}\n\n[…truncated for length]`;
}

async function resolveUserStory(input: {
  openclawWorldId: string | null;
  userStoryText: string | null;
}): Promise<
  | { userStory: string | undefined; world: { id: string; name: string } | null }
  | { error: string; status: number }
> {
  const worldId = input.openclawWorldId?.trim() || null;
  const pasted = input.userStoryText?.trim() || null;

  if (worldId) {
    const world = await prisma.openclawWorld.findUnique({
      where: { id: worldId },
      select: { id: true, name: true, body: true },
    });
    if (!world) {
      return { error: "Saved world not found", status: 404 };
    }
    const body = world.body.trim();
    if (!body) {
      return { error: "Selected world has empty body text", status: 400 };
    }
    return {
      userStory: body,
      world: { id: world.id, name: world.name },
    };
  }

  if (pasted) {
    if (pasted.length > MAX_USER_STORY_CHARS) {
      return {
        error: `Pasted world / persona exceeds ${MAX_USER_STORY_CHARS} characters`,
        status: 400,
      };
    }
    return { userStory: pasted, world: null };
  }

  return { userStory: undefined, world: null };
}

/** One CSV row: LLM analysis with problem areas on; errors become row-level `error` strings. */
async function analyzeOneRow(input: {
  row: WriterPrecheckCsvRow;
  guidelineContent: string;
  userStory: string | undefined;
  llmConfig: ResolvedLlmConfig;
}): Promise<Omit<WriterPrecheckApiRowResult, "priorAudit">> {
  const extraInstructions = buildExtraInstructions({
    writerRubric: input.row.writerRubric,
    notes: input.row.notes,
    writerName: input.row.writerName,
    personaName: input.row.personaName,
  });
  try {
    const out = await analyzePromptAgainstGuidelines(
      {
        promptBody: input.row.prompt,
        guidelineContent: input.guidelineContent,
        userStory: input.userStory,
        extraInstructions,
        includeProblemAreas: true,
      },
      input.llmConfig,
    );
    return {
      rowIndex: input.row.rowIndex,
      externalId: input.row.externalId,
      writerName: input.row.writerName,
      score: out.score,
      rationale: out.rationale,
      error: null,
      problemAreas: out.problemAreas ?? [],
    };
  } catch (e) {
    return {
      rowIndex: input.row.rowIndex,
      externalId: input.row.externalId,
      writerName: input.row.writerName,
      score: null,
      rationale: null,
      error: e instanceof Error ? e.message : "Analysis failed",
      problemAreas: [],
    };
  }
}

export async function POST(request: Request) {
  const signal = request.signal;

  let guidelineId = "";
  let csvText = "";
  let openclawWorldId: string | null = null;
  let userStoryText: string | null = null;

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        { error: "Expected application/json" },
        { status: 415 },
      );
    }
    const body = (await request.json()) as {
      guidelineId?: unknown;
      csvText?: unknown;
      openclawWorldId?: unknown;
      userStoryText?: unknown;
    };
    if (typeof body.guidelineId === "string" && body.guidelineId.trim()) {
      guidelineId = body.guidelineId.trim();
    }
    if (typeof body.csvText === "string") {
      csvText = body.csvText;
    }
    if (typeof body.openclawWorldId === "string" && body.openclawWorldId.trim()) {
      openclawWorldId = body.openclawWorldId.trim();
    }
    if (typeof body.userStoryText === "string") {
      userStoryText = body.userStoryText;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!guidelineId) {
    return NextResponse.json(
      { error: "guidelineId is required" },
      { status: 400 },
    );
  }

  const buf = Buffer.byteLength(csvText, "utf8");
  if (buf > MAX_CSV_BYTES) {
    return NextResponse.json(
      { error: `CSV exceeds ${MAX_CSV_BYTES} bytes` },
      { status: 400 },
    );
  }

  const guideline = await prisma.guideline.findUnique({
    where: { id: guidelineId },
  });
  if (!guideline) {
    return NextResponse.json({ error: "Guideline not found" }, { status: 404 });
  }

  const storyResolved = await resolveUserStory({ openclawWorldId, userStoryText });
  if ("error" in storyResolved) {
    return NextResponse.json(
      { error: storyResolved.error },
      { status: storyResolved.status },
    );
  }
  const { userStory, world: targetWorld } = storyResolved;

  const parsed = parseWriterPrecheckCsv(csvText);
  if (parsed.errors.length > 0 && parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "CSV parse failed", parseErrors: parsed.errors },
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

  const userStorySource: WriterPrecheckUserStorySource =
    targetWorld != null ? "saved_world" : userStory ? "pasted" : "none";

  const encoder = new TextEncoder();
  // One JSON object per line so the client can parse incrementally as rows finish.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      const startPayload: WriterPrecheckStreamStart = {
        type: "start",
        guideline: { id: guideline.id, name: guideline.name },
        targetWorld,
        userStorySource,
        parseWarnings: parsed.errors,
        maxRows: WRITER_PRECHECK_MAX_ROWS,
        totalRows: parsed.rows.length,
      };
      send(startPayload);

      const results: WriterPrecheckApiRowResult[] = [];
      const total = parsed.rows.length;
      // Index `trace-exports/reports/task_*.md` once per request (sync disk reads).
      const auditLookup = buildWriterPrecheckAuditLookup();

      try {
        for (let i = 0; i < parsed.rows.length; i += 1) {
          if (signal.aborted) {
            const aborted: WriterPrecheckStreamAborted = {
              type: "aborted",
              completed: results.length,
              total,
            };
            send(aborted);
            break;
          }

          const row = parsed.rows[i]!;
          const base = await analyzeOneRow({
            row,
            guidelineContent: guideline.content,
            userStory,
            llmConfig,
          });
          const priorAudit = findWriterPrecheckPriorAudit(row, auditLookup);
          const result: WriterPrecheckApiRowResult = { ...base, priorAudit };
          results.push(result);

          const rowEvent: WriterPrecheckStreamRow = {
            type: "row",
            completed: results.length,
            total,
            result,
          };
          send(rowEvent);
        }

        if (!signal.aborted) {
          const summary = {
            total: results.length,
            excellent: results.filter((r) => r.score === "EXCELLENT").length,
            average: results.filter((r) => r.score === "AVERAGE").length,
            poor: results.filter((r) => r.score === "POOR").length,
            failed: results.filter((r) => r.error != null).length,
          };
          const complete: WriterPrecheckStreamComplete = {
            type: "complete",
            summary,
          };
          send(complete);
        }
      } catch (e) {
        const err: WriterPrecheckStreamError = {
          type: "error",
          message: e instanceof Error ? e.message : "Unexpected error during scan",
        };
        send(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
