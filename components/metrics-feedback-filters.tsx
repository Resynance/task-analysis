"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { QA_MIN_REVIEWER_RECORDS } from "@/lib/qa-reviewer-record-filter";
import {
  qaRejectionWindowShortLabel,
  type QaRejectionWindow,
} from "@/lib/qa-rejection-window";

const QA_WINDOW_OPTIONS: { value: QaRejectionWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Past 7 days" },
  { value: "30d", label: "Past 30 days" },
];

const FILTER_CARD_CLASS =
  "rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3";
const FILTER_LABEL_CLASS =
  "text-xs font-medium uppercase tracking-[0.16em] text-zinc-500";
const FILTER_SELECT_CLASS =
  "mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-700/80";

type MetricsFeedbackFiltersProps = {
  scopeLabel: string;
  projectFilter: ProjectFilter;
  projectFilterOptions: ProjectFilter[];
  envFilter: EnvFilter;
  envFilterOptions: EnvFilter[];
  qaWindow: QaRejectionWindow;
  minQaRecordsEnabled: boolean;
};

export function MetricsFeedbackFilters(props: MetricsFeedbackFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reviewerVolumeLabel = props.minQaRecordsEnabled
    ? `${QA_MIN_REVIEWER_RECORDS}+ reviewer records`
    : "No reviewer minimum";
  const scopeSummary = [
    props.scopeLabel,
    qaRejectionWindowShortLabel(props.qaWindow),
    reviewerVolumeLabel,
  ].join(" · ");
  const queryString = searchParams.toString();
  const exportHref = queryString
    ? `/api/metrics/feedback/export?${queryString}`
    : "/api/metrics/feedback/export";

  function pushParams(params: URLSearchParams) {
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function applyProjectFilter(next: ProjectFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("project");
    } else {
      params.set("project", serializeProjectQueryValue(next));
    }
    params.delete("env");
    pushParams(params);
  }

  function applyEnvFilter(next: EnvFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("env");
    } else {
      params.set("env", serializeEnvQueryValue(next));
    }
    pushParams(params);
  }

  function applyQaWindow(next: QaRejectionWindow) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("qaWindow");
    } else {
      params.set("qaWindow", next);
    }
    pushParams(params);
  }

  function applyMinQaRecords(nextEnabled: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextEnabled) {
      params.set("minQaRecords", String(QA_MIN_REVIEWER_RECORDS));
    } else {
      params.delete("minQaRecords");
    }
    pushParams(params);
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("project");
    params.delete("env");
    params.delete("qaWindow");
    params.delete("minQaRecords");
    pushParams(params);
  }

  return (
    <details className="group rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Filters
            </p>
            <p className="mt-1 truncate text-sm text-zinc-400">
              {scopeSummary}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs font-medium text-zinc-400">
            <span className="group-open:hidden">Open controls</span>
            <span className="hidden group-open:inline">Close controls</span>
          </span>
        </div>
      </summary>

      <div className="mt-4 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className={FILTER_CARD_CLASS}>
          <span className={FILTER_LABEL_CLASS}>Project</span>
          <select
            value={serializeProjectQueryValue(props.projectFilter)}
            onChange={(e) =>
              applyProjectFilter(parseProjectFilter({ project: e.target.value }))
            }
            className={FILTER_SELECT_CLASS}
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

        <label className={FILTER_CARD_CLASS}>
          <span className={FILTER_LABEL_CLASS}>Environment</span>
          <select
            value={serializeEnvQueryValue(props.envFilter)}
            onChange={(e) =>
              applyEnvFilter(parseEnvFilter({ env: e.target.value }))
            }
            className={FILTER_SELECT_CLASS}
          >
            {props.envFilterOptions.map((opt) => (
              <option key={serializeEnvQueryValue(opt)} value={serializeEnvQueryValue(opt)}>
                {getEnvFilterShortLabel(opt)}
              </option>
            ))}
          </select>
        </label>

        <label className={FILTER_CARD_CLASS}>
          <span className={FILTER_LABEL_CLASS}>QA window</span>
          <select
            value={props.qaWindow}
            onChange={(e) => applyQaWindow(e.target.value as QaRejectionWindow)}
            className={FILTER_SELECT_CLASS}
          >
            {QA_WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div
          className={`${FILTER_CARD_CLASS} flex min-h-full flex-col justify-between gap-3`}
        >
          <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={props.minQaRecordsEnabled}
              onChange={(e) => applyMinQaRecords(e.target.checked)}
              className="mt-1 h-3.5 w-3.5 accent-amber-500"
            />
            <span>
              <span className="block font-medium text-zinc-200">
                Require {QA_MIN_REVIEWER_RECORDS}+ reviewer records
              </span>
              <span className="mt-1 block text-xs text-zinc-500">
                Applied after project, environment, and QA window.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <a
              href={exportHref}
              className="rounded-full border border-emerald-800/70 bg-emerald-950/25 px-4 py-1.5 text-xs font-medium text-emerald-100 transition hover:border-emerald-600/80"
            >
              Export CSV
            </a>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-zinc-800 bg-zinc-950/50 px-4 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
