"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PrunedTasksAnalysis } from "@/lib/pruned-analysis";
import {
  buildEnvFilterOptionsFromRows,
  getEnvFilterShortLabel,
  parseEnvFilter,
  serializeEnvQueryValue,
} from "@/lib/task-environment";
import {
  buildProjectFilterOptionsFromRows,
  getProjectFilterShortLabel,
  parseProjectFilter,
  projectFilterInList,
  serializeProjectQueryValue,
  type ProjectFilter,
} from "@/lib/task-project";

const EXTRA_CONTEXT_STORAGE_KEY = "prunedAnalysisAdditionalContext";

type GuidelineOption = { id: string; name: string };

type ScopeRow = { envKey: string | null; projectKey: string };

export function PrunedAnalysisPanel(props: {
  guidelines: GuidelineOption[];
  scopeRows: ScopeRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PrunedTasksAnalysis | null>(null);
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [savedAtIso, setSavedAtIso] = useState<string | null>(null);
  const [selectedGuidelineIds, setSelectedGuidelineIds] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [environment, setEnvironment] = useState<string>("");
  const [additionalContext, setAdditionalContext] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(EXTRA_CONTEXT_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const projectChoices = useMemo(
    () =>
      buildProjectFilterOptionsFromRows(props.scopeRows).filter((p) => p !== "all"),
    [props.scopeRows],
  );

  const envFilterOptions = useMemo(
    () =>
      buildEnvFilterOptionsFromRows(props.scopeRows, projectFilter).filter(
        (e) => e !== "all" && e !== "unmapped",
      ),
    [props.scopeRows, projectFilter],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- URL search params drive filter state */
  useEffect(() => {
    const spObj = Object.fromEntries(searchParams.entries()) as Record<
      string,
      string | string[] | undefined
    >;

    if (projectChoices.length === 0) {
      setProjectFilter("all");
      setEnvironment("");
      setSelectedGuidelineIds([]);
      return;
    }

    let pf = parseProjectFilter(spObj);
    if (pf === "all" || !projectFilterInList(projectChoices, pf)) {
      pf = projectChoices[0];
      const p = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      p.set("project", serializeProjectQueryValue(pf));
      router.replace(
        `/reports/pruned-analysis?${p.toString()}`,
        { scroll: false },
      );
      return;
    }

    const envOptions = buildEnvFilterOptionsFromRows(props.scopeRows, pf).filter(
      (e) => e !== "all" && e !== "unmapped",
    );
    const envList = envOptions.map((o) => serializeEnvQueryValue(o));
    const reqEnv = parseEnvFilter(spObj);
    const reqSer =
      reqEnv === "all" || reqEnv === "unmapped"
        ? ""
        : serializeEnvQueryValue(reqEnv);
    const nextEnv =
      reqSer && envList.includes(reqSer) ? reqSer : (envList[0] ?? "");

    if (!nextEnv) {
      setProjectFilter(pf);
      setEnvironment("");
      const rawGuidelines = searchParams.get("guidelines") ?? "";
      const validIds = new Set(props.guidelines.map((g) => g.id));
      setSelectedGuidelineIds(
        rawGuidelines
          .split(",")
          .map((s) => s.trim())
          .filter((id) => id.length > 0 && validIds.has(id)),
      );
      return;
    }

    const urlEnv = searchParams.get("env") ?? "";
    if (urlEnv !== nextEnv) {
      const p = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      p.set("project", serializeProjectQueryValue(pf));
      p.set("env", nextEnv);
      router.replace(
        `/reports/pruned-analysis?${p.toString()}`,
        { scroll: false },
      );
      return;
    }

    const rawGuidelines = searchParams.get("guidelines") ?? "";
    const validIds = new Set(props.guidelines.map((g) => g.id));
    const nextGuidelines = rawGuidelines
      .split(",")
      .map((s) => s.trim())
      .filter((id) => id.length > 0 && validIds.has(id));

    setProjectFilter(pf);
    setEnvironment(nextEnv);
    setSelectedGuidelineIds(nextGuidelines);
  }, [searchParams, props.scopeRows, props.guidelines, router, projectChoices]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const guidelineScopeLabel =
    props.guidelines.length === 0
      ? "No rubrics"
      : selectedGuidelineIds.length === 0
        ? "All rubrics"
        : selectedGuidelineIds.length === 1
          ? (props.guidelines.find((g) => g.id === selectedGuidelineIds[0])?.name ??
            "1 rubric")
          : `${selectedGuidelineIds.length} rubrics`;
  const environmentFileStem = useMemo(() => {
    if (!environment) return "";
    if (!environment.startsWith("raw:")) return environment;
    try {
      return decodeURIComponent(environment.slice(4));
    } catch {
      return environment.slice(4);
    }
  }, [environment]);
  const reportEnvironmentLabel = useMemo(() => {
    const opt = envFilterOptions.find(
      (o) => serializeEnvQueryValue(o) === environment,
    );
    if (opt) return getEnvFilterShortLabel(opt);
    return environmentFileStem || environment || "Unknown";
  }, [envFilterOptions, environment, environmentFileStem]);
  const guidelineScopeKey = useMemo(() => {
    if (selectedGuidelineIds.length === 0) return "";
    return [...selectedGuidelineIds].sort().join(",");
  }, [selectedGuidelineIds]);

  function applyProject(nextProject: ProjectFilter) {
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    if (nextProject === "all") params.delete("project");
    else params.set("project", serializeProjectQueryValue(nextProject));
    params.delete("env");
    const qs = params.toString();
    router.push(qs ? `/reports/pruned-analysis?${qs}` : "/reports/pruned-analysis", {
      scroll: false,
    });
  }

  function applyScope(nextEnv: string, nextGuidelineIds: string[]) {
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    if (projectFilter !== "all") {
      params.set("project", serializeProjectQueryValue(projectFilter));
    }
    if (nextEnv) params.set("env", nextEnv);
    else params.delete("env");
    if (nextGuidelineIds.length > 0) {
      params.set("guidelines", [...nextGuidelineIds].sort().join(","));
    } else {
      params.delete("guidelines");
    }
    const qs = params.toString();
    router.push(qs ? `/reports/pruned-analysis?${qs}` : "/reports/pruned-analysis", {
      scroll: false,
    });
  }

  /* eslint-disable react-hooks/set-state-in-effect -- clear stale report before fetching latest for new scope */
  useEffect(() => {
    if (!environment || projectFilter === "all") return;
    const params = new URLSearchParams();
    params.set("project", serializeProjectQueryValue(projectFilter));
    params.set("env", environment);
    if (guidelineScopeKey) params.set("guidelines", guidelineScopeKey);
    setReport(null);
    setSavedAtIso(null);
    setLoadingSaved(true);
    fetch(`/api/pruned-analysis/latest?${params.toString()}`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        setReport((data.report ?? null) as PrunedTasksAnalysis | null);
        setSavedAtIso(typeof data.savedAt === "string" ? data.savedAt : null);
      })
      .catch(() => {
        // keep previous state if latest lookup fails
      })
      .finally(() => setLoadingSaved(false));
  }, [environment, guidelineScopeKey, projectFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function applyGuidelineFilter(nextIds: string[]) {
    const allIds = props.guidelines.map((g) => g.id);
    const isFull =
      allIds.length > 0 &&
      nextIds.length === allIds.length &&
      allIds.every((id) => nextIds.includes(id));
    if (nextIds.length === 0 || isFull) {
      applyScope(environment, []);
      return;
    }
    applyScope(environment, nextIds);
  }

  function toggleGuideline(id: string) {
    const all = props.guidelines.map((g) => g.id);
    if (selectedGuidelineIds.length === 0) {
      applyGuidelineFilter(all.filter((x) => x !== id));
      return;
    }
    const set = new Set(selectedGuidelineIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    applyGuidelineFilter([...set]);
  }

  async function run() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/pruned-analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: serializeProjectQueryValue(projectFilter),
          environment,
          additionalContext: additionalContext.trim(),
          guidelineIds: selectedGuidelineIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Request failed",
        );
        return;
      }
      setReport((data.report ?? null) as PrunedTasksAnalysis | null);
      setSampleCount(
        typeof data.sampleCount === "number" ? data.sampleCount : null,
      );
      setSourcePath(typeof data.sourcePath === "string" ? data.sourcePath : null);
      setSavedAtIso(typeof data.savedAt === "string" ? data.savedAt : null);
    } finally {
      setLoading(false);
    }
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Incident analysis
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Pruned task analysis
        </h1>
        <p className="mt-3 max-w-4xl text-lg leading-relaxed text-zinc-400">
          Analyze the pruned task set as a cohort to surface recurring failure
          themes, repeated targets, and concrete mitigation opportunities.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-400">Project</span>
          <select
            value={serializeProjectQueryValue(projectFilter)}
            onChange={(e) =>
              applyProject(parseProjectFilter({ project: e.target.value }))
            }
            disabled={loading || projectChoices.length === 0}
            className="max-w-[320px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80 disabled:opacity-50"
          >
            {projectChoices.map((opt) => (
              <option
                key={serializeProjectQueryValue(opt)}
                value={serializeProjectQueryValue(opt)}
              >
                {getProjectFilterShortLabel(opt)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-400">Environment</span>
          <select
            value={environment}
            onChange={(e) => applyScope(e.target.value, selectedGuidelineIds)}
            disabled={loading || envFilterOptions.length === 0}
            className="max-w-[320px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80 disabled:opacity-50"
          >
            {envFilterOptions.map((opt) => {
              const v = serializeEnvQueryValue(opt);
              return (
                <option key={v} value={v}>
                  {getEnvFilterShortLabel(opt)}
                </option>
              );
            })}
          </select>
          <span className="text-xs text-zinc-500">
            Pruned file target resolves to{" "}
            <code className="text-zinc-400">
              all_prompt_status/
              {environmentFileStem || "(environment)"}
              -pruned.json
            </code>{" "}
            for the selected environment.
          </span>
        </label>

        {props.guidelines.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-400">
              Reference rubrics
            </span>
            <div className="flex items-start gap-3">
              <details className="group relative">
                <summary className="cursor-pointer list-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none marker:content-none focus:border-amber-700/80 [&::-webkit-details-marker]:hidden">
                  Reference rubrics{" "}
                  <span className="text-zinc-500">({guidelineScopeLabel})</span>
                </summary>
                <div className="absolute left-0 z-50 mt-1 max-h-64 w-[min(100vw-2rem,22rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
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
                              selectedGuidelineIds.length === 0 ||
                              selectedGuidelineIds.includes(g.id)
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
              <p className="pt-1 text-xs text-zinc-500">
                Only selected rubrics are referenced in analysis.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-400">
          Additional context for this run{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </span>
        <textarea
          value={additionalContext}
          onChange={(e) => {
            const v = e.target.value.slice(0, 12000);
            setAdditionalContext(v);
            try {
              sessionStorage.setItem(EXTRA_CONTEXT_STORAGE_KEY, v);
            } catch {
              // ignore
            }
          }}
          rows={4}
          disabled={loading}
          placeholder='e.g. "Most pruned tasks failed because they overconstrained the workflow and caused fragile verifier interactions."'
          className="resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-700/80 focus:outline-none focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={
            loading ||
            !environment ||
            projectFilter === "all" ||
            envFilterOptions.length === 0
          }
          className="rounded-full bg-amber-500/90 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
        >
          {loading ? "Analyzing pruned tasks…" : "Run pruned analysis"}
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
        {sourcePath ? (
          <p className="text-xs text-zinc-500">
            Source: <code className="text-zinc-400">{sourcePath}</code>
            {sampleCount != null ? ` · ${sampleCount} prompts` : ""}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {report ? (
        <div className="insights-report-print flex flex-col gap-6 bg-white p-8 text-zinc-900 shadow-xl ring-1 ring-zinc-200">
          <header className="border-b border-zinc-200 pb-4">
            <h2 className="font-[family-name:var(--font-sans)] text-2xl font-bold tracking-tight text-zinc-900">
              Pruned Analysis Report - {reportEnvironmentLabel}
            </h2>
            {savedAtIso ? (
              <p className="mt-2 text-xs text-zinc-500 print:hidden">
                Generated{" "}
                {new Date(savedAtIso).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            ) : null}
          </header>
          <section className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-zinc-900">
              Overview
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
              {report.overview}
            </p>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-zinc-900">
              Common themes
            </h2>
            <div className="mt-5 flex flex-col gap-4">
              {report.commonThemes.map((t, i) => (
                <article
                  key={`${t.title}-${i}`}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
                >
                  <h3 className="text-base font-semibold text-zinc-900">
                    {t.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    {t.body}
                  </p>
                  <p className="mt-3 text-xs text-zinc-500">
                    Evidence keys: {t.evidenceTaskKeys.join(", ")}
                  </p>
                  {t.evidenceTaskKeys.length > 0 &&
                  (!t.evidencePrompts || t.evidencePrompts.length === 0) ? (
                    <p className="mt-2 text-xs text-amber-800/90">
                      Full prompts could not be matched to these keys (often
                      abbreviated placeholders like task_25). Re-run analysis —
                      keys are now resolved to real task_key values and full
                      prompt text where possible.
                    </p>
                  ) : null}
                  {t.evidencePrompts && t.evidencePrompts.length > 0 ? (
                    <div className="mt-3 flex flex-col gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Evidence prompts
                      </p>
                      {t.evidencePrompts.map((ep, j) => (
                        <div
                          key={`${ep.key}-${j}`}
                          className="rounded-lg border border-zinc-200 bg-white p-3"
                        >
                          <p className="text-xs font-medium text-zinc-600">
                            {ep.key}
                          </p>
                          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                            Prompt
                          </p>
                          <pre className="mt-2 max-h-[min(70vh,32rem)] overflow-auto whitespace-pre-wrap print:max-h-none print:overflow-visible font-[family-name:var(--font-mono)] text-[12px] leading-relaxed text-zinc-700">
                            {ep.prompt}
                          </pre>
                          {ep.coreNotes ? (
                            <div className="mt-3 border-t border-zinc-100 pt-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                                Core notes
                              </p>
                              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap print:max-h-none print:overflow-visible font-[family-name:var(--font-mono)] text-[12px] leading-relaxed text-zinc-600">
                                {ep.coreNotes}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-zinc-900">
              Recurring targets
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-700">
              {report.recurringTargets.map((t, i) => (
                <li key={`${t}-${i}`}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-zinc-900">
              Recommended interventions
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              {report.recommendations.map((r, i) => (
                <article
                  key={`${r.title}-${i}`}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
                >
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {r.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                    {r.body}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          {loadingSaved
            ? "Loading saved report for this environment and rubric scope…"
            : envFilterOptions.length === 0
            ? "No environments for this project yet — ingest JSON with env_key values first."
            : "No analysis yet. Run the pruned set analysis to generate a grouped report."}
        </p>
      )}
    </div>
  );
}
