"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CoachingInsightReportView } from "@/components/coaching-insight-report-view";
import type { CoachingInsightReport } from "@/lib/coaching-insight-report";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";
import {
  type EnvFilter,
  getEnvironmentLabel,
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

const COACHING_EXTRA_CONTEXT_STORAGE_KEY =
  "coachingInsightsAdditionalContext";

export function InsightsPanel(props: {
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  /** Serialized env key → scored prompts newer than saved report (or no report yet). */
  envStaleBySerializedKey: Record<string, boolean>;
  guidelines: GuidelineOption[];
  guidelineFilterIds: string[];
  /** Env keys that already have a saved report for this project + rubric scope. */
  insightSavedEnvKeys: string[];
  initialReport: CoachingInsightReport | null;
  initialSummary: string | null;
  savedAtIso: string | null;
  noEnvironmentAvailable: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(props.initialSummary);
  const [report, setReport] = useState<CoachingInsightReport | null>(
    props.initialReport,
  );
  const [savedAtIso, setSavedAtIso] = useState<string | null>(
    props.savedAtIso,
  );
  const [additionalContext, setAdditionalContext] = useState("");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync server-rendered props into local state */
    setReport(props.initialReport);
    setSummary(props.initialSummary);
    setSavedAtIso(props.savedAtIso);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [props.initialReport, props.initialSummary, props.savedAtIso]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset notice when scope changes
    setBatchNotice(null);
  }, [props.projectFilter, props.envFilter, props.guidelineFilterIds]);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(COACHING_EXTRA_CONTEXT_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted draft once on mount
      if (s) setAdditionalContext(s);
    } catch {
      /* ignore */
    }
  }, []);

  const guidelineScopeLabel = useMemo(() => {
    if (props.guidelines.length === 0) return "No rubrics";
    if (props.guidelineFilterIds.length === 0) return "All rubrics";
    if (props.guidelineFilterIds.length === 1) {
      return (
        props.guidelines.find((g) => g.id === props.guidelineFilterIds[0])
          ?.name ?? "1 rubric"
      );
    }
    return `${props.guidelineFilterIds.length} rubrics`;
  }, [props.guidelineFilterIds, props.guidelines]);

  function mergeSearchParams(): URLSearchParams {
    return new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
  }

  function applyProjectFilter(next: ProjectFilter) {
    setError(null);
    setBatchNotice(null);
    const params = mergeSearchParams();
    if (next === "all") {
      params.delete("project");
    } else {
      params.set("project", serializeProjectQueryValue(next));
    }
    params.delete("env");
    const qs = params.toString();
    router.push(qs ? `/reports/insights?${qs}` : "/reports/insights", {
      scroll: false,
    });
  }

  function applyEnvFilter(next: EnvFilter) {
    setError(null);
    setBatchNotice(null);
    const params = mergeSearchParams();
    params.set("env", serializeEnvQueryValue(next));
    const qs = params.toString();
    router.push(qs ? `/reports/insights?${qs}` : "/reports/insights", {
      scroll: false,
    });
  }

  function applyGuidelineFilter(nextIds: string[]) {
    setError(null);
    setBatchNotice(null);
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
    const qs = params.toString();
    router.push(qs ? `/reports/insights?${qs}` : "/reports/insights", {
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

  const selectEnvValue = serializeEnvQueryValue(props.envFilter);

  async function run() {
    if (props.projectFilter === "all" || props.noEnvironmentAvailable) {
      return;
    }
    setError(null);
    setBatchNotice(null);
    setLoading(true);
    try {
      const trimmed = additionalContext.trim();
      const res = await fetch("/api/insights/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: serializeProjectQueryValue(props.projectFilter),
          environment: serializeEnvQueryValue(props.envFilter),
          guidelineIds: props.guidelineFilterIds,
          ...(trimmed.length > 0 ? { additionalContext: trimmed } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        batch?: boolean;
        completed?: number;
        attempted?: number;
        results?: { envKey: string; savedAt: string; summary: string }[];
        failures?: { envKey: string; error: string }[];
        report?: CoachingInsightReport;
        summary?: string;
        savedAt?: string;
      };
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Request failed",
        );
        return;
      }
      if (data.batch === true) {
        const completed = data.completed ?? 0;
        const attempted = data.attempted ?? completed;
        const failures = data.failures ?? [];
        let msg = `Saved coaching insights for ${completed} of ${attempted} environment(s). Choose an environment above to open its report.`;
        if (failures.length > 0) {
          msg += ` Not completed: ${failures
            .map((f) => `${f.envKey} (${f.error})`)
            .join("; ")}`;
        }
        setBatchNotice(msg);
        setReport(null);
        setSummary(null);
        setSavedAtIso(null);
        router.refresh();
        requestOpenRouterCreditsRefresh();
        return;
      }
      if (data.report && typeof data.summary === "string") {
        setReport(data.report as CoachingInsightReport);
        setSummary(data.summary);
        setSavedAtIso(
          typeof data.savedAt === "string" ? data.savedAt : null,
        );
        router.refresh();
      }
      requestOpenRouterCreditsRefresh();
    } finally {
      setLoading(false);
    }
  }

  function printReport() {
    window.print();
  }

  const generatedLine =
    savedAtIso != null
      ? `Saved ${new Date(savedAtIso).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })} · ${summary ?? ""}`
      : undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Meta-analysis
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
            Coaching insights
          </h1>
          <span className="relative inline-flex print:hidden">
            <button
              type="button"
              className="peer rounded-full border border-zinc-600 bg-zinc-900/80 p-0.5 text-zinc-400 outline-none transition hover:border-amber-700/60 hover:text-amber-200/90 focus-visible:ring-1 focus-visible:ring-amber-600/40"
              aria-label="About coaching insights"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-2.5"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-[min(100vw-2rem,8rem)] -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[9px] leading-tight text-zinc-300 shadow-sm opacity-0 transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100"
            >
              Project- and environment-specific insights for{" "}
              <strong className="font-medium text-zinc-200">task authors</strong> from your{" "}
              <strong className="font-medium text-zinc-200">scored</strong> prompts (each JSON
              import is a project; tasks carry an evaluation{" "}
              <code className="text-zinc-400">env_key</code>). Content is test/evaluation data;
              guidance mirrors real-world task design from that evidence. Tasks marked{" "}
              <strong className="font-medium text-zinc-200">Pruned</strong> (listed in the
              environment pruned JSON) are omitted from this analysis. Reports are{" "}
              <strong className="font-medium text-zinc-200">saved</strong> per project,
              environment, and rubric scope. With{" "}
              <strong className="font-medium text-zinc-200">All environments</strong> you can
              batch-generate, but you must{" "}
              <strong className="font-medium text-zinc-200">pick one environment</strong> in the
              dropdown to view a saved report. Use{" "}
              <strong className="font-medium text-zinc-200">Print / Save as PDF</strong> for a
              print-ready layout.
            </div>
          </span>
        </div>
      </header>

      {props.noEnvironmentAvailable ? (
        <p className="text-sm text-amber-200/90" role="status">
          No projects or evaluation environments found yet — ingest JSON under{" "}
          <code className="text-zinc-400">prompts/</code> (each file is a project), ensure
          tasks include <code className="text-zinc-400">env_key</code>, then score them
          before generating insights.
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
                onChange={(e) =>
                  applyEnvFilter(parseEnvFilter({ env: e.target.value }))
                }
                className="max-w-[min(100vw-2rem,18rem)] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-amber-700/80"
                aria-describedby={
                  Object.values(props.envStaleBySerializedKey).some(Boolean)
                    ? "insights-env-stale-legend"
                    : undefined
                }
              >
                {props.envFilterOptions.map((opt) => {
                  const ser = serializeEnvQueryValue(opt);
                  const stale =
                    opt !== "all" &&
                    props.envStaleBySerializedKey[ser] === true;
                  const label = getEnvFilterShortLabel(opt);
                  return (
                    <option
                      key={ser}
                      value={ser}
                      aria-label={
                        stale
                          ? `${label}: new or reanalyzed rubric-scored prompts since last report for this rubric scope`
                          : undefined
                      }
                    >
                      {stale ? "● " : ""}
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
                          <span className="leading-snug">{g.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </div>

          {Object.values(props.envStaleBySerializedKey).some(Boolean) ? (
            <p
              id="insights-env-stale-legend"
              className="text-xs text-zinc-500"
            >
              <span className="text-amber-400/90" aria-hidden>
                ●
              </span>{" "}
              Environment has rubric-scored prompts (excellent / average / poor) that
              are new or were reanalyzed after the last saved report for this rubric
              scope — regenerate insights to refresh.
            </p>
          ) : null}

          {props.envFilter === "all" && props.insightSavedEnvKeys.length > 0 ? (
            <div
              className="rounded-xl border border-emerald-800/50 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-100/90"
              role="status"
            >
              <p className="font-medium text-emerald-200">Saved reports for this scope</p>
              <p className="mt-1 text-emerald-100/85">
                This project and rubric selection already has coaching insights for:{" "}
                <strong className="font-medium text-emerald-50">
                  {props.insightSavedEnvKeys
                    .map((k) => getEnvironmentLabel(k))
                    .join(", ")}
                </strong>
                . Choose that environment in the dropdown above to load and print it.
              </p>
            </div>
          ) : null}

          <p className="text-xs text-zinc-500">
            Scope:{" "}
            <strong className="font-medium text-zinc-400">
              {props.projectFilter === "all"
                ? "—"
                : getProjectFilterShortLabel(props.projectFilter)}
            </strong>
            {" · "}
            <strong className="font-medium text-zinc-400">
              {props.envFilter === "all"
                ? "—"
                : getEnvFilterShortLabel(props.envFilter)}
            </strong>
            {" · "}
            <strong className="font-medium text-zinc-400">
              {guidelineScopeLabel}
            </strong>
          </p>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-400">
              Additional context for{" "}
              {props.envFilter === "all"
                ? "each environment in this run"
                : "this run"}{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <textarea
              value={additionalContext}
              onChange={(e) => {
                const v = e.target.value.slice(0, 12000);
                setAdditionalContext(v);
                try {
                  sessionStorage.setItem(
                    COACHING_EXTRA_CONTEXT_STORAGE_KEY,
                    v,
                  );
                } catch {
                  /* ignore */
                }
              }}
              disabled={loading}
              rows={4}
              placeholder='e.g. "Participants were told prompts did not need to match user stories." or scoring caveats for this batch.'
              className="resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
            />
            <span className="text-xs text-zinc-600">
              Included only for the next generation; the model uses this to
              interpret samples (instructions to authors, review rules, etc.).
              Kept in this browser tab until you clear it.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={run}
              disabled={
                loading ||
                props.projectFilter === "all" ||
                props.noEnvironmentAvailable
              }
              title={
                props.envFilter === "all"
                  ? "Generates and saves one report per environment for this project."
                  : undefined
              }
              className="rounded-full bg-amber-500/90 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
            >
              {loading
                ? props.envFilter === "all"
                  ? "Running all environments…"
                  : "Running analysis…"
                : props.envFilter === "all"
                  ? "Generate insights (all environments)"
                  : "Generate insights"}
            </button>
            {report ? (
              <button
                type="button"
                onClick={printReport}
                className="rounded-full border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-amber-700/70 hover:text-amber-100"
              >
                Print / Save as PDF
              </button>
            ) : null}
            {error ? (
              <p className="text-sm text-rose-300" role="alert">
                {error}
              </p>
            ) : null}
            {batchNotice ? (
              <p className="max-w-prose text-sm text-emerald-200/90" role="status">
                {batchNotice}
              </p>
            ) : null}
          </div>

          <p className="text-xs leading-relaxed text-zinc-500">
            Generation needs{" "}
            <strong className="font-medium text-zinc-400">
              at least three EXCELLENT
            </strong>{" "}
            scored prompts <em>per environment</em> (after rubric filter, excluding PRUNED,
            and only tasks with <code className="text-zinc-400">task_lifecycle_status</code>{" "}
            unset or <code className="text-zinc-400">production</code>). If you have ~12
            tasks but most are AVERAGE/POOR, PRUNED, or staging, the run will fail until
            there are enough EXCELLENT rows in that scope.
          </p>

        </>
      )}

      {report ? (
        <div className="flex flex-col gap-4">
          <CoachingInsightReportView
            report={report}
            generatedLine={generatedLine}
          />
        </div>
      ) : (
        !props.noEnvironmentAvailable && (
          <p className="text-sm text-zinc-500">
            {props.envFilter === "all" ? (
              <>
                Select a single environment to view its saved report (the page does not
                show a combined “all envs” document). Or run{" "}
                <strong className="font-medium text-zinc-400">
                  Generate insights (all environments)
                </strong>{" "}
                to refresh each environment that has enough data — including{" "}
                <strong className="font-medium text-zinc-400">
                  at least three EXCELLENT
                </strong>{" "}
                tasks per env in this rubric scope (EXCELLENT / AVERAGE / POOR count toward
                samples; PRUNED does not).
              </>
            ) : (
              <>
                No saved report for this scope yet — click Generate insights (needs scored
                prompts in this environment; at least three must be EXCELLENT in scope;
                pruned-only rows do not count).
              </>
            )}
          </p>
        )
      )}
    </div>
  );
}
