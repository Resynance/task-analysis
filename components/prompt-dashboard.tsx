"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { SortKey, SortOrder } from "@/lib/sort-prompts";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";
import {
  type EnvFilter,
  getEnvironmentLabel,
  getEnvFilterShortLabel,
  parseEnvFilter,
  serializeEnvQueryValue,
} from "@/lib/task-environment";
import {
  serializeTaskLifecycleQueryValue,
  taskLifecycleFilterShortLabel,
  type TaskLifecycleFilter,
  type TaskLifecycleOption,
} from "@/lib/task-lifecycle-filter";
import {
  getProjectFilterShortLabel,
  parseProjectFilter,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";
import { UNKNOWN_CREATOR_LABEL } from "@/lib/explore/creator-from-extra";
import type { PromptAnalysisClarification } from "@/lib/prompt-analysis-clarification";
import { PromptRowClarifyPanel } from "@/components/prompt-row-clarify-panel";

const BATCH_EXTRA_INSTRUCTIONS_MAX = 8000;

type GuidelineOption = {
  id: string;
  name: string;
};

export type PromptRow = {
  id: string;
  body: string;
  guidelineId: string;
  score: "EXCELLENT" | "AVERAGE" | "POOR" | "PRUNED" | null;
  rationale: string | null;
  analyzedAt: string | null;
  createdAt: string;
  guideline: GuidelineOption;
  sourceKey?: string | null;
  sourceId?: string | null;
  projectKey?: string | null;
  envKey?: string | null;
  taskModality?: string | null;
  sourceCreated?: string | null;
  creatorLabel?: string;
  analysisClarification?: PromptAnalysisClarification | null;
  /** False when lifecycle is set and not production (rubric analysis is skipped). */
  eligibleForLlmAnalysis?: boolean;
  /** From import metadata (`task_lifecycle_status`). */
  taskLifecycleStatus?: string | null;
};

function PromptAuthorBadge({ label }: { label?: string }) {
  if (!label || label === UNKNOWN_CREATOR_LABEL) return null;
  return (
    <span
      className="max-w-[min(100%,18rem)] shrink-0 truncate text-xs text-zinc-300"
      title={`Author: ${label}`}
    >
      <span className="font-medium text-zinc-500">Author</span>
      <span className="text-zinc-600"> · </span>
      {label}
    </span>
  );
}

function scoreLabel(score: PromptRow["score"]) {
  if (!score) return "Not analyzed";
  switch (score) {
    case "EXCELLENT":
      return "Excellent";
    case "AVERAGE":
      return "Average";
    case "POOR":
      return "Poor";
    case "PRUNED":
      return "Pruned";
    default:
      return "—";
  }
}

function scoreClass(score: PromptRow["score"]) {
  if (!score) {
    return "bg-zinc-800/80 text-zinc-400 border-zinc-700";
  }
  if (score === "EXCELLENT") {
    return "bg-emerald-950/60 text-emerald-200 border-emerald-800/80";
  }
  if (score === "AVERAGE") {
    return "bg-amber-950/50 text-amber-200 border-amber-800/70";
  }
  if (score === "PRUNED") {
    return "bg-zinc-700/60 text-zinc-200 border-zinc-600/80";
  }
  return "bg-rose-950/50 text-rose-200 border-rose-800/70";
}

export function PromptDashboard(props: {
  prompts: PromptRow[];
  guidelines: GuidelineOption[];
  sort: SortKey;
  order: SortOrder;
  projectFilter: ProjectFilter;
  /** Distinct import sources (JSON basenames) plus All / legacy bucket. */
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  /** Populated from current prompts so new environments appear after ingest. */
  envFilterOptions: EnvFilter[];
  /** When non-empty, library and batch are limited to these guideline ids. */
  guidelineFilterIds: string[];
  groupByUser: boolean;
  /** Non-empty: filter by author display name or user id (`users/users.json` resolves names). */
  authorSearchQuery: string;
  /** Non-empty: library filtered to prompts whose body contains this substring (case-insensitive). */
  promptSearchQuery: string;
  /** Import lifecycle (`extra.task_lifecycle_status`). */
  taskLifecycleFilter: TaskLifecycleFilter;
  lifecycleFilterOptions: TaskLifecycleOption[];
  libraryPage: number;
  libraryPerPage: number;
  libraryTotalFiltered: number;
  libraryTotalPages: number;
  scoredInScope: number;
  pendingInScope: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchLive, setBatchLive] = useState<{
    total: number;
    current: number;
    ok: number;
    fail: number;
    lastLabel: string;
  } | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    ok: number;
    fail: number;
    total: number;
  } | null>(null);
  const [includeScoredInBatch, setIncludeScoredInBatch] = useState(false);
  const [stopNotice, setStopNotice] = useState<string | null>(null);
  const [authorSearchDraft, setAuthorSearchDraft] = useState(
    props.authorSearchQuery,
  );
  const [promptSearchDraft, setPromptSearchDraft] = useState(
    props.promptSearchQuery,
  );
  /** Scope controls (env / rubrics); primary actions stay on the summary row. */
  const [batchScopeExpanded, setBatchScopeExpanded] = useState(false);
  const [batchExtraInstructions, setBatchExtraInstructions] = useState("");
  const batchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep draft in sync with URL-driven query
    setAuthorSearchDraft(props.authorSearchQuery);
  }, [props.authorSearchQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep draft in sync with URL-driven query
    setPromptSearchDraft(props.promptSearchQuery);
  }, [props.promptSearchQuery]);

  const pendingCount = props.pendingInScope;
  const scoredCount = props.scoredInScope;

  const batchTargetCount = includeScoredInBatch
    ? props.libraryTotalFiltered
    : pendingCount;

  const groupedPrompts = useMemo(() => {
    const map = new Map<string, PromptRow[]>();
    for (const p of props.prompts) {
      const label = p.creatorLabel?.trim() || "(unknown creator)";
      const list = map.get(label) ?? [];
      list.push(p);
      map.set(label, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
      .map(([creatorLabel, prompts]) => ({ creatorLabel, prompts }));
  }, [props.prompts]);

  function mergeSearchParams(): URLSearchParams {
    return new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
  }

  function resetLibraryPageParam(params: URLSearchParams) {
    params.delete("page");
  }

  function applySort(sort: SortKey, order: SortOrder) {
    const params = mergeSearchParams();
    params.set("sort", sort);
    params.set("order", order);
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyProjectFilter(next: ProjectFilter) {
    const params = mergeSearchParams();
    if (next === "all") {
      params.delete("project");
    } else {
      params.set("project", serializeProjectQueryValue(next));
    }
    params.delete("env");
    params.delete("taskStatus");
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyEnvFilter(next: EnvFilter) {
    const params = mergeSearchParams();
    if (next === "all") {
      params.delete("env");
    } else {
      params.set("env", serializeEnvQueryValue(next));
    }
    params.delete("taskStatus");
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyLifecycleFilter(next: TaskLifecycleFilter) {
    const params = mergeSearchParams();
    const ser = serializeTaskLifecycleQueryValue(next);
    if (ser === "all") {
      params.set("taskStatus", "all");
    } else {
      params.set("taskStatus", ser);
    }
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyGroupByUser(next: boolean) {
    const params = mergeSearchParams();
    if (next) params.set("groupBy", "user");
    else {
      params.delete("groupBy");
    }
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyAuthorSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = mergeSearchParams();
    const q = authorSearchDraft.trim();
    if (q) {
      params.set("authorSearch", q);
      params.delete("user");
    } else {
      params.delete("authorSearch");
      params.delete("user");
    }
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function clearAuthorSearch() {
    setAuthorSearchDraft("");
    const params = mergeSearchParams();
    params.delete("authorSearch");
    params.delete("user");
    resetLibraryPageParam(params);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  function applyPromptSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = mergeSearchParams();
    const q = promptSearchDraft.trim();
    if (q) params.set("promptSearch", q);
    else params.delete("promptSearch");
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function clearPromptSearch() {
    setPromptSearchDraft("");
    const params = mergeSearchParams();
    params.delete("promptSearch");
    resetLibraryPageParam(params);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  function applyLibraryPage(nextPage: number) {
    const params = mergeSearchParams();
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function applyGuidelineFilter(nextIds: string[]) {
    const params = mergeSearchParams();
    const allIds = props.guidelines.map((g) => g.id);
    const isFull =
      allIds.length > 0 &&
      nextIds.length === allIds.length &&
      allIds.every((id) => nextIds.includes(id));
    if (nextIds.length === 0 || isFull) {
      params.delete("guidelines");
    } else {
      params.set("guidelines", nextIds.join(","));
    }
    params.delete("taskStatus");
    resetLibraryPageParam(params);
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  function toggleBatchGuideline(id: string) {
    const all = props.guidelines.map((g) => g.id);
    if (props.guidelineFilterIds.length === 0) {
      applyGuidelineFilter(all.filter((x) => x !== id));
      return;
    }
    const set = new Set(props.guidelineFilterIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    if (next.length === 0 || next.length === all.length) {
      applyGuidelineFilter([]);
      return;
    }
    applyGuidelineFilter(next);
  }

  const batchGuidelineSummary = useMemo(() => {
    if (props.guidelines.length === 0) return "No rubrics";
    if (props.guidelineFilterIds.length === 0) return "All rubrics";
    if (props.guidelineFilterIds.length === 1) {
      const g = props.guidelines.find(
        (x) => x.id === props.guidelineFilterIds[0],
      );
      return g?.name ?? "1 set";
    }
    return `${props.guidelineFilterIds.length} guideline sets`;
  }, [props.guidelineFilterIds, props.guidelines]);

  const insightsHref = useMemo(() => {
    const q = new URLSearchParams();
    if (props.projectFilter !== "all") {
      q.set("project", serializeProjectQueryValue(props.projectFilter));
    }
    if (props.envFilter !== "all") {
      q.set("env", serializeEnvQueryValue(props.envFilter));
    }
    if (props.guidelineFilterIds.length > 0) {
      q.set("guidelines", props.guidelineFilterIds.join(","));
    }
    const s = q.toString();
    return s ? `/reports/insights?${s}` : "/reports/insights";
  }, [
    props.projectFilter,
    props.envFilter,
    props.guidelineFilterIds,
  ]);

  function exportHref(scoredOnly: boolean): string {
    const q = new URLSearchParams();
    if (!scoredOnly) q.set("scoredOnly", "false");
    if (props.projectFilter !== "all") {
      q.set("project", serializeProjectQueryValue(props.projectFilter));
    }
    if (props.envFilter !== "all") {
      q.set("env", serializeEnvQueryValue(props.envFilter));
    }
    if (props.guidelineFilterIds.length > 0) {
      q.set("guidelines", props.guidelineFilterIds.join(","));
    }
    const tls = serializeTaskLifecycleQueryValue(props.taskLifecycleFilter);
    if (tls !== "all") q.set("taskStatus", tls);
    const qs = q.toString();
    return `/api/prompts/export${qs ? `?${qs}` : ""}`;
  }

  const sortControlValue = `${props.sort}:${props.order}`;

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function analyzeOne(id: string) {
    setError(null);
    setAnalyzingId(id);
    try {
      const res = await fetch(`/api/prompts/${id}/analyze`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Analysis failed",
        );
        return;
      }
      requestOpenRouterCreditsRefresh();
      refresh();
    } finally {
      setAnalyzingId(null);
    }
  }

  function stopBatch() {
    batchAbortRef.current?.abort();
  }

  async function analyzeAllPending() {
    setError(null);
    setStopNotice(null);
    setBatchSummary(null);
    setBatchLive(null);
    setBatchRunning(true);
    const ac = new AbortController();
    batchAbortRef.current = ac;

    try {
      const res = await fetch("/api/prompts/analyze-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeScored: includeScoredInBatch,
          project: serializeProjectQueryValue(props.projectFilter),
          environment: serializeEnvQueryValue(props.envFilter),
          guidelineIds: props.guidelineFilterIds,
          ...(serializeTaskLifecycleQueryValue(props.taskLifecycleFilter) !==
          "all"
            ? {
                taskStatus: serializeTaskLifecycleQueryValue(
                  props.taskLifecycleFilter,
                ),
              }
            : {}),
          ...(batchExtraInstructions.trim()
            ? { extraInstructions: batchExtraInstructions.trim() }
            : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string"
            ? data.error
            : "Batch analysis failed",
        );
        return;
      }
      if (!res.body) {
        setError("No response stream from server.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }

          const t = msg.type;
          if (t === "start" && typeof msg.total === "number") {
            setBatchLive({
              total: msg.total,
              current: 0,
              ok: 0,
              fail: 0,
              lastLabel: "",
            });
          }
          if (t === "progress") {
            const ok = Boolean(msg.ok);
            if (ok) {
              requestOpenRouterCreditsRefresh();
            }
            const index = typeof msg.index === "number" ? msg.index : 0;
            const id = typeof msg.id === "string" ? msg.id : "";
            const sourceKey =
              typeof msg.sourceKey === "string" || msg.sourceKey === null
                ? (msg.sourceKey as string | null)
                : null;
            const label =
              sourceKey?.trim() ||
              (id.length > 12 ? `${id.slice(0, 8)}…` : id);
            setBatchLive((prev) =>
              prev
                ? {
                    total: prev.total,
                    current: index,
                    ok: prev.ok + (ok ? 1 : 0),
                    fail: prev.fail + (ok ? 0 : 1),
                    lastLabel: label,
                  }
                : {
                    total: typeof msg.total === "number" ? msg.total : index,
                    current: index,
                    ok: ok ? 1 : 0,
                    fail: ok ? 0 : 1,
                    lastLabel: label,
                  },
            );
          }
          if (t === "cancelled") {
            const okCount =
              typeof msg.okCount === "number" ? msg.okCount : 0;
            const failCount =
              typeof msg.failCount === "number" ? msg.failCount : 0;
            const processedSoFar =
              typeof msg.processedSoFar === "number"
                ? msg.processedSoFar
                : 0;
            setBatchLive(null);
            setBatchSummary({
              ok: okCount,
              fail: failCount,
              total: processedSoFar,
            });
            setStopNotice(
              "Batch stopped. Scores saved for all prompts completed before the stop.",
            );
          }
          if (t === "complete") {
            const okCount =
              typeof msg.okCount === "number" ? msg.okCount : 0;
            const failCount =
              typeof msg.failCount === "number" ? msg.failCount : 0;
            const processed =
              typeof msg.processed === "number" ? msg.processed : 0;
            setBatchLive(null);
            setBatchSummary({
              ok: okCount,
              fail: failCount,
              total: processed,
            });
            if (failCount > 0) {
              setError(
                `${failCount} of ${processed} prompt(s) failed during batch.`,
              );
            }
          }
          if (t === "error" && typeof msg.message === "string") {
            setError(msg.message);
          }
        }
      }

      refresh();
    } catch (e) {
      const aborted =
        e instanceof DOMException && e.name === "AbortError";
      const maybeAbort =
        e instanceof Error &&
        (e.name === "AbortError" || e.message === "The user aborted a request.");
      if (aborted || maybeAbort) {
        setStopNotice(
          "Batch stop requested — connection closed. Items already processed may be scored.",
        );
        refresh();
      } else {
        setError(e instanceof Error ? e.message : "Batch failed");
      }
    } finally {
      setBatchRunning(false);
      batchAbortRef.current = null;
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 px-5 py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800/80 pb-10">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Prompt lab
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Training prompts
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-400">
          Capture candidate prompts, compare them to your rubric with an LLM,
          and review quality tiers before using them in training pipelines.
        </p>
        <aside className="max-w-3xl rounded-xl border border-amber-900/40 bg-amber-950/25 px-4 py-3 text-sm leading-relaxed text-amber-100/90">
          <strong className="font-medium text-amber-200">
            Four evaluation environments
          </strong>{" "}
          — tasks are tagged from their source{" "}
          <code className="text-amber-200/80">env_key</code>:{" "}
          <strong>Funnel</strong>, <strong>Harbor</strong> (research-based),{" "}
          <strong>Quickbooks</strong>, and <strong>Finance-lh</strong>{" "}
          (multi-app). Filter the library and run batch scoring{" "}
          <strong>per environment</strong> so each is rated in its own context.
          Unrecognized keys appear under <strong>Unmapped</strong>.
        </aside>
      </header>

      <section className="w-full">
        <div className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/30 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                aria-expanded={batchScopeExpanded}
                onClick={() => setBatchScopeExpanded((v) => !v)}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-950/80 px-3 py-2 text-left text-sm font-medium text-zinc-200 transition hover:border-amber-700/60 hover:text-amber-100"
              >
                <span
                  className="text-zinc-500"
                  aria-hidden
                >
                  {batchScopeExpanded ? "▼" : "▸"}
                </span>
                Batch analysis
              </button>
              <p className="min-w-0 text-xs leading-snug text-amber-200/75">
                <span className="text-amber-200/90">Scope:</span>{" "}
                {getEnvFilterShortLabel(props.envFilter)}
                <span className="text-amber-200/45"> · </span>
                {taskLifecycleFilterShortLabel(props.taskLifecycleFilter)}
                <span className="text-amber-200/45"> · </span>
                {batchGuidelineSummary}
              </p>
            </div>

            <label className="flex max-w-full cursor-pointer items-center gap-2 text-xs text-zinc-400 lg:max-w-[min(100%,18rem)]">
              <input
                type="checkbox"
                checked={includeScoredInBatch}
                onChange={(e) => setIncludeScoredInBatch(e.target.checked)}
                disabled={batchRunning}
                className="rounded border-zinc-600"
              />
              <span className="leading-snug">
                Re-analyze already scored (uses current guideline text)
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <button
                type="button"
                onClick={analyzeAllPending}
                disabled={batchRunning || batchTargetCount === 0}
                className="rounded-full border border-zinc-600 bg-transparent px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-amber-700/70 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {batchRunning
                  ? "Running…"
                  : includeScoredInBatch
                    ? `Analyze all (${batchTargetCount})`
                    : `Analyze pending (${pendingCount})`}
              </button>
              {batchRunning ? (
                <button
                  type="button"
                  onClick={stopBatch}
                  className="rounded-full border border-rose-800/80 bg-rose-950/40 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-900/50"
                >
                  Stop batch
                </button>
              ) : null}
            </div>
          </div>

          {batchScopeExpanded ? (
            <div className="mt-4 border-t border-zinc-800/90 pt-4">
              <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                Same filters as the library toolbar:{" "}
                <strong className="font-medium text-zinc-400">Project</strong> is
                the JSON import source;{" "}
                <strong className="font-medium text-zinc-400">Environment</strong>{" "}
                matches each task&apos;s{" "}
                <code className="text-zinc-400">env_key</code>;{" "}
                <strong className="font-medium text-zinc-400">Task status</strong>{" "}
                uses import metadata{" "}
                <code className="text-zinc-400">task_lifecycle_status</code>.{" "}
                <strong className="font-medium text-zinc-400">
                  Scoring rubrics
                </strong>{" "}
                narrow which criteria apply (JSON imports still match scope).
              </p>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
                <label className="flex shrink-0 flex-col gap-1.5 text-sm text-zinc-400 lg:w-[min(100%,14rem)]">
                  <span>Project</span>
                  <select
                    value={serializeProjectQueryValue(props.projectFilter)}
                    onChange={(e) =>
                      applyProjectFilter(
                        parseProjectFilter({ project: e.target.value }),
                      )
                    }
                    disabled={batchRunning}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                  >
                    {props.projectFilterOptions.map((opt) => (
                      <option
                        key={serializeProjectQueryValue(opt)}
                        value={serializeProjectQueryValue(opt)}
                      >
                        {getProjectFilterShortLabel(opt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex shrink-0 flex-col gap-1.5 text-sm text-zinc-400 lg:w-[min(100%,14rem)]">
                  <span>Environment</span>
                  <select
                    value={serializeEnvQueryValue(props.envFilter)}
                    onChange={(e) =>
                      applyEnvFilter(parseEnvFilter({ env: e.target.value }))
                    }
                    disabled={batchRunning}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                  >
                    {props.envFilterOptions.map((opt) => (
                      <option
                        key={serializeEnvQueryValue(opt)}
                        value={serializeEnvQueryValue(opt)}
                      >
                        {getEnvFilterShortLabel(opt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex shrink-0 flex-col gap-1.5 text-sm text-zinc-400 lg:w-[min(100%,14rem)]">
                  <span>Task status</span>
                  <select
                    value={serializeTaskLifecycleQueryValue(
                      props.taskLifecycleFilter,
                    )}
                    onChange={(e) =>
                      applyLifecycleFilter(e.target.value as TaskLifecycleFilter)
                    }
                    disabled={batchRunning}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                  >
                    {props.lifecycleFilterOptions.map((opt) => (
                      <option
                        key={`${opt.value}`}
                        value={serializeTaskLifecycleQueryValue(opt.value)}
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {props.guidelines.length > 0 ? (
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Scoring rubrics
                      </span>
                      <button
                        type="button"
                        disabled={batchRunning}
                        onClick={() => applyGuidelineFilter([])}
                        className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-400 transition hover:border-amber-700/60 hover:text-amber-100 disabled:opacity-40"
                      >
                        All sets
                      </button>
                    </div>
                    <div className="flex max-h-36 flex-wrap content-start gap-x-5 gap-y-2 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
                      {props.guidelines.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-zinc-600"
                            checked={
                              props.guidelineFilterIds.length === 0 ||
                              props.guidelineFilterIds.includes(g.id)
                            }
                            disabled={batchRunning}
                            onChange={() => toggleBatchGuideline(g.id)}
                          />
                          <span className="leading-snug">{g.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 w-full min-w-0">
                <label className="mb-1 block text-sm text-zinc-500">
                  Extra criteria{" "}
                  <span className="font-normal text-zinc-600">(optional)</span>
                </label>
                <p className="mb-2 text-xs leading-relaxed text-zinc-600">
                  Applied to every prompt in this batch (same rubric and filters). Use
                  for run-specific emphasis—e.g. stricter scope checks or product
                  priorities.
                </p>
                <textarea
                  value={batchExtraInstructions}
                  onChange={(e) => setBatchExtraInstructions(e.target.value)}
                  placeholder='e.g. Penalize prompts that assume a specific UI path unless the rubric requires it.'
                  rows={3}
                  maxLength={BATCH_EXTRA_INSTRUCTIONS_MAX}
                  disabled={batchRunning}
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-40"
                />
              </div>
            </div>
          ) : null}

          {batchLive && batchLive.total > 0 ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-zinc-800/80 pt-4">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>
                  {batchLive.current} / {batchLive.total}
                </span>
                <span>
                  <span className="text-emerald-400/90">{batchLive.ok} ok</span>
                  {batchLive.fail > 0 ? (
                    <span className="text-rose-400/90">
                      {" "}
                      · {batchLive.fail} failed
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-amber-500/80 transition-[width] duration-150 ease-out"
                  style={{
                    width: `${Math.min(100, (batchLive.current / batchLive.total) * 100)}%`,
                  }}
                />
              </div>
              {batchLive.lastLabel ? (
                <p
                  className="truncate font-[family-name:var(--font-mono)] text-[11px] text-zinc-500"
                  title={batchLive.lastLabel}
                >
                  Last: {batchLive.lastLabel}
                </p>
              ) : null}
            </div>
          ) : null}

          {!batchRunning && batchSummary ? (
            <p className="mt-3 text-sm text-zinc-400">
              Finished:{" "}
              <span className="text-emerald-400/90">{batchSummary.ok}</span>{" "}
              scored
              {batchSummary.fail > 0 ? (
                <>
                  ,{" "}
                  <span className="text-rose-400/90">
                    {batchSummary.fail} failed
                  </span>
                </>
              ) : null}{" "}
              ({batchSummary.total} total).
            </p>
          ) : null}
          {stopNotice ? (
            <p className="mt-2 text-sm text-amber-200/80" role="status">
              {stopNotice}
            </p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-zinc-100">
              Library
            </h2>
            <span className="text-sm text-zinc-500">
              {props.libraryTotalFiltered === 0 ? (
                "0 prompts in this scope"
              ) : (
                <>
                  Showing{" "}
                  {(props.libraryPage - 1) * props.libraryPerPage + 1}
                  –
                  {Math.min(
                    props.libraryPage * props.libraryPerPage,
                    props.libraryTotalFiltered,
                  )}{" "}
                  of {props.libraryTotalFiltered}
                  {scoredCount > 0 ? (
                    <span className="text-zinc-600">
                      {" "}
                      · {scoredCount} scored in scope
                    </span>
                  ) : null}
                  {pendingCount > 0 ? (
                    <span className="text-zinc-600">
                      {" "}
                      · {pendingCount} pending in scope
                    </span>
                  ) : null}
                </>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Project</span>
              <select
                value={serializeProjectQueryValue(props.projectFilter)}
                onChange={(e) =>
                  applyProjectFilter(
                    parseProjectFilter({ project: e.target.value }),
                  )
                }
                className="max-w-[200px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                {props.projectFilterOptions.map((opt) => (
                  <option
                    key={serializeProjectQueryValue(opt)}
                    value={serializeProjectQueryValue(opt)}
                  >
                    {getProjectFilterShortLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Environment</span>
              <select
                value={serializeEnvQueryValue(props.envFilter)}
                onChange={(e) =>
                  applyEnvFilter(parseEnvFilter({ env: e.target.value }))
                }
                className="max-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                {props.envFilterOptions.map((opt) => (
                  <option
                    key={serializeEnvQueryValue(opt)}
                    value={serializeEnvQueryValue(opt)}
                  >
                    {getEnvFilterShortLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Task status</span>
              <select
                value={serializeTaskLifecycleQueryValue(
                  props.taskLifecycleFilter,
                )}
                onChange={(e) =>
                  applyLifecycleFilter(e.target.value as TaskLifecycleFilter)
                }
                className="max-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                {props.lifecycleFilterOptions.map((opt) => (
                  <option
                    key={`lib-${opt.value}`}
                    value={serializeTaskLifecycleQueryValue(opt.value)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {props.guidelines.length > 0 ? (
              <details className="group relative">
                <summary className="cursor-pointer list-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none marker:content-none focus:border-amber-700/80 [&::-webkit-details-marker]:hidden">
                  Scoring rubrics{" "}
                  <span className="text-zinc-500">
                    ({batchGuidelineSummary})
                  </span>
                </summary>
                <div className="absolute right-0 z-50 mt-1 max-h-64 w-[min(100vw-2rem,20rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => applyGuidelineFilter([])}
                      className="text-xs text-amber-200/90 hover:text-amber-100"
                    >
                      All sets
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {props.guidelines.map((g) => (
                      <li key={g.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-zinc-600"
                            checked={
                              props.guidelineFilterIds.length === 0 ||
                              props.guidelineFilterIds.includes(g.id)
                            }
                            onChange={() => toggleBatchGuideline(g.id)}
                          />
                          <span className="leading-snug">{g.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">Sort</span>
              <select
                value={sortControlValue}
                onChange={(e) => {
                  const [s, o] = e.target.value.split(":") as [
                    SortKey,
                    SortOrder,
                  ];
                  applySort(s, o);
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
              >
                <option value="created:desc">Newest first</option>
                <option value="created:asc">Oldest first</option>
                <option value="rating:desc">Rating · high → low</option>
                <option value="rating:asc">Rating · low → high</option>
              </select>
            </label>
            <form
              onSubmit={applyPromptSearch}
              className="flex flex-wrap items-center gap-2 text-sm text-zinc-500"
            >
              <span className="whitespace-nowrap">Prompt text</span>
              <input
                type="search"
                value={promptSearchDraft}
                onChange={(e) => setPromptSearchDraft(e.target.value)}
                placeholder="Contains…"
                autoComplete="off"
                title="Case-insensitive substring match on task prompt body"
                className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Search
              </button>
              {props.promptSearchQuery ? (
                <button
                  type="button"
                  onClick={clearPromptSearch}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:text-zinc-300"
                >
                  Clear
                </button>
              ) : null}
            </form>
            <form
              onSubmit={applyAuthorSearch}
              className="flex flex-wrap items-center gap-2 text-sm text-zinc-500"
            >
              <span className="whitespace-nowrap">Author</span>
              <input
                type="search"
                value={authorSearchDraft}
                onChange={(e) => setAuthorSearchDraft(e.target.value)}
                placeholder="Name or user id…"
                autoComplete="off"
                title="Matches display name from users/users.json or raw created_by id"
                className="w-52 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Search
              </button>
              {props.authorSearchQuery ? (
                <button
                  type="button"
                  onClick={clearAuthorSearch}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:text-zinc-300"
                >
                  Clear
                </button>
              ) : null}
            </form>
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              <input
                type="checkbox"
                checked={props.groupByUser}
                onChange={(e) => applyGroupByUser(e.target.checked)}
                className="rounded border-zinc-600"
              />
              <span>Group by user</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={exportHref(true)}
                className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Export scored CSV
              </a>
              <a
                href={exportHref(false)}
                className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-300"
              >
                Export all CSV
              </a>
              <Link
                href={insightsHref}
                className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Coaching insights
              </Link>
            </div>
          </div>
        </div>

        <ul className="flex flex-col gap-4">
          {props.prompts.length === 0 ? (
            <li className="rounded-xl border border-zinc-800/80 bg-zinc-900/25 px-5 py-10 text-center text-zinc-500">
              No prompts found for this scope.
              {props.promptSearchQuery || props.authorSearchQuery ? (
                <>
                  {" "}
                  {props.promptSearchQuery ? (
                    <>
                      Prompt text filter{" "}
                      <code className="text-zinc-400">{props.promptSearchQuery}</code>
                      {props.authorSearchQuery ? " and " : " "}
                    </>
                  ) : null}
                  {props.authorSearchQuery ? (
                    <>
                      author filter{" "}
                      <code className="text-zinc-400">{props.authorSearchQuery}</code>{" "}
                    </>
                  ) : null}
                  left no results. Try clearing those searches or widening environment and rubric filters.
                </>
              ) : (
                <>
                  {" "}
                  Add one above, or import exports in{" "}
                  <code className="text-zinc-400">Configuration → Ingest data</code>.
                </>
              )}
            </li>
          ) : (
            (props.groupByUser
              ? groupedPrompts.flatMap((group) => [
                  <li
                    key={`group-${group.creatorLabel}`}
                    className="mt-2 border-b border-zinc-800 pb-1 text-sm font-semibold text-zinc-300"
                  >
                    {group.creatorLabel}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      ({group.prompts.length})
                    </span>
                  </li>,
                  ...group.prompts.map((p) => (
                    <li
                      key={p.id}
                      className="group rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.35)] transition hover:border-zinc-700"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-0.5 text-xs font-medium uppercase tracking-wide ${scoreClass(p.score)}`}
                          >
                            {scoreLabel(p.score)}
                          </span>
                          {p.projectKey?.trim() ? (
                            <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300/90">
                              {p.projectKey}
                            </span>
                          ) : null}
                          <span className="rounded-full border border-zinc-700/80 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                            {getEnvironmentLabel(p.envKey)}
                          </span>
                          {p.taskLifecycleStatus ? (
                            <span
                              className="rounded-full border border-amber-900/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/80"
                              title="Imported task lifecycle from dataset metadata"
                            >
                              {p.taskLifecycleStatus}
                            </span>
                          ) : null}
                          <span className="text-xs text-zinc-500">
                            {p.guideline.name}
                          </span>
                          <PromptAuthorBadge label={p.creatorLabel} />
                          {p.projectKey?.trim() || p.envKey || p.taskModality ? (
                            <span className="text-xs text-zinc-600">
                              {[
                                p.projectKey?.trim(),
                                p.envKey,
                                p.taskModality,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                          {p.sourceKey ? (
                            <span
                              className="max-w-[200px] truncate font-[family-name:var(--font-mono)] text-[10px] text-zinc-600"
                              title={p.sourceKey}
                            >
                              {p.sourceKey}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => analyzeOne(p.id)}
                            disabled={
                              analyzingId === p.id ||
                              batchRunning ||
                              p.eligibleForLlmAnalysis === false
                            }
                            title={
                              p.eligibleForLlmAnalysis === false
                                ? "Rubric analysis only runs for tasks in production lifecycle (or legacy imports with no lifecycle field)."
                                : undefined
                            }
                            className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-50"
                          >
                            {analyzingId === p.id
                              ? "Analyzing…"
                              : p.eligibleForLlmAnalysis === false
                                ? "Not production"
                                : p.score
                                  ? "Re-analyze"
                                  : "Run analysis"}
                          </button>
                        </div>
                      </div>
                      <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-zinc-200">
                        {p.body}
                      </pre>
                      {p.rationale ? (
                        <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm leading-relaxed text-zinc-400">
                          <span className="font-medium text-zinc-300">
                            Model note:{" "}
                          </span>
                          {p.rationale}
                        </p>
                      ) : null}
                      <PromptRowClarifyPanel
                        promptId={p.id}
                        rationale={p.rationale}
                        analysisClarification={p.analysisClarification}
                        disabled={
                          batchRunning ||
                          analyzingId === p.id ||
                          p.eligibleForLlmAnalysis === false
                        }
                        onAfterClarify={refresh}
                      />
                      <p className="mt-3 text-xs text-zinc-600">
                        Added{" "}
                        {new Date(p.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {p.analyzedAt
                          ? ` · Scored ${new Date(p.analyzedAt).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}`
                          : ""}
                      </p>
                    </li>
                  )),
                ])
              : props.prompts.map((p) => (
              <li
                key={p.id}
                className="group rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.35)] transition hover:border-zinc-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-3 py-0.5 text-xs font-medium uppercase tracking-wide ${scoreClass(p.score)}`}
                    >
                      {scoreLabel(p.score)}
                    </span>
                    {p.projectKey?.trim() ? (
                      <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300/90">
                        {p.projectKey}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-zinc-700/80 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      {getEnvironmentLabel(p.envKey)}
                    </span>
                    {p.taskLifecycleStatus ? (
                      <span
                        className="rounded-full border border-amber-900/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/80"
                        title="Imported task lifecycle from dataset metadata"
                      >
                        {p.taskLifecycleStatus}
                      </span>
                    ) : null}
                    <span className="text-xs text-zinc-500">
                      {p.guideline.name}
                    </span>
                    <PromptAuthorBadge label={p.creatorLabel} />
                    {p.projectKey?.trim() || p.envKey || p.taskModality ? (
                      <span className="text-xs text-zinc-600">
                        {[p.projectKey?.trim(), p.envKey, p.taskModality]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                    {p.sourceKey ? (
                      <span
                        className="max-w-[200px] truncate font-[family-name:var(--font-mono)] text-[10px] text-zinc-600"
                        title={p.sourceKey}
                      >
                        {p.sourceKey}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => analyzeOne(p.id)}
                      disabled={
                        analyzingId === p.id ||
                        batchRunning ||
                        p.eligibleForLlmAnalysis === false
                      }
                      title={
                        p.eligibleForLlmAnalysis === false
                          ? "Rubric analysis only runs for tasks in production lifecycle (or legacy imports with no lifecycle field)."
                          : undefined
                      }
                      className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-50"
                    >
                      {analyzingId === p.id
                        ? "Analyzing…"
                        : p.eligibleForLlmAnalysis === false
                          ? "Not production"
                          : p.score
                            ? "Re-analyze"
                            : "Run analysis"}
                    </button>
                  </div>
                </div>
                <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-zinc-200">
                  {p.body}
                </pre>
                {p.rationale ? (
                  <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm leading-relaxed text-zinc-400">
                    <span className="font-medium text-zinc-300">
                      Model note:{" "}
                    </span>
                    {p.rationale}
                  </p>
                ) : null}
                <PromptRowClarifyPanel
                  promptId={p.id}
                  rationale={p.rationale}
                  analysisClarification={p.analysisClarification}
                  disabled={
                    batchRunning ||
                    analyzingId === p.id ||
                    p.eligibleForLlmAnalysis === false
                  }
                  onAfterClarify={refresh}
                />
                <p className="mt-3 text-xs text-zinc-600">
                  Added{" "}
                  {new Date(p.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {p.analyzedAt
                    ? ` · Scored ${new Date(p.analyzedAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : ""}
                </p>
              </li>
            )))
          )}
        </ul>

        {props.libraryTotalPages > 1 ? (
          <nav
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-4"
            aria-label="Library pagination"
          >
            <button
              type="button"
              disabled={props.libraryPage <= 1}
              onClick={() => applyLibraryPage(props.libraryPage - 1)}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Previous
            </button>
            <span className="text-sm tabular-nums text-zinc-500">
              Page {props.libraryPage} of {props.libraryTotalPages}
            </span>
            <button
              type="button"
              disabled={props.libraryPage >= props.libraryTotalPages}
              onClick={() => applyLibraryPage(props.libraryPage + 1)}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-amber-700/70 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Next
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
