"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { csvEscape } from "@/lib/csv-export";
import type { PromptAnalysisProblemArea } from "@/lib/analyze-prompt";
import {
  WRITER_PRECHECK_MAX_NOTES_CHARS,
  WRITER_PRECHECK_MAX_PROMPT_CHARS,
  WRITER_PRECHECK_MAX_ROWS,
  WRITER_PRECHECK_MAX_RUBRIC_CHARS,
} from "@/lib/openclaw-writer-precheck-csv";
import type { WriterPrecheckPriorAudit } from "@/lib/openclaw-writer-precheck-prior-audit";
import { TRACE_EXPORTS_RELATIVE_DEFAULT } from "@/lib/repo-paths";

/**
 * Writer draft pre-check UI: pick guideline and world/persona source, upload CSV, stream NDJSON
 * row results, then export CSV or open a printable HTML report (browser Save as PDF).
 */
const MAX_USER_STORY_PASTE_CHARS = 400_000;

type GuidelineOption = { id: string; name: string };
type WorldOption = { id: string; name: string };

type ApiRowResult = {
  rowIndex: number;
  externalId: string | null;
  /** From intake `Name` / writer / author columns (see CSV parser). */
  writerName: string | null;
  score: "EXCELLENT" | "AVERAGE" | "POOR" | null;
  rationale: string | null;
  error: string | null;
  problemAreas?: PromptAnalysisProblemArea[];
  /** On-disk workflow audit match from trace-export reports, when present. */
  priorAudit?: WriterPrecheckPriorAudit | null;
};

type ApiResponse = {
  guideline: { id: string; name: string };
  targetWorld: { id: string; name: string } | null;
  userStorySource: "saved_world" | "pasted" | "none";
  parseWarnings: string[];
  maxRows: number;
  results: ApiRowResult[];
  summary: {
    total: number;
    excellent: number;
    average: number;
    poor: number;
    failed: number;
  };
  /** True when the user stopped the job before all rows finished. */
  stoppedEarly?: boolean;
};

function computeSummary(results: ApiRowResult[]) {
  return {
    total: results.length,
    excellent: results.filter((r) => r.score === "EXCELLENT").length,
    average: results.filter((r) => r.score === "AVERAGE").length,
    poor: results.filter((r) => r.score === "POOR").length,
    failed: results.filter((r) => r.error != null).length,
  };
}

function problemAreaSourceLabel(source: PromptAnalysisProblemArea["source"]): string {
  switch (source) {
    case "prompt":
      return "Prompt";
    case "writer_rubric":
      return "Writer rubric";
    case "guideline_overlap":
      return "Guidelines";
    case "user_story":
      return "World / persona";
    case "notes":
      return "Notes";
    default:
      return "Other";
  }
}

function ProblemAreasList(props: { areas: PromptAnalysisProblemArea[] }) {
  if (props.areas.length === 0) {
    return <span className="text-xs text-zinc-600">None flagged</span>;
  }
  return (
    <ul className="mt-0 max-w-xl space-y-2.5">
      {props.areas.map((p, i) => (
        <li
          key={i}
          className="border-l-2 border-amber-800/50 pl-3 text-xs leading-snug text-zinc-300"
        >
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wide text-amber-200/85">
            {problemAreaSourceLabel(p.source)}
          </span>
          {p.excerpt ? (
            <p className="mt-1 border-l border-zinc-700/80 pl-2 text-[11px] italic text-zinc-500">
              “{p.excerpt}”
            </p>
          ) : null}
          <p className="mt-1 text-zinc-200">{p.concern}</p>
        </li>
      ))}
    </ul>
  );
}

function scoreBadgeClass(score: ApiRowResult["score"]): string {
  switch (score) {
    case "EXCELLENT":
      return "border-emerald-800/80 bg-emerald-950/50 text-emerald-200";
    case "AVERAGE":
      return "border-amber-800/80 bg-amber-950/40 text-amber-100";
    case "POOR":
      return "border-rose-800/80 bg-rose-950/40 text-rose-100";
    default:
      return "border-zinc-600 bg-zinc-900 text-zinc-400";
  }
}

function priorAuditBadgeClass(
  verdict: WriterPrecheckPriorAudit["verdict"],
): string {
  switch (verdict) {
    case "PASS":
      return "border-emerald-800/80 bg-emerald-950/40 text-emerald-200";
    case "FAIL":
      return "border-rose-800/80 bg-rose-950/40 text-rose-100";
    case "CONDITIONAL":
      return "border-amber-800/80 bg-amber-950/35 text-amber-100";
    case "ERROR":
      return "border-orange-800/70 bg-orange-950/30 text-orange-100";
    default:
      return "border-zinc-600 bg-zinc-900 text-zinc-400";
  }
}

function priorAuditMatchLabel(
  m: WriterPrecheckPriorAudit["matchType"],
): string {
  return m === "task_key"
    ? "Matched task id"
    : "Matched prompt prefix (≤140 chars)";
}

function PriorAuditCell(props: {
  audit: WriterPrecheckPriorAudit | null | undefined;
}) {
  const a = props.audit;
  if (!a) {
    return <span className="text-xs text-zinc-600">—</span>;
  }
  return (
    <div className="max-w-[200px] space-y-1">
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorAuditBadgeClass(a.verdict)}`}
      >
        {a.verdict}
      </span>
      <p className="truncate font-mono text-[10px] text-zinc-500" title={a.taskKey}>
        {a.taskKey}
      </p>
      <p className="text-[10px] leading-tight text-zinc-600">
        {priorAuditMatchLabel(a.matchType)}
      </p>
    </div>
  );
}

export function OpenclawWriterPrecheckPanel(props: {
  guidelines: GuidelineOption[];
  worlds: WorldOption[];
  /** Repo-relative trace-export root (must match server `TASK_ANALYSIS_TRACE_EXPORTS_DIR`). */
  traceExportsPathDisplay?: string;
  writerPrecheckKicker: string;
  traceOverviewLinkText: string;
}) {
  const traceExportsPath =
    props.traceExportsPathDisplay ?? TRACE_EXPORTS_RELATIVE_DEFAULT;
  const [guidelineId, setGuidelineId] = useState(
    () => props.guidelines[0]?.id ?? "",
  );
  const [openclawWorldId, setOpenclawWorldId] = useState("");
  const [userStoryDraft, setUserStoryDraft] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [liveResults, setLiveResults] = useState<ApiRowResult[]>([]);
  const [streamMeta, setStreamMeta] = useState<Omit<
    ApiResponse,
    "results" | "summary" | "stoppedEarly"
  > | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamResultsRef = useRef<ApiRowResult[]>([]);

  const onPickFile = useCallback((file: File | null) => {
    setError(null);
    setData(null);
    setStreamMeta(null);
    setProgress(null);
    setLiveResults([]);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const t =
        typeof reader.result === "string"
          ? reader.result
          : new TextDecoder().decode(reader.result as ArrayBuffer);
      setCsvText(t);
    };
    reader.onerror = () => {
      setError("Could not read the file.");
    };
    reader.readAsText(file);
  }, []);

  const stopPrecheck = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  async function runPrecheck() {
    setError(null);
    setData(null);
    setProgress(null);
    setLiveResults([]);
    setStreamMeta(null);
    streamResultsRef.current = [];

    if (!guidelineId.trim()) {
      setError("Select a guideline (rubric) from the app to score against.");
      return;
    }
    if (!csvText.trim()) {
      setError("Paste CSV text or choose a .csv file.");
      return;
    }
    if (
      userStoryDraft.length > MAX_USER_STORY_PASTE_CHARS &&
      !openclawWorldId.trim()
    ) {
      setError(
        `Pasted world / persona exceeds ${MAX_USER_STORY_PASTE_CHARS.toLocaleString()} characters.`,
      );
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const ac = abortRef.current;

    setBusy(true);
    try {
      const res = await fetch(
        "/api/special-projects/openclaw/writer-precheck",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guidelineId,
            csvText,
            openclawWorldId: openclawWorldId.trim() || undefined,
            userStoryText: openclawWorldId.trim()
              ? undefined
              : userStoryDraft.trim() || undefined,
          }),
          signal: ac.signal,
        },
      );

      if (!res.ok) {
        const text = await res.text();
        let msg = `Request failed (${res.status})`;
        try {
          const j = JSON.parse(text) as {
            error?: string;
            parseErrors?: string[];
          };
          msg = [j.error, j.parseErrors?.join(" ")].filter(Boolean).join(" ") || msg;
        } catch {
          if (text.trim()) msg = text;
        }
        setError(msg);
        return;
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("ndjson") || !res.body) {
        setError("Unexpected response from server (expected NDJSON stream).");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let meta: Omit<ApiResponse, "results" | "summary" | "stoppedEarly"> | null =
        null;

      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (readErr) {
          if (readErr instanceof DOMException && readErr.name === "AbortError") {
            break;
          }
          throw readErr;
        }
        const { done, value } = readResult;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as Record<string, unknown>;
          const t = ev.type;
          if (t === "start") {
            meta = {
              guideline: ev.guideline as ApiResponse["guideline"],
              targetWorld: (ev.targetWorld ?? null) as ApiResponse["targetWorld"],
              userStorySource: ev.userStorySource as ApiResponse["userStorySource"],
              parseWarnings: (ev.parseWarnings as string[]) ?? [],
              maxRows: (ev.maxRows as number) ?? WRITER_PRECHECK_MAX_ROWS,
            };
            const total = (ev.totalRows as number) ?? 0;
            setStreamMeta(meta);
            setProgress({ completed: 0, total });
            streamResultsRef.current = [];
            setLiveResults([]);
          } else if (t === "row") {
            const result = ev.result as ApiRowResult;
            const completed = (ev.completed as number) ?? streamResultsRef.current.length + 1;
            const total = (ev.total as number) ?? meta?.maxRows ?? 0;
            streamResultsRef.current = [...streamResultsRef.current, result];
            setLiveResults([...streamResultsRef.current]);
            setProgress({ completed, total });
          } else if (t === "complete") {
            const summary = ev.summary as ApiResponse["summary"];
            if (!meta) {
              setError("Stream missing start event.");
              void reader.cancel();
              return;
            }
            setData({
              ...meta,
              results: streamResultsRef.current,
              summary,
              stoppedEarly: false,
            });
            setStreamMeta(null);
            setProgress(null);
            setLiveResults([]);
          } else if (t === "aborted") {
            if (meta) {
              setData({
                ...meta,
                results: streamResultsRef.current,
                summary: computeSummary(streamResultsRef.current),
                stoppedEarly: true,
              });
            }
            setStreamMeta(null);
            setProgress(null);
            setLiveResults([]);
          } else if (t === "error") {
            setError((ev.message as string) || "Stream error");
            void reader.cancel();
            return;
          }
        }
      }

      if (ac.signal.aborted && meta && streamResultsRef.current.length > 0) {
        setData({
          ...meta,
          results: streamResultsRef.current,
          summary: computeSummary(streamResultsRef.current),
          stoppedEarly: true,
        });
        setStreamMeta(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        /* finalized via aborted event or below */
      } else {
        setError(
          e instanceof Error ? e.message : "Network error while running pre-check.",
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setProgress(null);
    }
  }

  function downloadResultsCsv() {
    if (!data) return;
    const headers = [
      "row_index",
      "external_id",
      "task_author",
      "score",
      "rationale",
      "problem_areas_json",
      "error",
      "prior_workflow_audit_verdict",
      "prior_workflow_audit_task_key",
      "prior_workflow_audit_report_file",
      "prior_workflow_audit_match_type",
      "prior_workflow_audit_at_utc",
      "prior_workflow_audit_target_world",
      "guideline_name",
      "world_name",
      "user_story_source",
    ];
    const worldLabel =
      data.targetWorld?.name ??
      (data.userStorySource === "pasted" ? "(pasted text)" : "");
    const lines = [
      headers.join(","),
      ...data.results.map((r) => {
        const pa = r.priorAudit;
        return [
          csvEscape(String(r.rowIndex)),
          csvEscape(r.externalId ?? ""),
          csvEscape(r.writerName ?? ""),
          csvEscape(r.score ?? ""),
          csvEscape(r.rationale ?? ""),
          csvEscape(JSON.stringify(r.problemAreas ?? [])),
          csvEscape(r.error ?? ""),
          csvEscape(pa?.verdict ?? ""),
          csvEscape(pa?.taskKey ?? ""),
          csvEscape(pa?.reportFileName ?? ""),
          csvEscape(pa?.matchType ?? ""),
          csvEscape(pa?.auditedAt ?? ""),
          csvEscape(pa?.targetWorld ?? ""),
          csvEscape(data.guideline.name),
          csvEscape(worldLabel),
          csvEscape(data.userStorySource),
        ].join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openclaw-writer-precheck-${new Date().toISOString().slice(0, 10)}.csv`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadResultsPdf() {
    if (!data) return;
    try {
      const { downloadWriterPrecheckPdf } = await import(
        "@/lib/openclaw-writer-precheck-pdf"
      );
      const worldLabel =
        data.targetWorld?.name ??
        (data.userStorySource === "pasted" ? "(pasted text)" : "");
      downloadWriterPrecheckPdf({
        guidelineName: data.guideline.name,
        worldLabel,
        userStorySource: data.userStorySource,
        generatedAtIso: new Date().toISOString(),
        summary: data.summary,
        stoppedEarly: data.stoppedEarly,
        parseWarnings: data.parseWarnings,
        results: data.results.map((r) => ({
          rowIndex: r.rowIndex,
          externalId: r.externalId,
          writerName: r.writerName ?? null,
          score: r.score,
          rationale: r.rationale,
          error: r.error,
          problemAreas: r.problemAreas,
          priorAudit: r.priorAudit ?? null,
        })),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open the printable report.",
      );
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-700/50";

  const display =
    data ??
    (streamMeta
      ? {
          ...streamMeta,
          results: liveResults,
          summary: computeSummary(liveResults),
          stoppedEarly: undefined,
        }
      : null);
  const isLiveUpdating = Boolean(busy && streamMeta && !data);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          {props.writerPrecheckKicker}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-zinc-50">
          Writer draft pre-check
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Upload a spreadsheet of <strong className="text-zinc-200">prompts</strong>, optional{" "}
          <strong className="text-zinc-200">writer rubrics</strong>, and{" "}
          <strong className="text-zinc-200">notes</strong>. Each row is scored with the same LLM
          rubric flow as the main app, against a guideline you select from{" "}
          <Link href="/configuration/guidelines" className="text-amber-200/90 underline-offset-2 hover:underline">
            Configuration → Guidelines
          </Link>
          . Optionally add a{" "}
          <strong className="text-zinc-200">target world / persona</strong> (saved database world or
          pasted spec) so the model can judge fit to that scenario as well as the rubric. Use this
          before writers record to catch misalignment early.
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">CSV format</h2>
          <p className="mt-2 text-xs text-zinc-500">
            Header row required. Column names are matched case-insensitively (spaces → underscores).
          </p>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-zinc-400">
            <li>
              <span className="text-zinc-200">Prompt</span> (required):{" "}
              <code className="text-zinc-500">prompt</code>,{" "}
              <code className="text-zinc-500">prompt_body</code>,{" "}
              <code className="text-zinc-500">Prompt/Task</code> (common sprint-style intake sheet), …
            </li>
            <li>
              <span className="text-zinc-200">Rubric</span> (optional):{" "}
              <code className="text-zinc-500">rubric</code>, …
            </li>
            <li>
              <span className="text-zinc-200">Notes</span> (optional):{" "}
              <code className="text-zinc-500">notes</code>,{" "}
              <code className="text-zinc-500">Notes/Comments</code>, …
            </li>
            <li>
              <span className="text-zinc-200">Task id</span> (optional):{" "}
              <code className="text-zinc-500">Task Key/ID or Instance ID</code> is preferred, then{" "}
              <code className="text-zinc-500">Updated Task ID</code>, then generic{" "}
              <code className="text-zinc-500">id</code> / <code className="text-zinc-500">row_id</code>.
            </li>
            <li>
              <span className="text-zinc-200">Writer / persona</span> (optional):{" "}
              <code className="text-zinc-500">Name</code>,{" "}
              <code className="text-zinc-500">Persona Name</code> — passed as intake context (persona
              label is not a substitute for a full saved world). The writer name is repeated in the
              results table and export as <span className="text-zinc-300">task author</span>.
            </li>
            <li className="text-zinc-500">
              Target world / persona is chosen with the controls on the right (saved database world
              or pasted text), not from the CSV.
            </li>
            <li className="text-zinc-500">
              If you have already run the on-disk workflow audit (same scripts as Run analysis),
              matching rows show the saved{" "}
              <span className="text-zinc-400">PASS</span> / <span className="text-zinc-400">FAIL</span>{" "}
              / <span className="text-zinc-400">CONDITIONAL</span> verdict from{" "}
              <code className="text-zinc-600">trace-exports/reports/</code> (by task id, or by prompt
              prefix when id is missing).
            </li>
          </ul>
          <p className="mt-4 text-xs text-zinc-500">
            Limits: up to {WRITER_PRECHECK_MAX_ROWS} rows per run; prompt ≤{" "}
            {WRITER_PRECHECK_MAX_PROMPT_CHARS.toLocaleString()} chars; rubric ≤{" "}
            {WRITER_PRECHECK_MAX_RUBRIC_CHARS.toLocaleString()} (long sprint rubrics); notes ≤{" "}
            {WRITER_PRECHECK_MAX_NOTES_CHARS.toLocaleString()}; CSV upload ≤ ~12&nbsp;MB. After a run
            finishes, download a <span className="text-zinc-300">CSV</span> for spreadsheets or use{" "}
            <span className="text-zinc-300">Save as PDF</span> (opens a print-ready page — choose
            &quot;Save as PDF&quot; in the print dialog; same row content as the results table).
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <label className="block text-sm font-medium text-zinc-200">
            Guideline to score against
            <select
              className={inputClass}
              value={guidelineId}
              onChange={(e) => setGuidelineId(e.target.value)}
              disabled={busy || props.guidelines.length === 0}
            >
              {props.guidelines.length === 0 ? (
                <option value="">No guidelines in database</option>
              ) : (
                props.guidelines.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="mt-4 block text-sm font-medium text-zinc-200">
            Target world / persona (saved)
            <select
              className={inputClass}
              value={openclawWorldId}
              onChange={(e) => setOpenclawWorldId(e.target.value)}
              disabled={busy || props.worlds.length === 0}
            >
              <option value="">None — guideline only (optional)</option>
              {props.worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {props.worlds.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              No saved worlds yet. Add one on the{" "}
              <Link
                href="/special-projects/openclaw"
                className="text-amber-200/90 underline-offset-2 hover:underline"
              >
                {props.traceOverviewLinkText}
              </Link>{" "}
              or paste text below.
            </p>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              Saved world wins if both a world and pasted text are filled. Same text as workflow
              audits use for <code className="text-zinc-600">USER STORY</code> in{" "}
              <code className="text-zinc-600">analyze-prompt</code>.
            </p>
          )}

          <label className="mt-4 block text-sm font-medium text-zinc-200">
            Or paste world / persona text
            <textarea
              className={`${inputClass} min-h-[120px] font-[family-name:var(--font-mono)] text-xs`}
              value={userStoryDraft}
              onChange={(e) => setUserStoryDraft(e.target.value)}
              placeholder='If no saved world is selected, paste the full target persona / world spec here…'
              spellCheck={false}
              disabled={Boolean(openclawWorldId.trim()) || busy}
            />
          </label>
          {openclawWorldId.trim() ? (
            <p className="mt-1 text-xs text-zinc-600">
              Pasted text is ignored while a saved world is selected.
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Max {MAX_USER_STORY_PASTE_CHARS.toLocaleString()} characters.
            </p>
          )}

          <label className="mt-4 block text-sm font-medium text-zinc-200">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className={`${inputClass} cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-xs file:text-zinc-200`}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-zinc-200">
            Or paste CSV
            <textarea
              className={`${inputClass} min-h-[180px] font-[family-name:var(--font-mono)] text-xs`}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={'id,prompt,rubric,notes\n1,"…",""'}
              spellCheck={false}
              disabled={busy}
            />
          </label>

          {error ? (
            <p className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          ) : null}

          {progress && busy ? (
            <div className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                <span className="font-[family-name:var(--font-mono)] uppercase tracking-wide">
                  Progress
                </span>
                <span>
                  {progress.completed} / {progress.total} rows
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-2 rounded-full bg-amber-500 transition-[width] duration-300 ease-out"
                  style={{
                    width:
                      progress.total > 0
                        ? `${Math.min(100, (100 * progress.completed) / progress.total)}%`
                        : "0%",
                  }}
                />
              </div>
              {progress.completed === 0 && progress.total > 0 ? (
                <p className="text-xs text-zinc-500">Waiting for first LLM result…</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || props.guidelines.length === 0}
              onClick={() => void runPrecheck()}
              className="inline-flex min-h-[42px] flex-1 justify-center rounded-xl border border-amber-700/80 bg-amber-900/25 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Running…" : "Run pre-check"}
            </button>
            <button
              type="button"
              disabled={!busy}
              onClick={stopPrecheck}
              className="inline-flex min-h-[42px] shrink-0 justify-center rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-rose-800/60 hover:bg-rose-950/30 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Stop
            </button>
          </div>
        </section>
      </div>

      {display ? (
        <section className="mt-10 border-t border-zinc-800/80 pt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Results</h2>
              {isLiveUpdating ? (
                <p className="mt-1 text-sm text-amber-200/90">
                  Live — rows appear as each LLM call completes. You can stop at any time; rows
                  already scored are kept.
                </p>
              ) : null}
              {data?.stoppedEarly ? (
                <p className="mt-1 text-sm text-amber-200/90">
                  Stopped before all rows were scored. Download includes only completed rows.
                </p>
              ) : null}
              <p className="mt-1 text-sm text-zinc-500">
                Scored against <span className="text-zinc-300">{display.guideline.name}</span>
                {display.userStorySource === "saved_world" && display.targetWorld ? (
                  <>
                    {" "}
                    · world <span className="text-zinc-300">{display.targetWorld.name}</span>
                  </>
                ) : display.userStorySource === "pasted" ? (
                  <> · pasted world / persona</>
                ) : (
                  <> · no world context</>
                )}{" "}
                · {display.summary.total} row{display.summary.total === 1 ? "" : "s"} · excellent{" "}
                {display.summary.excellent}, average {display.summary.average}, poor{" "}
                {display.summary.poor}
                {display.summary.failed > 0 ? `, errors ${display.summary.failed}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadResultsPdf()}
                disabled={!data}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save as PDF (print…)
              </button>
              <button
                type="button"
                onClick={downloadResultsCsv}
                disabled={!data}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download results CSV
              </button>
            </div>
          </div>

          {display.parseWarnings.length > 0 ? (
            <ul className="mt-4 list-inside list-disc rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
              {display.parseWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Id</th>
                  <th className="px-3 py-2">Author</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="min-w-[140px] px-3 py-2">Workflow audit</th>
                  <th className="min-w-[180px] px-3 py-2">Rationale</th>
                  <th className="min-w-[240px] px-3 py-2">Problem spots</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/90">
                {display.results.map((r) => (
                  <tr key={`${r.rowIndex}-${r.externalId ?? ""}`} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{r.rowIndex}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-zinc-400">
                      {r.externalId ?? "—"}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-zinc-300">
                      {r.writerName?.trim() ? r.writerName.trim() : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${scoreBadgeClass(r.score)}`}
                      >
                        {r.error ? "Error" : (r.score ?? "—")}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-zinc-300">
                      <PriorAuditCell audit={r.priorAudit} />
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {r.error ? (
                        <span className="text-rose-200/90">{r.error}</span>
                      ) : (
                        <span className="whitespace-pre-wrap">{r.rationale}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-zinc-300">
                      {r.error ? (
                        <span className="text-xs text-zinc-600">—</span>
                      ) : (
                        <ProblemAreasList areas={r.problemAreas ?? []} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-zinc-600">
            Same scoring rules as main prompt analysis (see{" "}
            <code className="text-zinc-500">lib/analyze-prompt.ts</code>). Writer rubric is passed as
            additional context only; the selected guideline remains authoritative. When a world or
            pasted persona is provided, it is sent as <code className="text-zinc-500">USER STORY</code>{" "}
            so the model can judge scenario fit as well as rubric alignment.{" "}
            <span className="text-zinc-500">Problem spots</span> are model-generated: each item names
            a source (prompt vs writer rubric vs guidelines, etc.), an optional quote, and what is
            wrong.{" "}
            <span className="text-zinc-500">Workflow audit</span> looks for an existing on-disk
            workflow audit (<code className="text-zinc-500">{traceExportsPath}/reports/task_*.md</code>
            ): first by task id from the sheet (including a <code className="text-zinc-500">task_</code>{" "}
            prefix when missing), else by normalized prompt prefix aligned with the YAML{" "}
            <code className="text-zinc-500">prompt</code> field (first 140 characters from export). It
            is independent of this page&apos;s guideline pre-check.
          </p>
        </section>
      ) : null}
    </div>
  );
}
