"use client";

import { useEffect, useState } from "react";

type AuditVerdict = "PASS" | "FAIL" | "CONDITIONAL" | "UNKNOWN" | "ERROR";

type AuditSummaryResponse = {
  total: number;
  byVerdict: Record<AuditVerdict, number>;
  newest: {
    fileName: string;
    modifiedAt: string;
    verdict: AuditVerdict;
  } | null;
};

const VERDICT_ORDER: { key: AuditVerdict; label: string; accent: string }[] = [
  { key: "PASS", label: "Pass", accent: "text-emerald-300/95" },
  { key: "CONDITIONAL", label: "Conditional", accent: "text-amber-200/95" },
  { key: "FAIL", label: "Fail", accent: "text-red-300/95" },
  { key: "UNKNOWN", label: "Unknown", accent: "text-zinc-400" },
  { key: "ERROR", label: "Error", accent: "text-rose-300/95" },
];

export function OpenclawAuditOverview(props: { refreshToken?: number }) {
  const [summary, setSummary] = useState<AuditSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/special-projects/openclaw/audit-reports?summary=1");
        if (!res.ok) {
          if (!cancelled) setErr(`Could not load summary (${res.status})`);
          return;
        }
        const json = (await res.json()) as AuditSummaryResponse;
        if (!cancelled) setSummary(json);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.refreshToken]);

  async function downloadOverviewMarkdown() {
    setOverviewBusy(true);
    setDownloadErr(null);
    try {
      const res = await fetch(
        "/api/special-projects/openclaw/audit-reports?overview=1&download=1",
      );
      if (!res.ok) {
        setDownloadErr(`Could not build overview (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "openclaw_audit_overview.md";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setOverviewBusy(false);
    }
  }

  if (loading && !summary) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 print:hidden">
        <p className="text-sm text-zinc-500">Loading audit summary…</p>
      </section>
    );
  }

  if (err) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 print:hidden">
        <p className="text-sm text-red-400" role="alert">
          {err}
        </p>
      </section>
    );
  }

  if (!summary || summary.total === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 print:hidden">
        <h2 className="text-lg font-semibold text-zinc-100">Audit overview</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No reports in{" "}
          <code className="rounded bg-zinc-900 px-1 text-zinc-400">trace-exports/reports/</code> yet.
          Run an analysis to populate verdict counts.
        </p>
        <button
          type="button"
          onClick={() => void downloadOverviewMarkdown()}
          disabled={overviewBusy}
          className="mt-4 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {overviewBusy ? "Building…" : "Download overview (.md)"}
        </button>
        {downloadErr ? (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {downloadErr}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Audit overview</h2>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500">
            Parsed from every{" "}
            <code className="text-zinc-400">task_*.md</code> in{" "}
            <code className="text-zinc-400">trace-exports/reports/</code> (## Verdict section,
            same logic as the audit script). A combined markdown index is also written as{" "}
            <code className="text-zinc-400">openclaw_audit_overview.md</code> after each successful
            analysis run.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={() => void downloadOverviewMarkdown()}
            disabled={overviewBusy}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {overviewBusy ? "Building…" : "Download overview (.md)"}
          </button>
          <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/40 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Tasks audited</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-100">
              {summary.total}
            </p>
          </div>
        </div>
      </div>

      {summary.newest ? (
        <div className="mt-4 rounded-lg border border-zinc-700/60 bg-zinc-900/25 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Most recently written report
          </p>
          <p className="mt-1 font-mono text-sm text-zinc-200">{summary.newest.fileName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <span>
              {new Date(summary.newest.modifiedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="text-zinc-600">·</span>
            <span
              className={
                VERDICT_ORDER.find((v) => v.key === summary.newest?.verdict)?.accent ??
                "text-zinc-400"
              }
            >
              Verdict: {summary.newest.verdict}
            </span>
          </p>
        </div>
      ) : null}

      {downloadErr ? (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {downloadErr}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {VERDICT_ORDER.map(({ key, label, accent }) => {
          const n = summary.byVerdict[key] ?? 0;
          return (
            <div
              key={key}
              className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3"
            >
              <p className={`text-xs font-medium ${accent}`}>{label}</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                {n}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
