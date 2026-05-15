import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertLlmConfigured, resolveLlmConfig } from "@/lib/llm-config";
import type { PromptScore } from "@/generated/prisma/enums";
import { runUserCoachingAnalysis } from "@/lib/user-coaching-analysis";
import {
  buildUserCoachingSavedPayload,
  parseUserCoachingSavedPayload,
} from "@/lib/user-coaching-saved";
import {
  fetchUserDetail,
  formatUserKey,
  parseUserKeyFromParam,
} from "@/lib/users-directory";
import { loadUserDisplayNames } from "@/lib/users-lookup";
import { isExcludedFromUserCoaching } from "@/lib/coaching-escalation";
import { filterFeedbackForCoachingByTaskLifecycle } from "@/lib/coaching-feedback-lifecycle";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ADDITIONAL_CONTEXT = 8000;

const bodySchema = z.object({
  userKey: z.string().min(1),
  env: z.string().optional(),
  records: z.enum(["all", "prompts", "feedback"]).optional(),
  additionalContext: z.string().max(MAX_ADDITIONAL_CONTEXT).optional(),
});

type RecordFilter = "all" | "prompts" | "feedback";

function parseRecordFilter(raw: string | undefined): RecordFilter {
  if (raw === "prompts" || raw === "feedback") return raw;
  return "all";
}

function collectEnvOptions(
  prompts: Array<{ envKey?: string | null }>,
  feedback: Array<{ envKey?: string | null }>,
): string[] {
  const set = new Set<string>();
  for (const p of prompts) {
    if (p.envKey?.trim()) set.add(p.envKey.trim());
  }
  for (const f of feedback) {
    if (f.envKey?.trim()) set.add(f.envKey.trim());
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function normalizeEnvParam(
  raw: string | undefined,
  options: string[],
): "all" | string {
  if (!raw || raw === "all") return "all";
  return options.includes(raw) ? raw : "all";
}

function filterByEnvKey<T extends { envKey?: string | null }>(
  items: T[],
  env: "all" | string,
): T[] {
  if (env === "all") return items;
  return items.filter((x) => (x.envKey ?? "") === env);
}

function hasScoredInScope(opts: {
  recordScope: RecordFilter;
  prompts: Array<{ score: string | null }>;
  feedback: Array<{ score: string | null }>;
}): boolean {
  const { recordScope, prompts, feedback } = opts;
  const promptScored = prompts.some((p) => p.score != null);
  const feedbackScored = feedback.some((f) => f.score != null);
  if (recordScope === "all") return promptScored || feedbackScored;
  if (recordScope === "prompts") return promptScored;
  return feedbackScored;
}

function resolveCanonicalUserKey(param: string): string | null {
  const parsed = parseUserKeyFromParam(param);
  return parsed ? formatUserKey(parsed) : null;
}

/** GET: latest saved coaching for a user (`userKey` = path param or canonical key). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("userKey");
  if (!raw?.trim()) {
    return NextResponse.json(
      { error: "Query parameter userKey is required." },
      { status: 400 },
    );
  }
  const canonical = resolveCanonicalUserKey(raw.trim());
  if (!canonical) {
    return NextResponse.json({ error: "Invalid userKey." }, { status: 400 });
  }

  const row = await prisma.userCoachingInsight.findUnique({
    where: { userKey: canonical },
  });
  if (!row) {
    return NextResponse.json({ saved: null });
  }

  const payload = parseUserCoachingSavedPayload(row.reportJson);
  if (!payload) {
    return NextResponse.json({ saved: null });
  }

  return NextResponse.json({
    saved: {
      coaching: payload.result,
      savedAt: payload.savedAt,
      savedDisplayName: payload.displayName,
      savedFilters: payload.filters,
      additionalContextPresent: payload.additionalContextPresent,
      rowUpdatedAt: row.updatedAt.toISOString(),
    },
  });
}

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof bodySchema>;
  try {
    const json = (await request.json()) as unknown;
    parsedBody = bodySchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsedKey = parseUserKeyFromParam(parsedBody.userKey);
  if (!parsedKey) {
    return NextResponse.json({ error: "Invalid user key." }, { status: 400 });
  }
  const canonicalUserKey = formatUserKey(parsedKey);

  try {
    const nameByUserId = loadUserDisplayNames();
    const { displayName, prompts, feedback } = await fetchUserDetail(
      prisma,
      nameByUserId,
      parsedKey,
    );

    if (prompts.length === 0 && feedback.length === 0) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const envOptions = collectEnvOptions(prompts, feedback);
    const envFilter = normalizeEnvParam(parsedBody.env, envOptions);
    const recordFilter = parseRecordFilter(parsedBody.records);

    const promptsEnv = filterByEnvKey(prompts, envFilter);
    const feedbackEnv = filterByEnvKey(feedback, envFilter);

    const showPrompts = recordFilter === "all" || recordFilter === "prompts";
    const showFeedback = recordFilter === "all" || recordFilter === "feedback";

    const filteredPrompts = showPrompts ? promptsEnv : [];
    let filteredFeedback = showFeedback ? feedbackEnv : [];

    if (filteredPrompts.length === 0 && filteredFeedback.length === 0) {
      return NextResponse.json(
        {
          error:
            "No records match the current filters. Broaden environment or record type.",
        },
        { status: 400 },
      );
    }

    if (showFeedback && filteredFeedback.length > 0) {
      filteredFeedback = await filterFeedbackForCoachingByTaskLifecycle(
        prisma,
        filteredFeedback,
      );
    }

    if (filteredPrompts.length === 0 && filteredFeedback.length === 0) {
      return NextResponse.json(
        {
          error:
            "No records remain for coaching in this scope. Feedback coaching only includes tasks in development, staging, or production with a matching imported prompt (feedback task_key → Prompt.sourceKey). Prompt-only coaching is unchanged; broaden filters or fix task linkage.",
        },
        { status: 400 },
      );
    }

    let extraByPromptId = new Map<string, unknown>();
    if (filteredPrompts.length > 0) {
      const extras = await prisma.prompt.findMany({
        where: { id: { in: filteredPrompts.map((p) => p.id) } },
        select: { id: true, extra: true },
      });
      extraByPromptId = new Map(
        extras.map((row) => [row.id, row.extra ?? null] as const),
      );
    }

    const coachingPrompts = filteredPrompts.filter(
      (p) =>
        !isExcludedFromUserCoaching({
          body: p.body,
          rationale: p.rationale,
          extra: extraByPromptId.get(p.id),
        }),
    );
    const coachingFeedback = filteredFeedback.filter(
      (f) =>
        !isExcludedFromUserCoaching({ body: f.body, rationale: f.rationale }),
    );

    if (coachingPrompts.length === 0 && coachingFeedback.length === 0) {
      return NextResponse.json(
        {
          error:
            "No records remain after excluding escalated tasks (platform or QA escalation review, flagged bugged, cannot grade, or escalated metadata). Broaden filters or wait for non-escalated work in scope.",
        },
        { status: 400 },
      );
    }

    if (
      !hasScoredInScope({
        recordScope: recordFilter,
        prompts: coachingPrompts,
        feedback: coachingFeedback,
      })
    ) {
      return NextResponse.json(
        {
          error:
            "At least one scored prompt or feedback record is required in the current scope after excluding escalations; feedback also requires tasks in development, staging, or production. Run analysis on items first, or widen filters.",
        },
        { status: 400 },
      );
    }

    const cfg = await resolveLlmConfig(prisma);
    try {
      assertLlmConfigured(cfg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "LLM is not configured.";
      return NextResponse.json({ error: msg }, { status: 503 });
    }

    try {
      const result = await runUserCoachingAnalysis({
        displayName,
        recordScope: recordFilter,
        prompts: coachingPrompts.map((p) => ({
          score: p.score as PromptScore | null,
          rationale: p.rationale,
          projectKey: p.projectKey ?? "",
          envKey: p.envKey ?? "",
          body: p.body,
        })),
        feedback: coachingFeedback.map((f) => ({
          score: f.score as PromptScore | null,
          rationale: f.rationale,
          projectKey: f.projectKey ?? "",
          envKey: f.envKey ?? "",
          body: f.body,
        })),
        additionalContext: parsedBody.additionalContext,
        llmConfig: cfg,
      });

      const saved = buildUserCoachingSavedPayload({
        displayName,
        filters: {
          env: envFilter === "all" ? "all" : envFilter,
          records: recordFilter,
        },
        additionalContextPresent: Boolean(parsedBody.additionalContext?.trim()),
        result,
      });

      const reportJson = JSON.parse(JSON.stringify(saved)) as object;

      await prisma.userCoachingInsight.upsert({
        where: { userKey: canonicalUserKey },
        create: { userKey: canonicalUserKey, reportJson },
        update: { reportJson },
      });

      return NextResponse.json({
        coaching: result,
        savedAt: saved.savedAt,
        savedDisplayName: saved.displayName,
        savedFilters: saved.filters,
        additionalContextPresent: saved.additionalContextPresent,
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Coaching analysis failed unexpectedly.";
      console.error("[users/coaching] LLM step", e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Coaching analysis failed unexpectedly.";
    console.error("[users/coaching]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
