import Link from "next/link";
import {
  aggregateRecentOnboardSummaries,
  analyzeRecentOnboards,
  collectRecentOnboardEnvironmentOptions,
  collectRecentOnboardProjectOptions,
  prepareRecentOnboardsList,
  RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS,
  type RecentOnboardsEnvironmentFilterMode,
  type RecentOnboardsProjectFilterMode,
  type RecentOnboardsSortMode,
  type RecentOnboardsVisibilityMode,
  type RecentOnboardScoreBreakdown,
} from "@/lib/recent-onboards-analysis";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type TaskFilterMode = "all" | "include" | "exclude";

const FILTER_CARD_CLASS =
  "rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3";
const FILTER_LABEL_CLASS =
  "text-xs font-medium uppercase tracking-[0.16em] text-zinc-500";
const FILTER_SELECT_CLASS =
  "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200";
const FILTER_OPTION_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/50 px-3 py-1.5 text-xs text-zinc-300";
const FILTER_CHIP_BASE_CLASS =
  "rounded-full border px-3 py-1.5 text-xs font-medium transition";
const FILTER_CHIP_INACTIVE_CLASS =
  "border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200";

function filterChipClass(isActive: boolean, activeClassName: string): string {
  return `${FILTER_CHIP_BASE_CLASS} ${
    isActive ? activeClassName : FILTER_CHIP_INACTIVE_CLASS
  }`;
}

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function ScorePills({ scores }: { scores: RecentOnboardScoreBreakdown }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      <span className="rounded-full border border-emerald-900/60 bg-emerald-950/30 px-2 py-0.5 text-emerald-200/90">
        E {scores.excellent}
      </span>
      <span className="rounded-full border border-sky-900/60 bg-sky-950/30 px-2 py-0.5 text-sky-200/90">
        A {scores.average}
      </span>
      <span className="rounded-full border border-rose-900/60 bg-rose-950/30 px-2 py-0.5 text-rose-200/90">
        P {scores.poor}
      </span>
      <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-400">
        Pruned {scores.pruned}
      </span>
    </div>
  );
}

function TopCounts({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; count: number }>;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No authored tasks</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rows.slice(0, 5).map((row) => (
            <span
              key={row.key}
              className="rounded-full border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-xs text-zinc-300"
            >
              {row.key} · {row.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function parseSortMode(
  raw: string | string[] | undefined,
): RecentOnboardsSortMode {
  return raw === "records_first" ? "records_first" : "csv";
}

function parseVisibilityMode(
  raw: string | string[] | undefined,
): RecentOnboardsVisibilityMode {
  return raw === "with_tasks" ? "with_tasks" : "all";
}

function parseTaskFilterMode(
  raw: string | string[] | undefined,
): TaskFilterMode {
  return raw === "include" || raw === "exclude" ? raw : "all";
}

function queryValues(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

function isTaskFilterActive(mode: TaskFilterMode, values: string[]): boolean {
  return mode !== "all" && values.length > 0;
}

function parseMinFeedbackFilter(raw: string | string[] | undefined): boolean {
  return queryValues(raw).includes(String(RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS));
}

function taskFilterSummaryText(opts: {
  mode: TaskFilterMode;
  values: string[];
  singularLabel: string;
  allLabel: string;
}): string {
  if (!isTaskFilterActive(opts.mode, opts.values)) return opts.allLabel;
  const verb = opts.mode === "include" ? "Including" : "Excluding";
  const noun =
    opts.values.length === 1 ? opts.singularLabel : `${opts.singularLabel}s`;
  return `${verb} ${opts.values.length} ${noun}.`;
}

function recentOnboardsHref(opts: {
  pathname?: string;
  sortMode: RecentOnboardsSortMode;
  visibilityMode: RecentOnboardsVisibilityMode;
  projectMode: RecentOnboardsProjectFilterMode;
  projectValues: string[];
  environmentMode: RecentOnboardsEnvironmentFilterMode;
  environmentValues: string[];
  requireMinFeedback: boolean;
}): string {
  const params = new URLSearchParams();
  if (opts.sortMode !== "csv") params.set("sort", opts.sortMode);
  if (opts.visibilityMode !== "all") params.set("show", opts.visibilityMode);
  if (opts.projectMode !== "all" && opts.projectValues.length > 0) {
    params.set("projectMode", opts.projectMode);
    for (const project of opts.projectValues) params.append("project", project);
  }
  if (opts.environmentMode !== "all" && opts.environmentValues.length > 0) {
    params.set("envMode", opts.environmentMode);
    for (const env of opts.environmentValues) params.append("env", env);
  }
  if (opts.requireMinFeedback) {
    params.set("minFeedback", String(RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS));
  }
  const qs = params.toString();
  const pathname = opts.pathname ?? "/special-projects/recent-onboards";
  return qs ? `${pathname}?${qs}` : pathname;
}

export default async function RecentOnboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sortMode = parseSortMode(sp.sort);
  const visibilityMode = parseVisibilityMode(sp.show);
  const projectMode = parseTaskFilterMode(sp.projectMode);
  const environmentMode = parseTaskFilterMode(sp.envMode);
  const requireMinFeedback = parseMinFeedbackFilter(sp.minFeedback);
  const analysis = await analyzeRecentOnboards(prisma);
  const projectOptions = collectRecentOnboardProjectOptions(analysis.summaries);
  const environmentOptions = collectRecentOnboardEnvironmentOptions(
    analysis.summaries,
  );
  const allowedProjects = new Set(projectOptions.map((opt) => opt.value));
  const allowedEnvironments = new Set(environmentOptions.map((opt) => opt.value));
  const projectValues = queryValues(sp.project).filter((value) =>
    allowedProjects.has(value),
  );
  const environmentValues = queryValues(sp.env).filter((value) =>
    allowedEnvironments.has(value),
  );
  const selectedProjectSet = new Set(projectValues);
  const selectedEnvironmentSet = new Set(environmentValues);
  const { filteredSummaries, onboardsWithTasks, sortedSummaries } =
    prepareRecentOnboardsList(
      analysis.summaries,
      {
        sortMode,
        visibilityMode,
        projectFilter: { mode: projectMode, values: selectedProjectSet },
        environmentFilter: {
          mode: environmentMode,
          values: selectedEnvironmentSet,
        },
        requireMinFeedback,
      },
    );
  const aggregate = aggregateRecentOnboardSummaries(filteredSummaries);
  const matchedOnboards = analysis.summaries.filter((summary) => summary.userId);
  const exportHref = recentOnboardsHref({
    pathname: "/api/special-projects/recent-onboards/export",
    sortMode,
    visibilityMode,
    projectMode,
    projectValues,
    environmentMode,
    environmentValues,
    requireMinFeedback,
  });
  const projectFilterActive = isTaskFilterActive(projectMode, projectValues);
  const envFilterActive = isTaskFilterActive(environmentMode, environmentValues);
  const anyTaskFilterActive =
    projectFilterActive || envFilterActive || requireMinFeedback;
  const hasOnboardRows = analysis.summaries.length > 0;
  const projectFilterSummary = taskFilterSummaryText({
    mode: projectMode,
    values: projectValues,
    singularLabel: "project",
    allLabel: "All projects are included.",
  });
  const environmentFilterSummary = taskFilterSummaryText({
    mode: environmentMode,
    values: environmentValues,
    singularLabel: "environment",
    allLabel: "All environments are included.",
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-14">
      <div>
        <Link
          href="/special-projects"
          className="text-sm text-zinc-500 transition hover:text-amber-200/90"
        >
          ← All special projects
        </Link>
      </div>

      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Special projects / Onboards
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Recent onboard task quality
        </h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Reads a local CSV of onboard emails, maps each email to an imported user id from{" "}
          <code className="text-zinc-300">users/users.json</code>, then summarizes authored
          prompt/task quality from existing imported prompt data.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Local input
            </p>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-zinc-200">
              {analysis.csvRelativePath}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              This file lives under <code>projects/</code>, so it stays local and gitignored.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              analysis.csvExists
                ? "border-emerald-800/60 bg-emerald-950/35 text-emerald-200/90"
                : "border-amber-900/60 bg-amber-950/30 text-amber-200/90"
            }`}
          >
            {analysis.csvExists ? "CSV found" : "CSV missing"}
          </span>
        </div>
        {!analysis.csvExists ? (
          <div className="mt-5 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-100/85">
            <p>Create the local CSV before using this report:</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950/80 p-3 text-xs text-amber-100/80">
              <code>{`email\nperson@example.com\nother@example.com`}</code>
            </pre>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Emails</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-50">
            {analysis.inputEmails.length}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {analysis.duplicateEmails.length} duplicate ignored
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Matched users</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-50">
            {matchedOnboards.length}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {analysis.unmatchedEmails.length} unmatched
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Authored tasks</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-50">
            {aggregate.total}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {onboardsWithTasks.length} onboards with tasks
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Poor rate</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-50">
            {pct(aggregate.poorPercent)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {aggregate.classified} classified tasks
          </p>
        </div>
      </section>

      {analysis.invalidRows.length > 0 || analysis.unmatchedEmails.length > 0 ? (
        <details className="rounded-2xl border border-amber-900/40 bg-amber-950/15 p-5">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-100/90">
                Lookup notes
              </h2>
              <span className="text-xs text-amber-100/70">
                {analysis.unmatchedEmails.length} unmatched
                {analysis.invalidRows.length > 0
                  ? ` · ${analysis.invalidRows.length} invalid rows`
                  : ""}
                {" · click to expand"}
              </span>
            </div>
          </summary>
          <div className="mt-4 max-h-56 overflow-y-auto pr-2">
            {analysis.unmatchedEmails.length > 0 ? (
              <p className="text-sm leading-relaxed text-amber-100/80">
                <span className="font-medium text-amber-100/95">Unmatched emails:</span>{" "}
                {analysis.unmatchedEmails.map((r) => r.email).join(", ")}
              </p>
            ) : null}
            {analysis.invalidRows.length > 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-amber-100/70">
                <span className="font-medium text-amber-100/90">Invalid rows:</span>{" "}
                {analysis.invalidRows
                  .map((r) => `row ${r.rowNumber}: ${r.value}`)
                  .join("; ")}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      <details className="group rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-3">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                Filters, sorting & export
              </p>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                {sortMode === "records_first"
                  ? "Users with authored records first."
                  : "CSV order."}{" "}
                {visibilityMode === "with_tasks"
                  ? "Hiding users without tasks."
                  : "Showing all rows."}{" "}
                {projectFilterSummary} {environmentFilterSummary}{" "}
                {requireMinFeedback
                  ? `${RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS}+ feedback records required.`
                  : "No feedback minimum."}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs font-medium text-zinc-400">
              <span className="group-open:hidden">Open controls</span>
              <span className="hidden group-open:inline">Close controls</span>
            </span>
          </div>
        </summary>

        <form action="/special-projects/recent-onboards" className="mt-4">
          {sortMode !== "csv" ? (
            <input type="hidden" name="sort" value={sortMode} />
          ) : null}
          {visibilityMode !== "all" ? (
            <input type="hidden" name="show" value={visibilityMode} />
          ) : null}

          <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <div className={FILTER_CARD_CLASS}>
              <p className={FILTER_LABEL_CLASS}>Sort</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={recentOnboardsHref({
                    sortMode: "csv",
                    visibilityMode,
                    projectMode,
                    projectValues,
                    environmentMode,
                    environmentValues,
                    requireMinFeedback,
                  })}
                  className={filterChipClass(
                    sortMode === "csv",
                    "border-amber-700/70 bg-amber-950/30 text-amber-100",
                  )}
                >
                  CSV order
                </Link>
                <Link
                  href={recentOnboardsHref({
                    sortMode: "records_first",
                    visibilityMode,
                    projectMode,
                    projectValues,
                    environmentMode,
                    environmentValues,
                    requireMinFeedback,
                  })}
                  className={filterChipClass(
                    sortMode === "records_first",
                    "border-amber-700/70 bg-amber-950/30 text-amber-100",
                  )}
                >
                  Records first
                </Link>
              </div>
            </div>

            <div className={FILTER_CARD_CLASS}>
              <p className={FILTER_LABEL_CLASS}>Rows</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={recentOnboardsHref({
                    sortMode,
                    visibilityMode: "all",
                    projectMode,
                    projectValues,
                    environmentMode,
                    environmentValues,
                    requireMinFeedback,
                  })}
                  className={filterChipClass(
                    visibilityMode === "all",
                    "border-sky-700/70 bg-sky-950/30 text-sky-100",
                  )}
                >
                  Show all
                </Link>
                <Link
                  href={recentOnboardsHref({
                    sortMode,
                    visibilityMode: "with_tasks",
                    projectMode,
                    projectValues,
                    environmentMode,
                    environmentValues,
                    requireMinFeedback,
                  })}
                  className={filterChipClass(
                    visibilityMode === "with_tasks",
                    "border-sky-700/70 bg-sky-950/30 text-sky-100",
                  )}
                >
                  Hide users without tasks
                </Link>
              </div>
            </div>

            {hasOnboardRows && projectOptions.length > 0 ? (
              <div className={FILTER_CARD_CLASS}>
                <div className="flex items-center justify-between gap-3">
                  <p className={FILTER_LABEL_CLASS}>Project</p>
                  <select
                    name="projectMode"
                    defaultValue={projectMode}
                    className={FILTER_SELECT_CLASS}
                  >
                    <option value="all">All projects</option>
                    <option value="include">Include selected</option>
                    <option value="exclude">Exclude selected</option>
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {projectOptions.map((option) => (
                    <label
                      key={option.value}
                      className={FILTER_OPTION_CLASS}
                    >
                      <input
                        type="checkbox"
                        name="project"
                        value={option.value}
                        defaultChecked={selectedProjectSet.has(option.value)}
                        className="h-3 w-3 accent-amber-500"
                      />
                      <span>
                        {option.label} · {option.count}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {hasOnboardRows && environmentOptions.length > 0 ? (
              <div className={FILTER_CARD_CLASS}>
                <div className="flex items-center justify-between gap-3">
                  <p className={FILTER_LABEL_CLASS}>Environment</p>
                  <select
                    name="envMode"
                    defaultValue={environmentMode}
                    className={FILTER_SELECT_CLASS}
                  >
                    <option value="all">All environments</option>
                    <option value="include">Include selected</option>
                    <option value="exclude">Exclude selected</option>
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {environmentOptions.map((option) => (
                    <label
                      key={option.value}
                      className={FILTER_OPTION_CLASS}
                    >
                      <input
                        type="checkbox"
                        name="env"
                        value={option.value}
                        defaultChecked={selectedEnvironmentSet.has(option.value)}
                        className="h-3 w-3 accent-amber-500"
                      />
                      <span>
                        {option.label} · {option.count}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {hasOnboardRows ? (
              <label
                className={`${FILTER_CARD_CLASS} flex min-h-full cursor-pointer items-start gap-3 text-sm text-zinc-300`}
              >
                <input
                  type="checkbox"
                  name="minFeedback"
                  value={RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS}
                  defaultChecked={requireMinFeedback}
                  className="mt-1 h-3.5 w-3.5 accent-amber-500"
                />
                <span>
                  <span className="block font-medium text-zinc-200">
                    Require {RECENT_ONBOARDS_MIN_FEEDBACK_RECORDS}+ feedback records
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    Counted across all attributed feedback for the onboard.
                  </span>
                </span>
              </label>
            ) : null}

            <div
              className={`${FILTER_CARD_CLASS} flex min-h-full flex-wrap items-center justify-end gap-2`}
            >
              <Link
                href={exportHref}
                className="rounded-full border border-emerald-800/70 bg-emerald-950/25 px-4 py-1.5 text-xs font-medium text-emerald-100 transition hover:border-emerald-600/80"
              >
                Export CSV
              </Link>
              <button
                type="submit"
                className="rounded-full border border-amber-700/70 bg-amber-950/30 px-4 py-1.5 text-xs font-medium text-amber-100 transition hover:border-amber-500/80"
              >
                Apply
              </button>
              {anyTaskFilterActive ? (
                <Link
                  href={recentOnboardsHref({
                    sortMode,
                    visibilityMode,
                    projectMode: "all",
                    projectValues: [],
                    environmentMode: "all",
                    environmentValues: [],
                    requireMinFeedback: false,
                  })}
                  className="rounded-full border border-zinc-800 bg-zinc-950/50 px-4 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </div>
        </form>
      </details>

      <section className="overflow-x-auto rounded-2xl border border-zinc-800/90 bg-zinc-900/40">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">Onboard</th>
              <th className="px-4 py-3 text-right font-medium">Feedback</th>
              <th className="px-4 py-3 text-right font-medium">Tasks</th>
              <th className="px-4 py-3 text-right font-medium">Scored</th>
              <th className="px-4 py-3 text-right font-medium">Poor rate</th>
              <th className="px-4 py-3 font-medium">Quality</th>
              <th className="px-4 py-3 font-medium">Latest task</th>
              <th className="px-4 py-3 font-medium">Projects / envs / lifecycle</th>
            </tr>
          </thead>
          <tbody className="text-zinc-200">
            {sortedSummaries.map((summary) => (
              <tr
                key={summary.email}
                className="border-b border-zinc-800/50 align-top last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">
                    {summary.encodedUserKey ? (
                      <Link
                        href={`/users/${summary.encodedUserKey}`}
                        className="transition hover:text-amber-200"
                      >
                        {summary.displayName ?? summary.email}
                      </Link>
                    ) : (
                      (summary.displayName ?? summary.email)
                    )}
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-xs text-zinc-500">
                    {summary.email}
                  </div>
                  {!summary.userId ? (
                    <div className="mt-1 text-xs text-amber-300/80">No user id match</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">
                  {summary.feedbackCount}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">
                  {summary.scores.total}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">
                  {summary.scores.scored}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300">
                  {pct(summary.scores.poorPercent)}
                </td>
                <td className="px-4 py-3">
                  <ScorePills scores={summary.scores} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                  {dateLabel(summary.latestTaskIso)}
                </td>
                <td className="px-4 py-3">
                  <div className="grid gap-2">
                    <TopCounts title="Projects" rows={summary.projectCounts} />
                    <TopCounts title="Environments" rows={summary.environmentCounts} />
                    <TopCounts title="Lifecycle" rows={summary.lifecycleCounts} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedSummaries.length === 0 ? (
          <p className="px-5 py-8 text-sm text-zinc-500">
            {analysis.inputEmails.length === 0
              ? "No onboard emails loaded yet."
              : "No onboard emails match the current filters."}
          </p>
        ) : null}
      </section>

      {onboardsWithTasks.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-zinc-50">
            Authored task details
          </h2>
          {onboardsWithTasks.map((summary) => (
            <details
              key={summary.email}
              className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-4"
            >
              <summary className="cursor-pointer text-sm font-medium text-zinc-200">
                {summary.displayName ?? summary.email} · {summary.prompts.length} tasks
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="text-zinc-500">
                    <tr className="border-b border-zinc-800/80">
                      <th className="py-2 pr-3 font-medium">Task</th>
                      <th className="py-2 pr-3 font-medium">Project</th>
                      <th className="py-2 pr-3 font-medium">Env</th>
                      <th className="py-2 pr-3 font-medium">Lifecycle</th>
                      <th className="py-2 pr-3 font-medium">Modality</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {summary.prompts.map((prompt) => (
                      <tr
                        key={prompt.id}
                        className="border-b border-zinc-800/50 last:border-0"
                      >
                        <td className="py-2 pr-3 font-mono text-zinc-400">
                          {prompt.sourceKey ?? prompt.sourceId ?? prompt.id}
                        </td>
                        <td className="py-2 pr-3">
                          {prompt.projectKey || "unassigned"}
                        </td>
                        <td className="py-2 pr-3">{prompt.envKey ?? "unassigned"}</td>
                        <td className="py-2 pr-3">{prompt.lifecycleLabel}</td>
                        <td className="py-2 pr-3">{prompt.taskModality ?? "—"}</td>
                        <td className="py-2 pr-3">{prompt.score ?? "pending"}</td>
                        <td className="py-2 pr-3">
                          {dateLabel(prompt.sourceCreatedIso ?? prompt.createdAtIso)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
