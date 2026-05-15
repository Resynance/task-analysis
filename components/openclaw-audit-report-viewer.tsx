"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ReportListResponse = {
  latest: {
    fileName: string;
    modifiedAt: string;
    meta: Record<string, string>;
    markdown: string;
  } | null;
  files: { fileName: string; modifiedAt: string }[];
};

type ReportFileResponse = {
  fileName: string;
  modifiedAt: string;
  meta: Record<string, string>;
  markdown: string;
};

export function OpenclawAuditReportViewer(props: { refreshToken?: number }) {
  const [files, setFiles] = useState<ReportListResponse["files"]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [modifiedAt, setModifiedAt] = useState<string | null>(null);

  const applyList = useCallback((json: ReportListResponse) => {
    setFiles(json.files);
    if (json.latest) {
      setSelected(json.latest.fileName);
      setMarkdown(json.latest.markdown);
      setFileName(json.latest.fileName);
      setModifiedAt(json.latest.modifiedAt);
    } else {
      setSelected("");
      setMarkdown(null);
      setFileName(null);
      setModifiedAt(null);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/special-projects/openclaw/audit-reports");
      if (!res.ok) {
        setErr(`Failed to load reports (${res.status})`);
        return;
      }
      const json = (await res.json()) as ReportListResponse;
      applyList(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [applyList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadList updates loading/list state asynchronously
    void loadList();
  }, [loadList, props.refreshToken]);

  async function loadFile(name: string) {
    if (!name) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/special-projects/openclaw/audit-reports?file=${encodeURIComponent(name)}`,
      );
      if (!res.ok) {
        setErr("Could not load that report.");
        return;
      }
      const json = (await res.json()) as ReportFileResponse;
      setSelected(json.fileName);
      setMarkdown(json.markdown);
      setFileName(json.fileName);
      setModifiedAt(json.modifiedAt);
    } finally {
      setLoading(false);
    }
  }

  async function exportSelectedMarkdown() {
    if (!selected) return;
    setExportBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/special-projects/openclaw/audit-reports?file=${encodeURIComponent(selected)}&download=1`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? "Could not export that report.");
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = selected;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  async function exportAllZip() {
    setExportBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/special-projects/openclaw/audit-reports?export=zip");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? "Could not export reports.");
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "openclaw-audit-reports.zip";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  if (loading && files.length === 0 && !err) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 text-sm text-zinc-500">
        Loading reports…
      </section>
    );
  }

  if (files.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Report preview</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No audit reports yet. Run analysis to create markdown under{" "}
          <code className="text-zinc-500">trace-exports/reports/</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Report preview</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Most recently written file loads first.             Export downloads markdown from disk (with YAML
            frontmatter). <strong className="font-medium text-zinc-400">Export all</strong> also
            includes <code className="text-zinc-400">openclaw_audit_overview.md</code> (combined
            index). Print hides the rest of the page (Save as PDF in the print dialog).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loading || exportBusy}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void exportSelectedMarkdown()}
            disabled={!selected || exportBusy}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            title="Download the report chosen in the dropdown"
          >
            Export selected (.md)
          </button>
          <button
            type="button"
            onClick={() => void exportAllZip()}
            disabled={exportBusy}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            title="Zip every task_*.md plus openclaw_audit_overview.md"
          >
            Export all (.zip)
          </button>
          {markdown ? (
            <button
              type="button"
              onClick={() => window.print()}
              disabled={exportBusy}
              className="rounded-lg border border-amber-700/60 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/35 disabled:opacity-50"
            >
              Print / Save as PDF…
            </button>
          ) : null}
        </div>
      </div>

      {files.length > 0 ? (
        <label className="mt-4 block text-sm text-zinc-400 print:hidden">
          Report
          <select
            value={selected}
            onChange={(e) => void loadFile(e.target.value)}
            disabled={loading}
            className="mt-1 w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            {files.map((f) => (
              <option key={f.fileName} value={f.fileName}>
                {f.fileName} — {new Date(f.modifiedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {fileName ? (
        <p className="mt-3 font-mono text-xs text-zinc-500 print:hidden">
          {fileName}
          {modifiedAt ? ` · ${new Date(modifiedAt).toLocaleString()}` : ""}
        </p>
      ) : null}

      {err ? (
        <p className="mt-2 text-sm text-red-400 print:hidden" role="alert">
          {err}
        </p>
      ) : null}

      {markdown ? (
        <div
          id="openclaw-report-print"
          className="mt-4 max-h-[min(70vh,900px)] overflow-auto rounded-lg border border-zinc-800/80 bg-zinc-950 px-4 py-4 text-sm text-zinc-200 print:max-h-none print:border-0 print:bg-white print:text-black [&_a]:text-amber-200 [&_a]:underline print:[&_a]:text-black print:[&_a]:no-underline [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-zinc-700 [&_h2]:pb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-medium [&_p]:my-2 [&_li]:my-1 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-600 [&_th]:bg-zinc-900 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-zinc-600 [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1 print:[&_code]:bg-neutral-100 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3 print:[&_pre]:bg-neutral-100"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      ) : !loading ? (
        <p className="mt-4 text-sm text-zinc-500 print:hidden">No preview available.</p>
      ) : null}
    </section>
  );
}
