import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { getTaskLifecycleStatusFromExtra } from "@/lib/task-lifecycle";

type PromptLifecycleRow = {
  sourceKey: string;
  projectKey: string;
  envKey: string | null;
  extra: unknown;
};

/** Feedback coaching only uses reviewer records tied to tasks in these lifecycle buckets. */
const ALLOWED = new Set(["development", "staging", "production"]);

export function taskLifecycleAllowedForFeedbackCoaching(
  status: string | null,
): boolean {
  if (status == null) return false;
  const s = status.trim().toLowerCase();
  return s.length > 0 && ALLOWED.has(s);
}

function normalizeTaskKey(s: string): string {
  return s.trim().toLowerCase();
}

function resolveLifecycleForFeedbackRow(
  f: {
    taskKey: string | null;
    projectKey: string;
    envKey: string | null;
  },
  prompts: Array<{
    sourceKey: string | null;
    projectKey: string;
    envKey: string | null;
    extra: unknown;
  }>,
): string | null {
  const tk = f.taskKey?.trim();
  if (!tk) return null;
  const n = normalizeTaskKey(tk);
  const candidates = prompts.filter(
    (p) => p.sourceKey && normalizeTaskKey(p.sourceKey) === n,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return getTaskLifecycleStatusFromExtra(candidates[0].extra);
  }
  const proj = (f.projectKey ?? "").trim();
  const env = (f.envKey ?? "").trim();
  const narrowed = candidates.filter((p) => {
    const pp = (p.projectKey ?? "").trim();
    const pe = (p.envKey ?? "").trim();
    return pp === proj && pe === env;
  });
  const pick = narrowed[0] ?? candidates[0];
  return getTaskLifecycleStatusFromExtra(pick.extra);
}

export type CoachingFeedbackRow = {
  taskKey: string | null;
  projectKey: string;
  envKey: string | null;
};

/**
 * Keeps feedback rows whose task resolves to a Prompt with
 * `extra.task_lifecycle_status` in development / staging / production.
 * Rows without `taskKey`, or with no matching Prompt, are dropped.
 */
export async function filterFeedbackForCoachingByTaskLifecycle<
  T extends CoachingFeedbackRow,
>(prisma: PrismaClient, feedback: T[]): Promise<T[]> {
  if (feedback.length === 0) return feedback;

  const uniqueKeys = [
    ...new Set(
      feedback
        .map((f) => f.taskKey?.trim())
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  if (uniqueKeys.length === 0) {
    return [];
  }

  /**
   * SQLite does not support Prisma's `mode: "insensitive"` on string filters.
   * Match task keys case-insensitively via `lower(sourceKey)` (batched IN lists).
   */
  const KEY_BATCH = 48;
  const prompts: Array<{
    sourceKey: string | null;
    projectKey: string;
    envKey: string | null;
    extra: unknown;
  }> = [];
  for (let i = 0; i < uniqueKeys.length; i += KEY_BATCH) {
    const slice = uniqueKeys.slice(i, i + KEY_BATCH);
    const lowered = slice.map((k) => k.trim().toLowerCase());
    const batch = await prisma.$queryRaw<PromptLifecycleRow[]>(Prisma.sql`
      SELECT "sourceKey", "projectKey", "envKey", "extra"
      FROM "Prompt"
      WHERE "sourceKey" IS NOT NULL
        AND lower("sourceKey") IN (${Prisma.join(
          lowered.map((k) => Prisma.sql`${k}`),
        )})
    `);
    prompts.push(...batch);
  }

  return feedback.filter((f) => {
    const lifecycle = resolveLifecycleForFeedbackRow(f, prompts);
    return taskLifecycleAllowedForFeedbackCoaching(lifecycle);
  });
}
