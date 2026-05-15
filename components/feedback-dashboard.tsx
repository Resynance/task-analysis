"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { PromptScore } from "@/generated/prisma/enums";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";
import {
  type EnvFilter,
  getEnvFilterShortLabel,
  parseEnvFilter,
  serializeEnvQueryValue,
} from "@/lib/task-environment";
import {
  getProjectFilterShortLabel,
  parseProjectFilter,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";

type GuidelineOption = { id: string; name: string };

export type FeedbackRow = {
  id: string;
  body: string;
  score: PromptScore | null;
  rationale: string | null;
  analyzedAt: string | null;
  createdAt: string;
  sourceFeedbackId: string;
  taskKey: string | null;
  projectKey: string;
  envKey: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

type SortField = "createdAt" | "score";
type SortDirection = "desc" | "asc";

function scoreLabel(score: PromptScore | null): string {
  if (!score) return "Not analyzed";
  if (score === "EXCELLENT") return "Excellent";
  if (score === "AVERAGE") return "Average";
  if (score === "POOR") return "Poor";
  return score;
}

function scoreClass(score: PromptScore | null): string {
  if (!score) return "bg-zinc-800/80 text-zinc-400 border-zinc-700";
  if (score === "EXCELLENT") {
    return "bg-emerald-950/60 text-emerald-200 border-emerald-800/80";
  }
  if (score === "AVERAGE") {
    return "bg-amber-950/50 text-amber-200 border-amber-800/70";
  }
  return "bg-rose-950/50 text-rose-200 border-rose-800/70";
}

function getAuthorLabel(row: FeedbackRow): string {
  return (
    row.createdByName?.trim() ||
    row.createdByEmail?.trim() ||
    row.createdById?.trim() ||
    "Unknown user"
  );
}

function toCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function FeedbackDashboard(props: {
  rows: FeedbackRow[];
  guidelines: GuidelineOption[];
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  bodySearchQuery: string;
  selectedGuidelineId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [runningOne, setRunningOne] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [batchLive, setBatchLive] = useState<{
    total: number;
    current: number;
    ok: number;
    fail: number;
    lastLabel: string;
  } | null>(null);
  const [searchDraft, setSearchDraft] = useState(props.bodySearchQuery);
  const [selectedUserFilter, setSelectedUserFilter] = useState("");
  const [selectedViewEnvFilter, setSelectedViewEnvFilter] = useState("all");
  const [groupByUser, setGroupByUser] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [analysisExtraInstructions, setAnalysisExtraInstructions] = useState("");
  const [reanalyzeScored, setReanalyzeScored] = useState(false);
  const [conductAnalysisOpen, setConductAnalysisOpen] = useState(true);
  const [viewFiltersOpen, setViewFiltersOpen] = useState(true);

  const selectedGuidelineId =
    props.selectedGuidelineId ?? props.guidelines[0]?.id ?? null;

  const pendingCount = useMemo(
    () => props.rows.filter((r) => r.score == null).length,
    [props.rows],
  );

  const userOptions = useMemo(() => {
    const users = new Set<string>();
    for (const r of props.rows) {
      users.add(getAuthorLabel(r));
    }
    return Array.from(users).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [props.rows]);

  const viewEnvOptions = useMemo(() => {
    const envs = new Set<string>();
    for (const r of props.rows) {
      const env = r.envKey?.trim();
      if (env) envs.add(env);
    }
    return Array.from(envs).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [props.rows]);

  const filteredRows = useMemo(() => {
    const userQuery = selectedUserFilter.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (selectedViewEnvFilter !== "all" && (r.envKey ?? "") !== selectedViewEnvFilter) {
        return false;
      }
      if (!userQuery) return true;
      const userLabel = getAuthorLabel(r);
      return userLabel.toLowerCase().includes(userQuery);
    });
  }, [props.rows, selectedUserFilter, selectedViewEnvFilter]);

  const sortedRows = useMemo(() => {
    const scoreOrder: Record<PromptScore, number> = {
      EXCELLENT: 3,
      AVERAGE: 2,
      POOR: 1,
      PRUNED: 0,
    };

    const rows = [...filteredRows].sort((a, b) => {
      if (sortField === "createdAt") {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return sortDirection === "asc" ? aTime - bTime : bTime - aTime;
      }

      const aScore = a.score ? scoreOrder[a.score] : 0;
      const bScore = b.score ? scoreOrder[b.score] : 0;
      return sortDirection === "asc" ? aScore - bScore : bScore - aScore;
    });

    return rows;
  }, [filteredRows, sortDirection, sortField]);

  const groupedRows = useMemo(() => {
    const buckets = new Map<string, FeedbackRow[]>();
    for (const row of sortedRows) {
      const userKey = getAuthorLabel(row);
      const current = buckets.get(userKey);
      if (current) current.push(row);
      else buckets.set(userKey, [row]);
    }

    return Array.from(buckets.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [sortedRows]);

  function mergeParams(): URLSearchParams {
    return new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
  }

  function pushWithParams(params: URLSearchParams) {
    const qs = params.toString();
    router.push(qs ? `/feedback?${qs}` : "/feedback", { scroll: false });
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function applyProjectFilter(next: ProjectFilter) {
    const p = mergeParams();
    if (next === "all") p.delete("project");
    else p.set("project", serializeProjectQueryValue(next));
    p.delete("env");
    pushWithParams(p);
  }

  function applyEnvFilter(next: EnvFilter) {
    const p = mergeParams();
    if (next === "all") p.delete("env");
    else p.set("env", serializeEnvQueryValue(next));
    pushWithParams(p);
  }

  function applyGuideline(gid: string) {
    const p = mergeParams();
    if (!gid) p.delete("guideline");
    else p.set("guideline", gid);
    pushWithParams(p);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    const p = mergeParams();
    const q = searchDraft.trim();
    if (q) p.set("q", q);
    else p.delete("q");
    pushWithParams(p);
  }

  function analysisRequestBody(): { guidelineId: string; extraInstructions?: string } {
    const extra = analysisExtraInstructions.trim();
    return extra.length > 0
      ? { guidelineId: selectedGuidelineId!, extraInstructions: extra }
      : { guidelineId: selectedGuidelineId! };
  }

  async function analyzeOne(id: string) {
    if (!selectedGuidelineId) {
      setError("Pick a guideline set first.");
      return;
    }
    setError(null);
    setRunningOne(id);
    try {
      const res = await fetch(`/api/feedback/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysisRequestBody()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Analysis failed");
        return;
      }
      requestOpenRouterCreditsRefresh();
      refresh();
    } finally {
      setRunningOne(null);
    }
  }

  async function analyzeBatch() {
    if (!selectedGuidelineId) {
      setError("Pick a guideline set first.");
      return;
    }
    setError(null);
    setBatchSummary(null);
    setBatchLive(null);
    setBatchRunning(true);
    try {
      const res = await fetch("/api/feedback/analyze-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...analysisRequestBody(),
          project: serializeProjectQueryValue(props.projectFilter),
          environment: serializeEnvQueryValue(props.envFilter),
          includeScored: reanalyzeScored,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Batch failed");
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
          if (t === "complete") {
            const okCount =
              typeof msg.okCount === "number" ? msg.okCount : 0;
            const failCount =
              typeof msg.failCount === "number" ? msg.failCount : 0;
            const processed =
              typeof msg.processed === "number" ? msg.processed : 0;
            setBatchLive(null);
            setBatchSummary(
              `Processed ${processed}: ${okCount} ok, ${failCount} failed.`,
            );
            if (failCount > 0) {
              setError(
                `${failCount} of ${processed} feedback row(s) failed during batch.`,
              );
            } else {
              setError(null);
            }
          }
          if (t === "error" && typeof msg.message === "string") {
            setError(msg.message);
          }
        }
      }

      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch failed");
    } finally {
      setBatchRunning(false);
    }
  }

  function exportCurrentResultsToCsv() {
    const headers = [
      "user",
      "project",
      "environment",
      "datetime",
      "task_key",
      "score",
      "feedback provided",
      "model note",
    ];

    const lines = [
      headers.map(toCsvCell).join(","),
      ...sortedRows.map((row) =>
        [
          getAuthorLabel(row),
          row.projectKey ?? "",
          row.envKey ?? "",
          row.createdAt,
          row.taskKey ?? "",
          row.score ?? "NOT_ANALYZED",
          row.body,
          row.rationale ?? "",
        ]
          .map((v) => toCsvCell(String(v)))
          .join(","),
      ),
    ];

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `feedback-results-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportCurrentResultsToPdfReport() {
    const generatedAt = new Date();
    const rowsHtml = sortedRows
      .map(
        (row) => `
          <tr>
            <td>${toHtml(getAuthorLabel(row))}</td>
            <td>${toHtml(row.projectKey ?? "")}</td>
            <td>${toHtml(row.envKey ?? "")}</td>
            <td>${toHtml(row.createdAt)}</td>
            <td>${toHtml(row.taskKey ?? "")}</td>
            <td>${toHtml(row.score ?? "NOT_ANALYZED")}</td>
            <td>${toHtml(row.body)}</td>
            <td>${toHtml(row.rationale ?? "")}</td>
          </tr>
        `,
      )
      .join("");

    const reportHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Feedback Analysis Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .meta { color: #4b5563; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td {
        border: 1px solid #d1d5db;
        padding: 6px 8px;
        font-size: 11px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
        white-space: pre-wrap;
      }
      th { background: #f3f4f6; font-weight: 700; }
      @page { size: A4 landscape; margin: 12mm; }
      @media print {
        body { margin: 0; }
        tr { page-break-inside: avoid; }
        thead { display: table-header-group; }
      }
    </style>
  </head>
  <body>
    <h1>Feedback Analysis Report</h1>
    <div class="meta">Generated: ${toHtml(generatedAt.toLocaleString())} • Rows: ${sortedRows.length}</div>
    <table>
      <thead>
        <tr>
          <th>user</th>
          <th>project</th>
          <th>environment</th>
          <th>datetime</th>
          <th>task_key</th>
          <th>score</th>
          <th>feedback provided</th>
          <th>model note</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <script>
      window.addEventListener('load', () => {
        window.focus();
        window.print();
      });
    </script>
  </body>
</html>`;

    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8;" });
    const reportUrl = URL.createObjectURL(blob);
    const win = window.open(reportUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(reportUrl);
      setError("Pop-up blocked. Allow pop-ups to export the PDF report.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(reportUrl), 20000);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          QA feedback
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Feedback analysis
        </h1>
        <p className="mt-3 text-zinc-400">
          Analyze QA reviewer feedback quality against a selected guideline set.
          Scope matches prompts: choose a <strong className="font-medium text-zinc-300">project</strong>{" "}
          (folder under <code className="text-zinc-500">feedback/</code>, e.g.{" "}
          <code className="text-zinc-500">samples</code> or a project subfolder) and an{" "}
          <strong className="font-medium text-zinc-300">evaluation environment</strong> (CSV filename /
          <code className="text-zinc-500">env_key</code>).
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
        <div className="border-b border-zinc-800/80 pb-4">
          <button
            type="button"
            onClick={() => setConductAnalysisOpen((o) => !o)}
            aria-expanded={conductAnalysisOpen}
            className="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left hover:bg-zinc-800/30"
          >
            <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              Conduct analysis
            </span>
            <svg
              aria-hidden
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${conductAnalysisOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {conductAnalysisOpen ? (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-zinc-500">
                  <span>Project</span>
                  <select
                    value={serializeProjectQueryValue(props.projectFilter)}
                    onChange={(e) =>
                      applyProjectFilter(
                        parseProjectFilter({ project: e.target.value }),
                      )
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
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
                  <span>Environment</span>
                  <select
                    value={serializeEnvQueryValue(props.envFilter)}
                    onChange={(e) => applyEnvFilter(parseEnvFilter({ env: e.target.value }))}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                  >
                    {props.envFilterOptions.map((opt) => (
                      <option key={serializeEnvQueryValue(opt)} value={serializeEnvQueryValue(opt)}>
                        {getEnvFilterShortLabel(opt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-500">
                  <span>Analyze against</span>
                  <select
                    value={selectedGuidelineId ?? ""}
                    onChange={(e) => applyGuideline(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                  >
                    {props.guidelines.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex max-w-md items-start gap-2 text-sm text-zinc-500">
                  <input
                    type="checkbox"
                    checked={reanalyzeScored}
                    onChange={(e) => setReanalyzeScored(e.target.checked)}
                    className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900"
                  />
                  <span>
                    <span className="font-medium text-zinc-400">Re-analyze scored feedback</span>
                    <span className="mt-0.5 block text-xs font-normal text-zinc-600">
                      Runs the model again for items that already have a score—useful when guidelines
                      change. Uses the analysis project and environment above.
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={analyzeBatch}
                  disabled={batchRunning || (!reanalyzeScored && pendingCount === 0)}
                  className="ml-auto rounded-full border border-zinc-600 px-4 py-2 text-sm text-zinc-200 disabled:opacity-40"
                >
                  {batchRunning
                    ? "Running…"
                    : reanalyzeScored
                      ? "Re-analyze all in scope"
                      : `Analyze pending in scope (${pendingCount})`}
                </button>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm text-zinc-500">
                  Extra instructions{" "}
                  <span className="font-normal text-zinc-600">(optional)</span>
                </label>
                <textarea
                  value={analysisExtraInstructions}
                  onChange={(e) => setAnalysisExtraInstructions(e.target.value)}
                  placeholder="e.g. weight clarity over brevity; flag feedback that lacks a concrete next step."
                  rows={3}
                  maxLength={8000}
                  disabled={batchRunning || runningOne !== null}
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-40"
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setViewFiltersOpen((o) => !o)}
            aria-expanded={viewFiltersOpen}
            className="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left hover:bg-zinc-800/30"
          >
            <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              View filters
            </span>
            <svg
              aria-hidden
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${viewFiltersOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {viewFiltersOpen ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <form onSubmit={applySearch} className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Feedback text</span>
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Contains…"
                  className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                />
                <button className="rounded-lg border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-300">
                  Search
                </button>
              </form>
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Environment (narrow)</span>
                <select
                  value={selectedViewEnvFilter}
                  onChange={(e) => setSelectedViewEnvFilter(e.target.value)}
                  className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                >
                  <option value="all">All in URL scope</option>
                  {viewEnvOptions.map((env) => (
                    <option key={env} value={env}>
                      {env}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <span>User</span>
                <input
                  type="search"
                  list="feedback-user-options"
                  value={selectedUserFilter}
                  onChange={(e) => setSelectedUserFilter(e.target.value)}
                  placeholder="Select or search user…"
                  className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                />
                <datalist id="feedback-user-options">
                  {userOptions.map((user) => (
                    <option key={user} value={user} />
                  ))}
                </datalist>
              </label>
              <label className="flex h-[34px] items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={groupByUser}
                  onChange={(e) => setGroupByUser(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900"
                />
                <span className="whitespace-nowrap text-sm">Group by user (A-Z)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Sort by</span>
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                >
                  <option value="createdAt">Created date</option>
                  <option value="score">Score</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Order</span>
                <select
                  value={sortDirection}
                  onChange={(e) => setSortDirection(e.target.value as SortDirection)}
                  className="w-36 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </label>
              <button
                type="button"
                onClick={exportCurrentResultsToCsv}
                className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={exportCurrentResultsToPdfReport}
                className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200"
              >
                Export PDF report
              </button>
            </div>
          ) : null}
        </div>
        {batchRunning || runningOne ? (
          <div className="mt-3 rounded-xl border border-blue-900/70 bg-blue-950/30 p-3">
            {batchRunning && batchLive ? (
              batchLive.total === 0 ? (
                <p className="text-xs text-blue-200">
                  No feedback rows to analyze in this scope.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200">
                    <span>
                      Processed{" "}
                      <strong className="font-semibold text-blue-100">
                        {batchLive.current}
                      </strong>{" "}
                      of{" "}
                      <strong className="font-semibold text-blue-100">
                        {batchLive.total}
                      </strong>
                      {batchLive.total > batchLive.current ? (
                        <span className="text-blue-300/85">
                          {" "}
                          · {batchLive.total - batchLive.current} remaining
                        </span>
                      ) : null}
                    </span>
                    <span className="text-blue-300/90">
                      <span className="text-emerald-400/90">{batchLive.ok} ok</span>
                      {batchLive.fail > 0 ? (
                        <span className="text-rose-400/90">
                          {" "}
                          · {batchLive.fail} failed
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-500/85 transition-[width] duration-150 ease-out"
                      style={{
                        width: `${Math.min(
                          100,
                          (batchLive.current / batchLive.total) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  {batchLive.lastLabel ? (
                    <p
                      className="mt-2 truncate font-[family-name:var(--font-mono)] text-[11px] text-blue-300/70"
                      title={batchLive.lastLabel}
                    >
                      Last: {batchLive.lastLabel}
                    </p>
                  ) : null}
                </>
              )
            ) : batchRunning ? (
              <p className="text-xs text-blue-200">Starting batch analysis…</p>
            ) : (
              <p className="text-xs text-blue-200">
                Analysis running for selected feedback…
              </p>
            )}
          </div>
        ) : null}
        {batchSummary ? <p className="mt-3 text-sm text-zinc-400">{batchSummary}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </section>

      <ul className="flex flex-col gap-4">
        {sortedRows.length === 0 ? (
          <li className="rounded-xl border border-zinc-800 py-10 text-center text-zinc-500">
            No feedback rows match this scope and user search.
          </li>
        ) : groupByUser ? (
          groupedRows.map(([user, rows]) => (
            <li key={user} className="rounded-2xl border border-zinc-800/90 bg-zinc-950/25 p-4">
              <div className="mb-3 flex items-center justify-between border-b border-zinc-800/70 pb-2">
                <h3 className="text-sm font-semibold text-zinc-200">{user}</h3>
                <span className="text-xs text-zinc-500">
                  {rows.length} feedback row{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="flex flex-col gap-4">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-0.5 text-xs uppercase ${scoreClass(r.score)}`}>
                          {scoreLabel(r.score)}
                        </span>
                        <span className="text-xs text-zinc-300">
                          Author · {getAuthorLabel(r)}
                        </span>
                        {r.taskKey ? (
                          <span className="font-[family-name:var(--font-mono)] text-[11px] text-zinc-500">
                            {r.taskKey}
                          </span>
                        ) : null}
                        {r.projectKey?.trim() ? (
                          <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[11px] text-sky-300/90">
                            {r.projectKey}
                          </span>
                        ) : null}
                        {r.envKey ? (
                          <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-300">
                            {r.envKey}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => analyzeOne(r.id)}
                        disabled={runningOne === r.id || batchRunning}
                        title="Re-scores with the selected guideline and optional extra instructions (even if already scored)."
                        className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
                      >
                        {runningOne === r.id ? "Analyzing…" : "Re-analyze"}
                      </button>
                    </div>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 text-[13px] text-zinc-200">
                      {r.body}
                    </pre>
                    {r.rationale ? (
                      <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm text-zinc-400">
                        <span className="font-medium text-zinc-300">Model note: </span>
                        {r.rationale}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-zinc-600">
                      Added {new Date(r.createdAt).toLocaleString()}
                      {r.analyzedAt ? ` · Scored ${new Date(r.analyzedAt).toLocaleString()}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))
        ) : (
          sortedRows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-0.5 text-xs uppercase ${scoreClass(r.score)}`}>
                    {scoreLabel(r.score)}
                  </span>
                  <span className="text-xs text-zinc-300">
                    Author · {getAuthorLabel(r)}
                  </span>
                  {r.taskKey ? (
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-zinc-500">
                      {r.taskKey}
                    </span>
                  ) : null}
                  {r.projectKey?.trim() ? (
                    <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[11px] text-sky-300/90">
                      {r.projectKey}
                    </span>
                  ) : null}
                  {r.envKey ? (
                    <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-300">
                      {r.envKey}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => analyzeOne(r.id)}
                  disabled={runningOne === r.id || batchRunning}
                  title="Re-scores with the selected guideline and optional extra instructions (even if already scored)."
                  className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
                >
                  {runningOne === r.id ? "Analyzing…" : "Re-analyze"}
                </button>
              </div>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-4 py-3 text-[13px] text-zinc-200">
                {r.body}
              </pre>
              {r.rationale ? (
                <p className="mt-3 border-l-2 border-amber-800/60 pl-4 text-sm text-zinc-400">
                  <span className="font-medium text-zinc-300">Model note: </span>
                  {r.rationale}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-zinc-600">
                Added {new Date(r.createdAt).toLocaleString()}
                {r.analyzedAt ? ` · Scored ${new Date(r.analyzedAt).toLocaleString()}` : ""}
              </p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
