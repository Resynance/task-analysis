"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CombinedWriterReportView } from "@/components/combined-writer-report-view";
import type { CombinedWriterReport } from "@/lib/combined-writer-report";
import {
  getEnvFilterShortLabel,
  parseEnvFilter,
  serializeEnvQueryValue,
  type EnvFilter,
} from "@/lib/task-environment";
import {
  getProjectFilterShortLabel,
  parseProjectFilter,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";

type GuidelineOption = { id: string; name: string };

export function CombinedReportsPanel(props: {
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  guidelines: GuidelineOption[];
  guidelineFilterIds: string[];
  initialReport: CombinedWriterReport | null;
  initialSummary: string | null;
  initialSavedAtIso: string | null;
  initialInsightsSavedAtIso: string | null;
  initialPrunedSavedAtIso: string | null;
  noEnvironmentAvailable: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [report, setReport] = useState(props.initialReport);
  const [summary, setSummary] = useState(props.initialSummary);
  const [savedAtIso, setSavedAtIso] = useState(props.initialSavedAtIso);
  const [insightsSavedAtIso, setInsightsSavedAtIso] = useState(props.initialInsightsSavedAtIso);
  const [prunedSavedAtIso, setPrunedSavedAtIso] = useState(
    props.initialPrunedSavedAtIso,
  );

  const guidelineScopeLabel =
    props.guidelines.length === 0
      ? "No rubrics"
      : props.guidelineFilterIds.length === 0
        ? "All rubrics"
        : props.guidelineFilterIds.length === 1
          ? (props.guidelines.find((g) => g.id === props.guidelineFilterIds[0])
              ?.name ?? "1 rubric")
          : `${props.guidelineFilterIds.length} rubrics`;

  const selectEnvValue = useMemo(
    () => serializeEnvQueryValue(props.envFilter),
    [props.envFilter],
  );

  function mergeSearchParams() {
    return new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
  }

  function applyProjectFilter(next: ProjectFilter) {
    const params = mergeSearchParams();
    if (next === "all") params.delete("project");
    else params.set("project", serializeProjectQueryValue(next));
    params.delete("env");
    const qs = params.toString();
    router.push(qs ? `/reports/combined?${qs}` : "/reports/combined", {
      scroll: false,
    });
  }

  function applyEnvFilter(next: EnvFilter) {
    const params = mergeSearchParams();
    params.set("env", serializeEnvQueryValue(next));
    if (props.guidelineFilterIds.length > 0) {
      params.set("guidelines", props.guidelineFilterIds.join(","));
    }
    const qs = params.toString();
    router.push(qs ? `/reports/combined?${qs}` : "/reports/combined", {
      scroll: false,
    });
  }

  function applyGuidelineFilter(nextIds: string[]) {
    const allIds = props.guidelines.map((g) => g.id);
    const isFull =
      allIds.length > 0 &&
      nextIds.length === allIds.length &&
      allIds.every((id) => nextIds.includes(id));
    const normalized = nextIds.length === 0 || isFull ? [] : nextIds;

    const params = mergeSearchParams();
    if (props.projectFilter !== "all") {
      params.set("project", serializeProjectQueryValue(props.projectFilter));
    }
    params.set("env", serializeEnvQueryValue(props.envFilter));
    if (normalized.length > 0) {
      params.set("guidelines", normalized.join(","));
    } else {
      params.delete("guidelines");
    }
    const qs = params.toString();
    router.push(qs ? `/reports/combined?${qs}` : "/reports/combined", {
      scroll: false,
    });
  }

  function toggleGuideline(id: string) {
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

  async function runCombined() {
    setError(null);
    setLoading(true);
    try {
      const payload = {
        project: serializeProjectQueryValue(props.projectFilter),
        environment: serializeEnvQueryValue(props.envFilter),
        guidelineIds: props.guidelineFilterIds,
        ...(additionalContext.trim().length > 0
          ? { additionalContext: additionalContext.trim() }
          : {}),
      };

      const res = await fetch("/api/reports/combined/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Combined report generation failed",
        );
        return;
      }

      setReport((data.report ?? null) as CombinedWriterReport | null);
      setSummary(typeof data.summary === "string" ? data.summary : null);
      setSavedAtIso(typeof data.savedAt === "string" ? data.savedAt : null);
      const source = data.source as
        | { insightsSavedAt?: unknown; prunedSavedAt?: unknown }
        | undefined;
      setInsightsSavedAtIso(
        typeof source?.insightsSavedAt === "string" ? source.insightsSavedAt : null,
      );
      setPrunedSavedAtIso(
        typeof source?.prunedSavedAt === "string" ? source.prunedSavedAt : null,
      );
      router.refresh();
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  function printReport() {
    window.print();
  }

  const formatSavedAt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Not generated";

  const combinedSavedAtIso = useMemo(
    () => savedAtIso ?? insightsSavedAtIso ?? prunedSavedAtIso ?? null,
    [savedAtIso, insightsSavedAtIso, prunedSavedAtIso],
  );

  const generatedLine =
    combinedSavedAtIso != null
      ? `Saved ${new Date(combinedSavedAtIso).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })} · ${summary ?? ""}`
      : undefined;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Reports / Combined
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Combined report
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-zinc-400">
          Generate runs <strong className="font-medium text-zinc-300">new</strong>{" "}
          coaching insights and pruned analysis for this environment and rubric
          scope in one pass, then shows them together. Saved copies on the
          individual report pages update to match.
        </p>
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Saved report status
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            Combined last refreshed:{" "}
            <span className="font-medium text-zinc-200">
              {formatSavedAt(combinedSavedAtIso)}
            </span>
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            Insights: {formatSavedAt(insightsSavedAtIso)} · Pruned analysis:{" "}
            {formatSavedAt(prunedSavedAtIso)}
          </p>
        </div>
      </header>

      {props.noEnvironmentAvailable ? (
        <p className="text-sm text-amber-200/90" role="status">
          No projects or evaluation environments found yet — ingest JSON under{" "}
          <code className="text-zinc-400">prompts/</code> with{" "}
          <code className="text-zinc-400">env_key</code> values first.
        </p>
      ) : (
        <>
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
                className="max-w-[min(100vw-2rem,16rem)] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                disabled={loading}
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
                value={selectEnvValue}
                onChange={(e) => applyEnvFilter(parseEnvFilter({ env: e.target.value }))}
                className="max-w-[min(100vw-2rem,18rem)] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                disabled={loading}
              >
                {props.envFilterOptions.map((opt) => {
                  const ser = serializeEnvQueryValue(opt);
                  const label = getEnvFilterShortLabel(opt);
                  return (
                    <option key={ser} value={ser}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>

            {props.guidelines.length > 0 ? (
              <details className="group relative">
                <summary className="cursor-pointer list-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none marker:content-none focus:border-amber-700/80 [&::-webkit-details-marker]:hidden">
                  Scoring rubrics{" "}
                  <span className="text-zinc-500">({guidelineScopeLabel})</span>
                </summary>
                <div className="absolute right-0 z-50 mt-1 max-h-64 w-[min(100vw-2rem,20rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => applyGuidelineFilter([])}
                      className="text-xs text-amber-200/90 hover:text-amber-100"
                    >
                      All rubrics
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
                            onChange={() => toggleGuideline(g.id)}
                          />
                          <span>{g.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-400">
              Additional context for both analyses{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <textarea
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value.slice(0, 12000))}
              disabled={loading}
              rows={4}
              placeholder='e.g. "Prompts were intentionally more open-ended this month."'
              className="resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
            />
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={runCombined}
              disabled={loading}
              className="rounded-full bg-amber-500/90 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
            >
              {loading
                ? "Regenerating insights & pruned analysis…"
                : "Regenerate combined report"}
            </button>
            {report && (
              <button
                type="button"
                onClick={printReport}
                className="rounded-full border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Print / Save as PDF
              </button>
            )}
            {error ? (
              <p className="text-sm text-rose-300" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </>
      )}

      {report ? (
        <div className="insights-report-print flex flex-col gap-8">
          <section className="rounded-2xl bg-white p-8 text-zinc-900 shadow-xl ring-1 ring-zinc-200">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Combined report
            </p>
            <h2 className="mt-1 font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
              {`Combined Report - ${getEnvFilterShortLabel(props.envFilter)}`}
            </h2>
            <p className="mt-3 text-sm text-zinc-700">
              Scope: {getEnvFilterShortLabel(props.envFilter)} · {guidelineScopeLabel}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Combined refreshed: {formatSavedAt(combinedSavedAtIso)}
              {" · "}Insights: {formatSavedAt(insightsSavedAtIso)}
              {" · "}Pruned: {formatSavedAt(prunedSavedAtIso)}
            </p>
          </section>

          <CombinedWriterReportView report={report} generatedLine={generatedLine} />
        </div>
      ) : (
        !props.noEnvironmentAvailable && (
          <p className="text-sm text-zinc-500">
            No saved reports for this scope yet — click Regenerate combined report
            to run both analyses and save new versions.
          </p>
        )
      )}
    </div>
  );
}
