"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";

type TaskRow = {
  taskId: string;
  runCount: number;
  runFiles: string[];
  hasReport: boolean;
  reportUpdatedAtIso: string | null;
};

type StatusPayload = {
  rootExists: boolean;
  rootRelative: string;
  overviewReport: {
    basename: string;
    exists: boolean;
    updatedAtIso: string | null;
  };
  tasks: TaskRow[];
};

type PreviewMode =
  | { type: "task"; taskId: string }
  | { type: "overview" }
  | { type: "facts"; taskId: string };

function triggerMarkdownDownload(filename: string, content: string) {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PmgptFailureAnalysisPanel(props: {
  initialStatus: StatusPayload;
  projectsEyebrowLabel: string;
  projectsHubBackLabel: string;
  transcriptFailureDisplayName: string;
}) {
  const [status, setStatus] = useState<StatusPayload>(props.initialStatus);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);
  const [previewMd, setPreviewMd] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [factsBusyTaskId, setFactsBusyTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/special-projects/pmgpt-failure-analysis/status");
      const data = (await res.json()) as StatusPayload & { error?: string };
      if (!res.ok) {
        setLoadError(typeof data.error === "string" ? data.error : "Failed to load status");
        return;
      }
      setStatus({
        ...data,
        overviewReport: data.overviewReport ?? {
          basename: "pmgpt-failure-overview.md",
          exists: false,
          updatedAtIso: null,
        },
      });
    } catch {
      setLoadError("Failed to load status");
    }
  }, []);

  function closePreview() {
    setPreviewMode(null);
    setPreviewMd(null);
    setPreviewError(null);
  }

  async function loadFactsPreview(taskId: string) {
    setPreviewError(null);
    setPreviewMd(null);
    setPreviewMode({ type: "facts", taskId });
    setFactsBusyTaskId(taskId);
    try {
      const res = await fetch(
        `/api/special-projects/pmgpt-failure-analysis/transcript-facts?taskId=${encodeURIComponent(taskId)}`,
      );
      const data = (await res.json()) as {
        markdown?: string;
        error?: string;
      };
      if (!res.ok) {
        setPreviewError(
          typeof data.error === "string" ? data.error : "Could not load facts",
        );
        return;
      }
      if (typeof data.markdown === "string") {
        setPreviewMd(data.markdown);
      }
    } catch {
      setPreviewError("Could not load transcript facts");
    } finally {
      setFactsBusyTaskId(null);
    }
  }

  async function loadPreview(taskId: string) {
    setPreviewError(null);
    setPreviewMd(null);
    setPreviewMode({ type: "task", taskId });
    try {
      const res = await fetch(
        `/api/special-projects/pmgpt-failure-analysis/report?taskId=${encodeURIComponent(taskId)}`,
      );
      const data = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) {
        setPreviewError(
          typeof data.error === "string" ? data.error : "Could not load report",
        );
        return;
      }
      if (typeof data.markdown === "string") {
        setPreviewMd(data.markdown);
      }
    } catch {
      setPreviewError("Could not load report");
    }
  }

  async function loadOverviewPreview() {
    setPreviewError(null);
    setPreviewMd(null);
    setPreviewMode({ type: "overview" });
    try {
      const res = await fetch(
        "/api/special-projects/pmgpt-failure-analysis/report?overview=1",
      );
      const data = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) {
        setPreviewError(
          typeof data.error === "string" ? data.error : "Could not load overview",
        );
        return;
      }
      if (typeof data.markdown === "string") {
        setPreviewMd(data.markdown);
      }
    } catch {
      setPreviewError("Could not load overview");
    }
  }

  async function exportReportAsMd(
    taskId: string,
    options?: { markdown?: string | null },
  ) {
    setLog(null);
    try {
      let md = options?.markdown;
      if (typeof md !== "string" || md.length === 0) {
        const res = await fetch(
          `/api/special-projects/pmgpt-failure-analysis/report?taskId=${encodeURIComponent(taskId)}`,
        );
        const data = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok) {
          setLog(`Export failed: ${data.error ?? res.statusText}`);
          return;
        }
        if (typeof data.markdown !== "string") {
          setLog("Export failed: empty report from server.");
          return;
        }
        md = data.markdown;
      }
      triggerMarkdownDownload(`${taskId}.md`, md);
      setLog(`Downloaded ${taskId}.md`);
    } catch (e) {
      setLog(
        `Export failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    }
  }

  const OVERVIEW_FILENAME = "pmgpt-failure-overview.md";

  async function exportOverviewAsMd(options?: { markdown?: string | null }) {
    setLog(null);
    try {
      let md = options?.markdown;
      if (typeof md !== "string" || md.length === 0) {
        const res = await fetch(
          "/api/special-projects/pmgpt-failure-analysis/report?overview=1",
        );
        const data = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok) {
          setLog(`Export failed: ${data.error ?? res.statusText}`);
          return;
        }
        if (typeof data.markdown !== "string") {
          setLog("Export failed: empty overview from server.");
          return;
        }
        md = data.markdown;
      }
      triggerMarkdownDownload(OVERVIEW_FILENAME, md);
      setLog(`Downloaded ${OVERVIEW_FILENAME}`);
    } catch (e) {
      setLog(
        `Export failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    }
  }

  async function downloadAllReportsBundle() {
    setLog(null);
    setBundleBusy(true);
    try {
      const res = await fetch(
        "/api/special-projects/pmgpt-failure-analysis/export-bundle",
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setLog(data.error ?? `Bundle download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const m = cd?.match(/filename="([^"]+)"/);
      const fname = m?.[1] ?? "pmgpt-failure-reports-bundle.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const n = res.headers.get("X-Bundle-File-Count");
      setLog(
        n
          ? `Downloaded ZIP (${n} markdown file(s), including overview when present).`
          : "Downloaded ZIP bundle.",
      );
    } catch (e) {
      setLog(
        `Bundle download failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    } finally {
      setBundleBusy(false);
    }
  }

  const canExportBundle =
    status.tasks.some((t) => t.hasReport) || status.overviewReport.exists;

  async function generateOverview() {
    setBusy(true);
    setBusyTaskId(null);
    setLog(null);
    try {
      const res = await fetch(
        "/api/special-projects/pmgpt-failure-analysis/generate-overview",
        { method: "POST" },
      );
      const data = (await res.json()) as {
        error?: string;
        writtenPath?: string;
        sourceTaskCount?: number;
      };
      if (!res.ok) {
        setLog(data.error ?? "Overview generation failed");
        return;
      }
      setLog(
        `Wrote cross-task summary (${data.sourceTaskCount ?? "?"} source task report(s)).`,
      );
      requestOpenRouterCreditsRefresh();
      await refresh();
      void loadOverviewPreview();
    } finally {
      setBusy(false);
    }
  }

  async function generateOne(taskId: string) {
    setBusy(true);
    setBusyTaskId(taskId);
    setLog(null);
    try {
      const res = await fetch(
        "/api/special-projects/pmgpt-failure-analysis/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, skipExisting }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        results?: Array<Record<string, unknown>>;
      };
      if (!res.ok) {
        setLog(data.error ?? "Generate failed");
        return;
      }
      const r = data.results?.[0] as
        | { taskId: string; ok: true; writtenPath?: string; skipped?: boolean; reason?: string }
        | { taskId: string; ok: false; error: string }
        | undefined;
      if (r && "ok" in r) {
        if (r.ok && "skipped" in r && r.skipped) {
          setLog(`${r.taskId}: skipped — ${r.reason ?? "skipped"}`);
        } else if (r.ok && "writtenPath" in r && r.writtenPath) {
          setLog(`Wrote report for ${r.taskId}`);
        } else if (!r.ok) {
          setLog(`${r.taskId}: ${r.error}`);
        }
      }
      requestOpenRouterCreditsRefresh();
      await refresh();
      if (r && "ok" in r && r.ok && !("skipped" in r && r.skipped)) {
        void loadPreview(taskId);
      }
    } finally {
      setBusy(false);
      setBusyTaskId(null);
    }
  }

  async function generateAll() {
    setBusy(true);
    setBusyTaskId(null);
    setLog(null);
    try {
      const res = await fetch(
        "/api/special-projects/pmgpt-failure-analysis/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipExisting }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        results?: unknown[];
      };
      if (!res.ok) {
        setLog(data.error ?? "Generate failed");
        return;
      }
      const n = Array.isArray(data.results) ? data.results.length : 0;
      const failed = Array.isArray(data.results)
        ? data.results.filter(
            (x) =>
              x &&
              typeof x === "object" &&
              "ok" in x &&
              (x as { ok: boolean }).ok === false,
          ).length
        : 0;
      setLog(`Finished ${n} job(s)${failed ? ` (${failed} failed)` : ""}.`);
      requestOpenRouterCreditsRefresh();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          {props.projectsEyebrowLabel}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link
            href="/special-projects"
            className="text-sm text-zinc-500 hover:text-amber-200/90"
          >
            {props.projectsHubBackLabel}
          </Link>
        </div>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          {props.transcriptFailureDisplayName}
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Deterministic **Transcript facts** (Outlook calendar ids vs names, parsed
          verifier lines) are available per task — no LLM. Reads run transcripts from{" "}
          <code className="text-zinc-400">{status.rootRelative}/task_*/run*.json</code>
          {" "}(optional matching{" "}
          <code className="text-zinc-400">runN-verifier.json</code> grading output per run) and writes one Markdown report per task under{" "}
          <code className="text-zinc-400">…/reports/&lt;task_id&gt;.md</code>.
          Each LLM report includes expected workflow from the prompt, per-run
          summaries (including whether the agent targeted the right entities),
          workflow-conformance notes, detailed per-run issues, and a consolidated
          root-cause summary (all from digests of transcripts plus optional verifier
          output). Reports use a fixed **failure origin** taxonomy (poor prompt,
          writer or recording baseline, model run, or elsewhere: seed data,
          verifier, tooling) in each run and in the root-cause summary. For
          calendar ID verifier mismatches, recommendations default to aligning the
          task creator&apos;s reference recording with grading—not putting numeric
          calendar IDs in the prompt. Optional flags the prompt never names (e.g.
          email importance) are framed as **model default adherence**, not prompt
          ambiguity. Writer/QA calendar claims require **prompt + tool transcript +
          verifier** evidence when the digest allows. You can
          also build{" "}
          <code className="text-zinc-400">pmgpt-failure-overview.md</code>, a
          single cross-task summary from all existing per-task reports.
        </p>
      </header>

      {loadError ? (
        <p className="text-sm text-red-300" role="alert">
          {loadError}
        </p>
      ) : null}

      {!status.rootExists ? (
        <p className="text-sm text-amber-200/90" role="status">
          Folder{" "}
          <code className="text-zinc-400">{status.rootRelative}</code> does not
          exist yet. Create it and add <code className="text-zinc-400">task_*</code>{" "}
          directories with <code className="text-zinc-400">run1.json</code>, etc.
        </p>
      ) : null}

      {status.rootExists ? (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                className="rounded border-zinc-600"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                disabled={busy}
              />
              Skip tasks that already have a report (batch only)
            </label>
            <button
              type="button"
              disabled={busy || status.tasks.every((t) => t.runCount === 0)}
              onClick={() => void generateAll()}
              className="rounded-xl border border-amber-800/70 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-600/90 hover:bg-amber-900/35 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && !busyTaskId ? "Generating…" : "Generate all reports"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
            >
              Refresh list
            </button>
            <button
              type="button"
              disabled={busy || bundleBusy || !canExportBundle}
              onClick={() => void downloadAllReportsBundle()}
              className="rounded-lg border border-emerald-900/60 bg-emerald-950/25 px-3 py-2 text-sm font-medium text-emerald-100/95 transition hover:border-emerald-700/50 hover:bg-emerald-900/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bundleBusy ? "Zipping…" : "Download all reports (.zip)"}
            </button>
          </div>

          {log ? (
            <p className="text-sm text-emerald-200/90" role="status">
              {log}
            </p>
          ) : null}

          <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              Cross-task summary report
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Uses every existing{" "}
              <code className="text-zinc-400">task_*.md</code> under{" "}
              <code className="text-zinc-400">reports/</code>. Each file is split
              into prompts, run-statistics tables, expected workflow, summaries,
              workflow conformance, detailed analysis, and root-cause summaries
              before sending to the model (then truncated to fit the context
              window). The overview adds a **Failure mode patterns** table (JQL,
              nested fields, collective ops, verifier strictness, tooling quirks)
              across tasks. Generate per-task reports first.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  busy ||
                  !status.tasks.some((t) => t.hasReport)
                }
                onClick={() => void generateOverview()}
                className="rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2 text-sm font-medium text-violet-100 transition hover:border-violet-600/80 hover:bg-violet-900/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Working…" : "Generate cross-task summary"}
              </button>
              {status.overviewReport.exists ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void loadOverviewPreview()}
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:border-amber-700/60"
                  >
                    Preview summary
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void exportOverviewAsMd()}
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:border-amber-700/60"
                  >
                    Export summary .md
                  </button>
                </>
              ) : null}
            </div>
            {status.overviewReport.exists &&
            status.overviewReport.updatedAtIso ? (
              <p className="mt-2 text-xs text-zinc-500">
                Last generated:{" "}
                {new Date(
                  status.overviewReport.updatedAtIso,
                ).toLocaleString()}
              </p>
            ) : null}
          </section>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950/80 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Runs</th>
                  <th className="px-4 py-3 font-medium">Report</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {status.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-zinc-500">
                      No <code className="text-zinc-400">task_*</code> folders found.
                    </td>
                  </tr>
                ) : (
                  status.tasks.map((t) => (
                    <tr key={t.taskId} className="bg-zinc-950/40">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-200">
                        {t.taskId}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {t.runCount === 0 ? (
                          <span className="text-amber-200/80">No run*.json</span>
                        ) : (
                          t.runCount
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {t.hasReport ? (
                          <span className="text-emerald-200/90">
                            {t.reportUpdatedAtIso
                              ? new Date(t.reportUpdatedAtIso).toLocaleString()
                              : "Yes"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy || t.runCount === 0}
                            onClick={() => void generateOne(t.taskId)}
                            className="rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-amber-700/60 disabled:opacity-40"
                          >
                            {busy && busyTaskId === t.taskId
                              ? "…"
                              : "Generate"}
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy || t.runCount === 0 || factsBusyTaskId === t.taskId
                            }
                            onClick={() => void loadFactsPreview(t.taskId)}
                            className="rounded-lg border border-cyan-900/60 bg-cyan-950/25 px-2 py-1 text-xs text-cyan-100/95 hover:border-cyan-600/60 disabled:opacity-40"
                            title="Outlook calendar ids from tools vs parsed verifier lines (no LLM)"
                          >
                            {factsBusyTaskId === t.taskId ? "…" : "Facts"}
                          </button>
                          {t.hasReport ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void loadPreview(t.taskId)}
                                className="rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-amber-700/60"
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void exportReportAsMd(t.taskId)}
                                className="rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-amber-700/60"
                              >
                                Export .md
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {previewMode ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-5 py-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  {previewMode.type === "overview"
                    ? "Preview · Cross-task summary"
                    : previewMode.type === "facts"
                      ? `Preview · Transcript facts · ${previewMode.taskId}`
                      : `Preview · ${previewMode.taskId}`}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {previewMd && !previewError ? (
                    <button
                      type="button"
                      onClick={() =>
                        previewMode.type === "overview"
                          ? void exportOverviewAsMd({ markdown: previewMd })
                          : previewMode.type === "facts"
                            ? void triggerMarkdownDownload(
                                `${previewMode.taskId}-transcript-facts.md`,
                                previewMd,
                              )
                            : void exportReportAsMd(previewMode.taskId, {
                                markdown: previewMd,
                              })
                      }
                      className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs font-medium text-zinc-200 hover:border-amber-700/60 hover:text-amber-100"
                    >
                      Export as .md
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closePreview}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Close
                  </button>
                </div>
              </div>
              {previewError ? (
                <p className="mt-3 text-sm text-red-300">{previewError}</p>
              ) : previewMd ? (
                <div className="mt-4 max-h-[min(70vh,720px)] overflow-auto text-sm leading-relaxed text-zinc-200 [&_a]:text-amber-200 [&_a]:underline [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-medium [&_p]:my-2 [&_li]:my-1 [&_ul]:my-2 [&_ol]:my-2 [&_strong]:text-zinc-50 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {previewMd.replace(/^<!--[\s\S]*?-->\s*/, "")}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">Loading…</p>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
