import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UserCoachingPanel } from "@/components/user-coaching-panel";
import { UserDetailBackButton } from "@/components/user-detail-back-button";
import {
  encodeUserKeyForPath,
  fetchUserDetail,
  formatUserKey,
  parseUserKeyFromParam,
  type ParsedUserKey,
} from "@/lib/users-directory";
import { prisma } from "@/lib/prisma";
import { parseUserCoachingSavedPayload } from "@/lib/user-coaching-saved";
import { loadUserDisplayNames } from "@/lib/users-lookup";
import type { PromptRow } from "@/components/prompt-dashboard";
import {
  TASK_LIFECYCLE_ALL,
  TASK_LIFECYCLE_UNSET_QUERY,
  taskLifecycleFilterShortLabel,
  type TaskLifecycleFilter,
} from "@/lib/task-lifecycle-filter";
import { getTaskLifecycleStatusFromExtra } from "@/lib/task-lifecycle";
import {
  classifyTaskLifecycleQaFlags,
  type TaskLifecycleQaFlagClassification,
} from "@/lib/feedback-qa-flags";

type UserProfileRecordFilter = "all" | "prompts" | "feedback";

type UserProfileSortKey =
  | "created-desc"
  | "created-asc"
  | "score-worst"
  | "score-best";

const DEFAULT_SORT: UserProfileSortKey = "created-desc";

type FeedbackRow = {
  id: string;
  body: string;
  score: string | null;
  rationale: string | null;
  projectKey: string;
  envKey: string | null;
  taskId: string | null;
  taskKey: string | null;
  createdAt: string;
  analyzedAt: string | null;
};

type FlagInfo = TaskLifecycleQaFlagClassification;

function parseRecordFilter(raw: string | undefined): UserProfileRecordFilter {
  if (raw === "prompts" || raw === "feedback") return raw;
  return "all";
}

function parseSortKey(raw: string | undefined): UserProfileSortKey {
  if (
    raw === "created-desc" ||
    raw === "created-asc" ||
    raw === "score-worst" ||
    raw === "score-best"
  ) {
    return raw;
  }
  return DEFAULT_SORT;
}

/**
 * Quality-ordering rank for the sortable score column. Lower rank = "worse" quality.
 * `null` (not analyzed) and `PRUNED` (intentionally removed) sort after classified tiers
 * so they don't outrank actual quality signals.
 */
function scoreRank(score: string | null): number {
  if (score === "POOR") return 0;
  if (score === "AVERAGE") return 1;
  if (score === "EXCELLENT") return 2;
  if (score === "PRUNED") return 3;
  return 4;
}

function sortByCreatedAt<T extends { createdAt: string }>(
  items: T[],
  direction: "asc" | "desc",
): T[] {
  const copy = items.slice();
  copy.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return direction === "asc" ? ta - tb : tb - ta;
  });
  return copy;
}

function sortByScore<T extends { score: string | null; createdAt: string }>(
  items: T[],
  direction: "worst" | "best",
): T[] {
  const copy = items.slice();
  copy.sort((a, b) => {
    const ra = scoreRank(a.score);
    const rb = scoreRank(b.score);
    if (ra !== rb) return direction === "worst" ? ra - rb : rb - ra;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return copy;
}

function applySort<T extends { score: string | null; createdAt: string }>(
  items: T[],
  sort: UserProfileSortKey,
): T[] {
  if (sort === "created-asc") return sortByCreatedAt(items, "asc");
  if (sort === "score-worst") return sortByScore(items, "worst");
  if (sort === "score-best") return sortByScore(items, "best");
  return sortByCreatedAt(items, "desc");
}

/** Distinct `taskLifecycleStatus` slugs (lowercased) present on this user's prompts. */
function collectPromptStatusOptions(prompts: PromptRow[]): string[] {
  const set = new Set<string>();
  for (const p of prompts) {
    const s = p.taskLifecycleStatus?.trim();
    if (s) set.add(s.toLowerCase());
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

const PROMPT_STATUS_PRODUCTION = "production";

/**
 * Default status filter for `/users/[userKey]`: prefer `production` when the user has any
 * production prompts. Otherwise fall back to `all` so we don't render an empty list.
 */
function resolveDefaultPromptStatus(
  promptOptions: string[],
): TaskLifecycleFilter {
  return promptOptions.includes(PROMPT_STATUS_PRODUCTION)
    ? PROMPT_STATUS_PRODUCTION
    : TASK_LIFECYCLE_ALL;
}

/** Mirror `parseTaskLifecycleFilter`'s validation but scoped to this profile's options. */
function normalizePromptStatusParam(
  raw: string | undefined,
  promptOptions: string[],
  hasUnsetPrompt: boolean,
): TaskLifecycleFilter {
  if (!raw) return resolveDefaultPromptStatus(promptOptions);
  const t = raw.trim().toLowerCase();
  if (!t) return resolveDefaultPromptStatus(promptOptions);
  if (t === TASK_LIFECYCLE_ALL) return TASK_LIFECYCLE_ALL;
  if (t === TASK_LIFECYCLE_UNSET_QUERY) {
    return hasUnsetPrompt
      ? TASK_LIFECYCLE_UNSET_QUERY
      : resolveDefaultPromptStatus(promptOptions);
  }
  return promptOptions.includes(t)
    ? t
    : resolveDefaultPromptStatus(promptOptions);
}

function promptMatchesStatusFilter(
  p: PromptRow,
  filter: TaskLifecycleFilter,
): boolean {
  if (filter === TASK_LIFECYCLE_ALL) return true;
  const status = p.taskLifecycleStatus?.trim().toLowerCase() ?? null;
  if (filter === TASK_LIFECYCLE_UNSET_QUERY) return status == null;
  return status === filter;
}

function statusBadgeClass(status: string | null | undefined): string {
  const s = status?.trim().toLowerCase();
  if (!s) return "border-zinc-700 bg-zinc-900/70 text-zinc-400";
  if (s === "bugged") {
    return "border-rose-800/80 bg-rose-950/50 text-rose-200";
  }
  if (s === "escalated-fleet-review") {
    return "border-sky-800/80 bg-sky-950/50 text-sky-200";
  }
  if (s === "production") {
    return "border-emerald-800/70 bg-emerald-950/40 text-emerald-200";
  }
  if (s === "staging") {
    return "border-amber-800/70 bg-amber-950/40 text-amber-200";
  }
  if (s === "development") {
    return "border-sky-800/70 bg-sky-950/40 text-sky-200";
  }
  return "border-zinc-700 bg-zinc-900/70 text-zinc-300";
}

function collectEnvOptions(prompts: PromptRow[], feedback: FeedbackRow[]): string[] {
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

function normalizeTaskRef(raw: string | null | undefined): string | null {
  const t = raw?.trim().toLowerCase();
  return t || null;
}

function flagInfoForLifecycle(status: string | null | undefined): FlagInfo | null {
  const cls = classifyTaskLifecycleQaFlags(status ?? null);
  return cls.bugged || cls.escalated ? cls : null;
}

function buildFlaggedTaskIndex(
  rows: Array<{ sourceId: string | null; sourceKey: string | null; extra: unknown }>,
): Map<string, FlagInfo> {
  const map = new Map<string, FlagInfo>();
  for (const row of rows) {
    const info = flagInfoForLifecycle(getTaskLifecycleStatusFromExtra(row.extra));
    if (!info) continue;
    for (const key of [
      normalizeTaskRef(row.sourceKey),
      normalizeTaskRef(row.sourceId),
    ]) {
      if (key) map.set(key, info);
    }
  }
  return map;
}

function feedbackFlagInfo(
  row: FeedbackRow,
  flaggedTaskIndex: Map<string, FlagInfo>,
): FlagInfo | null {
  for (const key of [
    normalizeTaskRef(row.taskKey),
    normalizeTaskRef(row.taskId),
  ]) {
    if (!key) continue;
    const info = flaggedTaskIndex.get(key);
    if (info) return info;
  }
  return null;
}

function collectFeedbackTaskRefs(rows: FeedbackRow[]): string[] {
  const refs = new Set<string>();
  for (const row of rows) {
    for (const raw of [row.taskKey, row.taskId]) {
      const t = raw?.trim();
      if (t) refs.add(t);
    }
  }
  return Array.from(refs);
}

function taskFlagLabel(info: FlagInfo): string {
  if (info.bugged && info.escalated) return "Bugged + escalated";
  if (info.bugged) return "Bugged";
  return "Escalated";
}

export const dynamic = "force-dynamic";

function scoreLabel(score: string | null): string {
  if (!score) return "Not analyzed";
  if (score === "EXCELLENT") return "Excellent";
  if (score === "AVERAGE") return "Average";
  if (score === "POOR") return "Poor";
  if (score === "PRUNED") return "Pruned";
  return score;
}

function scoreClass(score: string | null): string {
  if (!score) return "bg-zinc-800/80 text-zinc-400 border-zinc-700";
  if (score === "EXCELLENT") {
    return "bg-emerald-950/60 text-emerald-200 border-emerald-800/80";
  }
  if (score === "AVERAGE") {
    return "bg-amber-950/50 text-amber-200 border-amber-800/70";
  }
  if (score === "PRUNED") {
    return "bg-zinc-800/80 text-zinc-400 border-zinc-700";
  }
  return "bg-rose-950/50 text-rose-200 border-rose-800/70";
}

function libraryHref(parsed: ParsedUserKey): string {
  const q = new URLSearchParams();
  q.set("authorSearch", parsed.value);
  return `/?${q.toString()}`;
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userKey: rawParam } = await params;
  const sp = await searchParams;
  const parsed = parseUserKeyFromParam(rawParam);
  if (!parsed) notFound();

  const nameByUserId = loadUserDisplayNames();
  const { displayName, secondaryEmail, prompts, feedback } = await fetchUserDetail(
    prisma,
    nameByUserId,
    parsed,
  );

  if (prompts.length === 0 && feedback.length === 0) {
    notFound();
  }

  const envOptions = collectEnvOptions(prompts, feedback);
  const envFilter = normalizeEnvParam(
    typeof sp.env === "string" ? sp.env : undefined,
    envOptions,
  );
  const recordFilter = parseRecordFilter(
    typeof sp.records === "string" ? sp.records : undefined,
  );
  const sortKey = parseSortKey(
    typeof sp.sort === "string" ? sp.sort : undefined,
  );
  const promptStatusOptions = collectPromptStatusOptions(prompts);
  const hasUnsetPrompt = prompts.some(
    (p) => !p.taskLifecycleStatus?.trim(),
  );
  const defaultPromptStatus = resolveDefaultPromptStatus(promptStatusOptions);
  const promptStatusFilter = normalizePromptStatusParam(
    typeof sp.taskStatus === "string" ? sp.taskStatus : undefined,
    promptStatusOptions,
    hasUnsetPrompt,
  );

  const promptsEnv = filterByEnvKey(prompts, envFilter);
  const promptsEnvStatus = promptsEnv.filter((p) =>
    promptMatchesStatusFilter(p, promptStatusFilter),
  );
  const feedbackEnv = filterByEnvKey(feedback, envFilter);

  const showPrompts = recordFilter === "all" || recordFilter === "prompts";
  const showFeedback = recordFilter === "all" || recordFilter === "feedback";

  const filteredPrompts = showPrompts ? applySort(promptsEnvStatus, sortKey) : [];
  const filteredFeedback = showFeedback ? applySort(feedbackEnv, sortKey) : [];

  const canonicalUserKey = formatUserKey(parsed);
  const profilePath = `/users/${encodeUserKeyForPath(canonicalUserKey)}`;
  const filtersActive =
    envFilter !== "all" ||
    recordFilter !== "all" ||
    sortKey !== DEFAULT_SORT ||
    promptStatusFilter !== defaultPromptStatus;
  const feedbackTaskRefs = collectFeedbackTaskRefs(feedbackEnv);

  const [savedCoachingRow, globalPromptRefs] = await Promise.all([
    prisma.userCoachingInsight.findUnique({
      where: { userKey: canonicalUserKey },
    }),
    feedbackTaskRefs.length > 0
      ? prisma.prompt.findMany({
          where: {
            OR: [
              { sourceKey: { in: feedbackTaskRefs } },
              { sourceId: { in: feedbackTaskRefs } },
            ],
          },
          select: { sourceId: true, sourceKey: true, extra: true },
        })
      : Promise.resolve([]),
  ]);
  const initialSavedPayload = savedCoachingRow
    ? parseUserCoachingSavedPayload(savedCoachingRow.reportJson)
    : null;
  const flaggedTaskIndex = buildFlaggedTaskIndex(globalPromptRefs);
  const authoredPromptFlags = promptsEnv
    .map((p) => flagInfoForLifecycle(p.taskLifecycleStatus))
    .filter((flag): flag is FlagInfo => flag != null);
  const flaggedFeedback = feedbackEnv
    .map((row) => ({ row, flag: feedbackFlagInfo(row, flaggedTaskIndex) }))
    .filter((x): x is { row: FeedbackRow; flag: FlagInfo } => x.flag != null);
  const buggedAuthoredCount = authoredPromptFlags.filter(
    (flag) => flag.bugged,
  ).length;
  const escalatedAuthoredCount = authoredPromptFlags.filter(
    (flag) => flag.escalated,
  ).length;
  const buggedFeedbackCount = flaggedFeedback.filter((x) => x.flag.bugged).length;
  const escalatedFeedbackCount = flaggedFeedback.filter((x) => x.flag.escalated).length;
  const flaggedFeedbackRate =
    feedbackEnv.length > 0
      ? Math.round((flaggedFeedback.length / feedbackEnv.length) * 1000) / 10
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <div className="flex items-center gap-3">
          <UserDetailBackButton />
          <p className="min-w-0 flex-1 font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
            <Link href="/users" className="text-zinc-500 transition hover:text-amber-200/90">
              Users
            </Link>
            <span className="mx-2 text-zinc-700">/</span>
            <span>Profile</span>
          </p>
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          {displayName}
        </h1>
        {secondaryEmail ? (
          <p className="mt-1 text-sm text-zinc-500">{secondaryEmail}</p>
        ) : null}
        <p className="mt-3 text-zinc-400">
          {filtersActive ? (
            <>
              Showing {filteredPrompts.length} prompt{filteredPrompts.length === 1 ? "" : "s"} ·{" "}
              {filteredFeedback.length} feedback record{filteredFeedback.length === 1 ? "" : "s"}
              <span className="text-zinc-600">
                {" "}
                (of {prompts.length} · {feedback.length} total)
              </span>
            </>
          ) : (
            <>
              {prompts.length} prompt{prompts.length === 1 ? "" : "s"} · {feedback.length} feedback
              record{feedback.length === 1 ? "" : "s"}
            </>
          )}
        </p>
        {parsed.kind === "id" ? (
          <p className="mt-2">
            <Link
              href={libraryHref(parsed)}
              className="text-sm text-amber-200/90 underline-offset-2 hover:underline"
            >
              Open prompt library filtered to this author
            </Link>
          </p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
        <p className="mb-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          Filters
        </p>
        <form method="get" action={profilePath} className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>Environment</span>
            <select
              name="env"
              defaultValue={envFilter}
              className="min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All environments</option>
              {envOptions.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>Record type</span>
            <select
              name="records"
              defaultValue={recordFilter}
              className="min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All types</option>
              <option value="prompts">Prompts only</option>
              <option value="feedback">Feedback only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>Sort by</span>
            <select
              name="sort"
              defaultValue={sortKey}
              className="min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="created-desc">Newest first</option>
              <option value="created-asc">Oldest first</option>
              <option value="score-worst">Score (worst → best)</option>
              <option value="score-best">Score (best → worst)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>
              Prompt status
              <span className="ml-1 text-zinc-600">(prompts only)</span>
            </span>
            <select
              name="taskStatus"
              defaultValue={promptStatusFilter}
              className="min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value={TASK_LIFECYCLE_ALL}>All statuses</option>
              {hasUnsetPrompt ? (
                <option value={TASK_LIFECYCLE_UNSET_QUERY}>
                  No status (legacy)
                </option>
              ) : null}
              {promptStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {taskLifecycleFilterShortLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200"
          >
            Apply
          </button>
          {filtersActive ? (
            <Link
              href={profilePath}
              className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </form>
      </section>

      {filteredPrompts.length > 0 || filteredFeedback.length > 0 ? (
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5 text-sm text-zinc-500">
              Loading coaching tools…
            </section>
          }
        >
          <UserCoachingPanel
            userKeyCanonical={canonicalUserKey}
            initialSavedPayload={initialSavedPayload}
            initialSavedRowUpdatedAtIso={
              savedCoachingRow?.updatedAt.toISOString() ?? null
            }
          />
        </Suspense>
      ) : null}

      {filteredPrompts.length === 0 && filteredFeedback.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-14 text-center text-zinc-500">
          No records match the current filters. Adjust environment or record type, or{" "}
          <Link href={profilePath} className="text-amber-200/90 hover:underline">
            clear filters
          </Link>
          .
        </section>
      ) : null}

      {authoredPromptFlags.length > 0 || flaggedFeedback.length > 0 ? (
        <section className="rounded-2xl border border-amber-900/50 bg-amber-950/15 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-amber-50/95">
                Bugged / escalated task signals
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-amber-100/75">
                Tasks are identified by lifecycle state{" "}
                <code className="text-amber-100/90">bugged</code> or{" "}
                <code className="text-amber-100/90">escalated-fleet-review</code>. Feedback
                rows are matched to those tasks by task key/id.
              </p>
            </div>
            <div className="grid min-w-[min(100%,28rem)] gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-amber-900/50 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-100/60">
                  Authored tasks
                </p>
                <p className="mt-1 text-2xl font-semibold text-amber-50">
                  {authoredPromptFlags.length}
                </p>
                <p className="mt-1 text-xs text-amber-100/55">
                  {buggedAuthoredCount} bugged · {escalatedAuthoredCount} escalated
                </p>
              </div>
              <div className="rounded-xl border border-amber-900/50 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-100/60">
                  Feedback on flagged tasks
                </p>
                <p className="mt-1 text-2xl font-semibold text-amber-50">
                  {flaggedFeedback.length}
                </p>
                <p className="mt-1 text-xs text-amber-100/55">
                  {buggedFeedbackCount} bugged · {escalatedFeedbackCount} escalated
                </p>
              </div>
              <div className="rounded-xl border border-amber-900/50 bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-100/60">
                  Feedback rate
                </p>
                <p className="mt-1 text-2xl font-semibold text-amber-50">
                  {flaggedFeedbackRate == null ? "—" : `${flaggedFeedbackRate}%`}
                </p>
                <p className="mt-1 text-xs text-amber-100/55">
                  {flaggedFeedback.length}/{feedbackEnv.length} rows in env scope
                </p>
              </div>
            </div>
          </div>

          {flaggedFeedback.length > 0 ? (
            <details className="mt-5 rounded-xl border border-amber-900/40 bg-zinc-950/40 p-4">
              <summary className="cursor-pointer text-sm font-medium text-amber-100/90">
                Review feedback on flagged tasks ({flaggedFeedback.length})
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-amber-100/55">
                    <tr className="border-b border-amber-900/40">
                      <th className="py-2 pr-3 font-medium">Task</th>
                      <th className="py-2 pr-3 font-medium">Flag</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                      <th className="py-2 pr-3 font-medium">Feedback excerpt</th>
                    </tr>
                  </thead>
                  <tbody className="text-amber-100/80">
                    {flaggedFeedback.slice(0, 50).map(({ row, flag }) => (
                      <tr key={row.id} className="border-b border-amber-900/25 last:border-0">
                        <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-amber-100/65">
                          {row.taskKey ?? row.taskId ?? "unknown"}
                        </td>
                        <td className="py-2 pr-3">{taskFlagLabel(flag)}</td>
                        <td className="py-2 pr-3">{scoreLabel(row.score)}</td>
                        <td className="py-2 pr-3 text-amber-100/55">
                          {new Date(row.createdAt).toLocaleDateString()}
                        </td>
                        <td className="max-w-[28rem] truncate py-2 pr-3 text-amber-100/70">
                          {row.body}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {filteredPrompts.length > 0 ? (
        <section>
          <h2 className="mb-4 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Prompts
          </h2>
          <ul className="flex flex-col gap-4">
            {filteredPrompts.map((p) => {
              const flag = flagInfoForLifecycle(p.taskLifecycleStatus);
              return (
                <li
                  key={p.id}
                  className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-3 py-0.5 text-xs uppercase ${scoreClass(p.score)}`}
                    >
                      {scoreLabel(p.score)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadgeClass(p.taskLifecycleStatus)}`}
                      title="task_lifecycle_status from import metadata"
                    >
                      {p.taskLifecycleStatus?.trim()
                        ? taskLifecycleFilterShortLabel(
                            p.taskLifecycleStatus.trim().toLowerCase(),
                          )
                        : "No status"}
                    </span>
                    {flag ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadgeClass(p.taskLifecycleStatus)}`}
                      >
                        Flagged task
                      </span>
                    ) : null}
                    {p.envKey ? (
                      <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-300">
                        {p.envKey}
                      </span>
                    ) : null}
                    <span className="text-xs text-zinc-500">{p.guideline.name}</span>
                  </div>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 text-[13px] text-zinc-200">
                    {p.body}
                  </pre>
                  {p.rationale ? (
                    <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm text-zinc-400">
                      <span className="font-medium text-zinc-300">Model note: </span>
                      {p.rationale}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-zinc-600">
                    Added {new Date(p.createdAt).toLocaleString()}
                    {p.analyzedAt ? ` · Scored ${new Date(p.analyzedAt).toLocaleString()}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {filteredFeedback.length > 0 ? (
        <section>
          <h2 className="mb-4 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Feedback
          </h2>
          <ul className="flex flex-col gap-4">
            {filteredFeedback.map((f) => {
              const flag = feedbackFlagInfo(f, flaggedTaskIndex);
              return (
                <li
                  key={f.id}
                  className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-3 py-0.5 text-xs uppercase ${scoreClass(f.score)}`}
                    >
                      {scoreLabel(f.score)}
                    </span>
                    {f.projectKey?.trim() ? (
                      <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[11px] text-sky-300/90">
                        {f.projectKey}
                      </span>
                    ) : null}
                    {f.envKey ? (
                      <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-300">
                        {f.envKey}
                      </span>
                    ) : null}
                    {flag ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadgeClass(
                          flag.lifecycleStatus,
                        )}`}
                        title={`Linked task is ${flag.lifecycleStatus}`}
                      >
                        {taskFlagLabel(flag)}
                      </span>
                    ) : null}
                    {f.taskKey ? (
                      <span className="font-[family-name:var(--font-mono)] text-[11px] text-zinc-500">
                        {f.taskKey}
                      </span>
                    ) : null}
                  </div>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 text-[13px] text-zinc-200">
                    {f.body}
                  </pre>
                  {f.rationale ? (
                    <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm text-zinc-400">
                      <span className="font-medium text-zinc-300">Model note: </span>
                      {f.rationale}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-zinc-600">
                    Added {new Date(f.createdAt).toLocaleString()}
                    {f.analyzedAt ? ` · Scored ${new Date(f.analyzedAt).toLocaleString()}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-zinc-600">
        <Link href="/users" className="text-amber-200/90 hover:underline">
          ← Back to all users
        </Link>
      </p>
    </div>
  );
}
