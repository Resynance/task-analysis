"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenclawAuditOverview } from "@/components/openclaw-audit-overview";
import { OpenclawAuditReportViewer } from "@/components/openclaw-audit-report-viewer";
import type { OpenclawAnalysisStreamEvent } from "@/lib/openclaw-analysis-stream";
import { TRACE_EXPORTS_RELATIVE_DEFAULT } from "@/lib/repo-paths";

const CUSTOM_SENTINEL = "";
const LAST_WORLD_STORAGE_KEY = "openclawPanel:lastAnalysisWorldId";

type WorldListItem = {
  id: string;
  name: string;
  updatedAt: string;
};

type LlmStatus = {
  provider: string | null;
  model: string | null;
};

function readStoredWorldId(): string {
  if (typeof window === "undefined") return CUSTOM_SENTINEL;
  try {
    return localStorage.getItem(LAST_WORLD_STORAGE_KEY) ?? CUSTOM_SENTINEL;
  } catch {
    return CUSTOM_SENTINEL;
  }
}

function writeStoredWorldId(id: string) {
  try {
    if (id) localStorage.setItem(LAST_WORLD_STORAGE_KEY, id);
    else localStorage.removeItem(LAST_WORLD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function OpenclawAnalysisPanel(props: {
  traceExportsPathDisplay?: string;
  traceBreadcrumbLabel: string;
  traceOverviewBackLabel: string;
}) {
  const traceExportsPath =
    props.traceExportsPathDisplay ?? TRACE_EXPORTS_RELATIVE_DEFAULT;
  const [worlds, setWorlds] = useState<WorldListItem[]>([]);
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [selectedWorldId, setSelectedWorldId] = useState<string>(CUSTOM_SENTINEL);
  const [worldsText, setWorldsText] = useState("");
  const [taskKey, setTaskKey] = useState("");
  const [limit, setLimit] = useState("");
  const [model, setModel] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [skipExisting, setSkipExisting] = useState(false);
  const [reportRefresh, setReportRefresh] = useState(0);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number | null;
    label: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const modelTouchedRef = useRef(false);
  const [paths, setPaths] = useState<{
    reportsDir: string;
    workflowStepsDir: string;
  } | null>(null);
  const [queueInfo, setQueueInfo] = useState<{
    workflowJsonFiles: number;
    withStepsEligible: number;
    toAudit: number;
    skipExisting: boolean;
  } | null>(null);

  const inputClass =
    "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-700/50";

  const fetchWorldBody = useCallback(async (id: string) => {
    const res = await fetch(`/api/special-projects/openclaw/worlds/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as { body: string };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setWorldsLoading(true);
      try {
        const res = await fetch("/api/special-projects/openclaw/worlds");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { worlds: WorldListItem[] };
        const list = data.worlds ?? [];
        if (cancelled) return;
        setWorlds(list);

        const stored = readStoredWorldId();
        const pick =
          stored && list.some((w) => w.id === stored) ? stored : CUSTOM_SENTINEL;
        setSelectedWorldId(pick);
        writeStoredWorldId(pick);

        if (pick) {
          const row = await fetchWorldBody(pick);
          if (!cancelled && row) setWorldsText(row.body);
        }
      } finally {
        if (!cancelled) setWorldsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWorldBody]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setModelLoading(true);
      try {
        const res = await fetch("/api/llm/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as LlmStatus;
        const configuredModel = data.model?.trim();
        if (!cancelled && configuredModel && !modelTouchedRef.current) {
          setModel(configuredModel);
        }
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onWorldChoiceChange(id: string) {
    setSelectedWorldId(id);
    writeStoredWorldId(id);
    if (!id) {
      return;
    }
    const row = await fetchWorldBody(id);
    if (row) setWorldsText(row.body);
  }

  function applyStreamEvent(ev: OpenclawAnalysisStreamEvent) {
    switch (ev.type) {
      case "phase":
        if (ev.status === "started") {
          setLogs(
            (p) => `${p ?? ""}${p ? "\n" : ""}--- audit_trace_workflow_steps.py ---\n`,
          );
        }
        break;
      case "progress":
        setProgress({
          completed: ev.completed,
          total: ev.total,
          label: ev.label,
        });
        break;
      case "queue_info":
        setQueueInfo({
          workflowJsonFiles: ev.workflowJsonFiles,
          withStepsEligible: ev.withStepsEligible,
          toAudit: ev.toAudit,
          skipExisting: ev.skipExisting,
        });
        break;
      case "reports_cleared":
        setReportRefresh((n) => n + 1);
        break;
      case "log":
        setLogs((p) => (p ?? "") + ev.text);
        break;
      case "complete":
        if (ev.ok) {
          setOk(true);
          setPaths({
            reportsDir: ev.reportsDir,
            workflowStepsDir: ev.workflowStepsDir,
          });
          setReportRefresh((n) => n + 1);
        } else {
          setError(ev.error);
        }
        break;
      case "fatal":
        setError(ev.message);
        break;
    }
  }

  async function onRunAnalysis() {
    setError(null);
    setLogs("");
    setProgress(null);
    setQueueInfo(null);
    setOk(false);
    setPaths(null);
    stopRequestedRef.current = false;

    const trimmed = worldsText.trim();
    if (!trimmed) {
      setError(
        "World text is empty. Choose a saved world or paste a one-off reference below.",
      );
      return;
    }

    const limitRaw = limit.trim();
    const limitNum =
      limitRaw === "" ? undefined : Number.parseInt(limitRaw, 10);
    if (limitRaw !== "" && (Number.isNaN(limitNum) || (limitNum ?? 0) < 1)) {
      setError("Limit must be a positive integer or empty.");
      return;
    }

    setBusy(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const res = await fetch("/api/special-projects/openclaw/run-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          worldsText: trimmed,
          taskKey: taskKey.trim() || undefined,
          limit: limitNum,
          model: model.trim() || undefined,
          skipExisting,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("ndjson") || !res.body) {
        setError("Unexpected response from server.");
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        for (;;) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            applyStreamEvent(JSON.parse(line) as OpenclawAnalysisStreamEvent);
          } catch {
            /* ignore */
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        try {
          applyStreamEvent(JSON.parse(tail) as OpenclawAnalysisStreamEvent);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      if (
        stopRequestedRef.current ||
        (e instanceof DOMException && e.name === "AbortError")
      ) {
        setError("Analysis run stopped.");
        setLogs((p) => `${p ?? ""}${p ? "\n" : ""}Stopped by user.\n`);
      } else {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      setBusy(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  function onStopAnalysis() {
    const controller = abortControllerRef.current;
    if (!controller) return;

    stopRequestedRef.current = true;
    controller.abort();
    setProgress((p) =>
      p
        ? {
            ...p,
            label: "Stopping analysis run…",
          }
        : { completed: 0, total: null, label: "Stopping analysis run…" },
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          {props.traceBreadcrumbLabel}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
          Run analysis
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Audits each{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">
            workflow-steps-by-task/*_workflow_steps.json
          </code>{" "}
          file the same way as{" "}
          <code className="text-zinc-400">fleet-audit/openclaw/audit.py</code>: guidelines
          plus world reference text vs recorded step outputs (OpenRouter). Markdown reports
          go to{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-300">
            {traceExportsPath}/reports/
          </code>
          ; preview the latest below and print to PDF from the browser.
        </p>
        <p className="mt-3 text-sm">
          <Link
            href="/special-projects/openclaw"
            className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
          >
            {props.traceOverviewBackLabel}
          </Link>
        </p>
      </header>

      <OpenclawAuditOverview refreshToken={reportRefresh} />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">World reference</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Choose a world saved on the{" "}
          <Link
            href="/special-projects/openclaw"
            className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
          >
            overview
          </Link>{" "}
          (or use one-off text). You can edit the text below before running without changing
          the saved copy.
        </p>
        {worldsLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading saved worlds…</p>
        ) : (
          <label className="mt-4 block text-sm text-zinc-300">
            World for this run
            <select
              value={selectedWorldId}
              onChange={(e) => void onWorldChoiceChange(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            >
              <option value={CUSTOM_SENTINEL}>One-off (paste / edit below only)</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} — updated {new Date(w.updatedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        <textarea
          value={worldsText}
          onChange={(e) => setWorldsText(e.target.value)}
          rows={10}
          className={`${inputClass} mt-4 min-h-[200px] font-mono text-xs`}
          placeholder="World reference text sent to the audit model…"
        />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Options</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            OpenRouter model
            <input
              value={model}
              onChange={(e) => {
                modelTouchedRef.current = true;
                setModel(e.target.value);
              }}
              placeholder={
                modelLoading ? "Loading configured model…" : "Use audit script default"
              }
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Single task key (optional)
            <input
              value={taskKey}
              onChange={(e) => setTaskKey(e.target.value)}
              placeholder="task_…"
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Limit count (optional)
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="e.g. 5"
              className={inputClass}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(e) => setSkipExisting(e.target.checked)}
              className="size-4 border-zinc-600 bg-zinc-950"
            />
            Skip tasks that already have a report markdown file
          </label>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            Analysis only runs on JSON files whose{" "}
            <code className="text-zinc-400">steps</code> array is non-empty. Empty exports
            usually mean the workflow-step scraper failed — check the{" "}
            <code className="text-zinc-400">error</code> field inside each JSON, then re-export
            from{" "}
            <Link
              href="/special-projects/openclaw/run"
              className="text-amber-200/90 underline-offset-4 hover:text-amber-100 hover:underline"
            >
              Run exports
            </Link>
            .
          </p>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            Unless skip-existing is on, each run deletes existing{" "}
            <code className="text-zinc-400">task_*.md</code> files under{" "}
            <code className="text-zinc-400">{traceExportsPath}/reports/</code> first so you start from a
            clean slate.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onRunAnalysis()}
          disabled={busy}
          className="rounded-xl border border-amber-700/80 bg-amber-900/25 px-5 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-900/40 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run analysis"}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={onStopAnalysis}
            className="rounded-xl border border-red-700/80 bg-red-950/30 px-5 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-950/45"
          >
            Stop job
          </button>
        ) : null}
        <span className="text-xs text-zinc-500">
          Uses the OpenRouter key from{" "}
          <span className="text-zinc-400">Settings → LLM</span> or{" "}
          <code className="text-zinc-400">OPENROUTER_API_KEY</code>.
        </span>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {busy || progress ? (
        <section
          className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 print:hidden"
          aria-busy={busy}
          aria-label="Audit progress"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-300">Progress</h2>
            <div className="flex items-center gap-3">
              {progress &&
              progress.total != null &&
              progress.total > 0 ? (
                <span className="font-mono text-xs tabular-nums text-zinc-500">
                  {progress.completed}/{progress.total} tasks
                </span>
              ) : null}
              {busy ? (
                <button
                  type="button"
                  onClick={onStopAnalysis}
                  className="rounded-lg border border-red-800/80 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-950/40"
                >
                  Stop
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{progress?.label ?? "…"}</p>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={
              progress?.total != null && progress.total > 0 ? progress.total : 100
            }
            aria-valuenow={
              progress?.total != null && progress.total > 0
                ? progress.completed
                : undefined
            }
            aria-valuetext={progress?.label}
          >
            {progress != null &&
            progress.total != null &&
            progress.total > 0 ? (
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.min(100, (progress.completed / progress.total) * 100)}%`,
                }}
              />
            ) : busy ? (
              <div className="h-full w-full animate-pulse rounded-full bg-amber-600/35" />
            ) : null}
          </div>
        </section>
      ) : null}

      {ok && paths ? (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100/95 print:hidden">
          <p className="font-medium text-emerald-200">Finished</p>
          <ul className="mt-2 list-none space-y-1 font-mono text-xs text-zinc-300">
            <li>Reports: {paths.reportsDir}</li>
            <li>Workflow inputs: {paths.workflowStepsDir}</li>
          </ul>
        </div>
      ) : null}

      {ok &&
      paths &&
      queueInfo &&
      queueInfo.toAudit === 0 &&
      queueInfo.workflowJsonFiles > 0 ? (
        <div
          className="rounded-xl border border-amber-800/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100/95 print:hidden"
          role="status"
        >
          <p className="font-medium text-amber-200">Why nothing ran</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-amber-100/85">
            {queueInfo.withStepsEligible === 0 ? (
              <li>
                All <strong>{queueInfo.workflowJsonFiles}</strong> workflow JSON files have an
                empty <code className="text-amber-200/90">steps</code> list (nothing to send to the
                model). Open any skipped file under{" "}
                <code className="font-mono text-xs text-amber-200/80">
                  workflow-steps-by-task/
                </code>{" "}
                and read the top-level <code className="text-amber-200/90">error</code> message —
                then fix auth/RSC scraping and{" "}
                <Link
                  href="/special-projects/openclaw/run"
                  className="font-medium text-amber-50 underline-offset-2 hover:underline"
                >
                  re-export workflow steps
                </Link>
                .
              </li>
            ) : null}
            {queueInfo.skipExisting &&
            queueInfo.withStepsEligible > 0 &&
            queueInfo.toAudit === 0 ? (
              <li>
                <strong>{queueInfo.withStepsEligible}</strong> task(s) have recorded steps, but
                each already has a <code className="text-amber-200/90">reports/*.md</code> file.
                Uncheck &quot;Skip tasks that already have a report&quot; above, or delete those
                markdown files, then run again.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <OpenclawAuditReportViewer refreshToken={reportRefresh} />

      {logs ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 print:hidden">
          <h2 className="text-sm font-medium text-zinc-300">Console</h2>
          <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-400">
            {logs}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
