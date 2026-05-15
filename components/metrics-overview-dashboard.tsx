import Link from "next/link";
import { MetricsCreationChart } from "@/components/metrics-creation-chart";
import { MetricCard } from "@/components/metrics-shared";
import { QaRejectionWindowToolbar } from "@/components/qa-rejection-window-toolbar";
import {
  PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD,
  type MetricsSnapshot,
} from "@/lib/metrics-compute";
import type { DailyCreationPoint } from "@/lib/metrics-daily-series";
import type { QaRejectionSnapshot } from "@/lib/qa-rejection-metrics";
import type { QaRejectionWindow } from "@/lib/qa-rejection-window";
import { qaRejectionWindowShortLabel } from "@/lib/qa-rejection-window";

export function MetricsOverviewDashboard(props: {
  snapshot: MetricsSnapshot;
  qaRejection: QaRejectionSnapshot;
  linkQuery: string;
  dailyCreationSeries: DailyCreationPoint[];
  creationChartScopeLabel: string;
  qaWindow: QaRejectionWindow;
}) {
  const p = props.snapshot.prompts;
  const f = props.snapshot.feedback;
  const qa = props.qaRejection.scope;
  const q = props.linkQuery;

  const scoredPromptTotal =
    p.byScore.EXCELLENT +
    p.byScore.AVERAGE +
    p.byScore.POOR +
    p.byScore.PRUNED;
  const analyzedFeedbackTotal =
    f.byScore.EXCELLENT + f.byScore.AVERAGE + f.byScore.POOR + f.byScore.PRUNED;

  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-zinc-500">
        Choose a section for full charts and tables. Filters above apply to every
        subpage.
      </p>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950/50 p-5 sm:p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Created volume (30 days)
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600">
          New prompts and feedback rows per day. Series uses the same project and
          environment scope as the rest of this page (UTC calendar days).
        </p>
        <div className="mt-6 min-w-0">
          <MetricsCreationChart
            series={props.dailyCreationSeries}
            scopeNote={`Scoped to ${props.creationChartScopeLabel}`}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/30 px-4 py-4 sm:px-5">
        <QaRejectionWindowToolbar window={props.qaWindow} />
        <p className="mt-2 text-xs leading-relaxed text-zinc-600">
          QA rejection figures below use feedback rows whose{" "}
          <code className="text-zinc-500">created_at</code> falls in{" "}
          <span className="text-zinc-400">
            {qaRejectionWindowShortLabel(props.qaWindow).toLowerCase()}
          </span>
          , after project and environment scope.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Link
          href={`/metrics/prompts${q}`}
          className="group flex flex-col rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-6 transition hover:border-amber-800/50 hover:bg-zinc-900/30"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-zinc-100">
                Prompts
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                Rubric coverage, score mix, import lifecycle, and recency of LLM
                analysis.
              </p>
            </div>
            <span
              className="shrink-0 text-sm font-medium text-amber-200/80 transition group-hover:text-amber-100"
              aria-hidden
            >
              →
            </span>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Total prompts"
              value={p.total}
              hint="In current scope"
            />
            <MetricCard
              label="Scored"
              value={p.scored}
              hint={
                p.scoredPercent != null ? `${p.scoredPercent}% of total` : undefined
              }
            />
            <MetricCard
              label="Pending score"
              value={p.pending}
              hint="Awaiting rubric"
            />
            <MetricCard
              label="Scored rows"
              value={scoredPromptTotal}
              hint="Denominator for score mix"
            />
            <MetricCard
              label="Writers active (7d)"
              value={p.authorsLast7Days}
              hint="Distinct created_by · excludes tryouts import"
            />
            <MetricCard
              label={`Writers >${PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD} tasks (7d)`}
              value={p.authorsOverTaskThresholdLast7Days}
              hint="Non-tryouts · created date"
            />
          </div>
        </Link>

        <Link
          href={`/metrics/feedback${q}`}
          className="group flex flex-col rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-6 transition hover:border-amber-800/50 hover:bg-zinc-900/30"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-zinc-100">
                Feedback
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                QA feedback analysis status, rubric tier mix, and per-reviewer QA
                rejection rates from ingest metadata.
              </p>
            </div>
            <span
              className="shrink-0 text-sm font-medium text-amber-200/80 transition group-hover:text-amber-100"
              aria-hidden
            >
              →
            </span>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="Feedback rows"
              value={f.total}
              hint="QA submissions in scope"
            />
            <MetricCard
              label="Analyzed"
              value={f.analyzed}
              hint={
                f.analyzedPercent != null
                  ? `${f.analyzedPercent}% of total`
                  : undefined
              }
            />
            <MetricCard
              label="Score mix rows"
              value={analyzedFeedbackTotal}
              hint="Rows with a tier"
            />
            <MetricCard
              label="QA rejection (scope)"
              value={
                qa.classifiedRejectionPercent != null
                  ? qa.classifiedRejectionPercent
                  : "—"
              }
              hint={
                qa.classifiedRejectionPercent != null
                  ? `Rejected ÷ (approved + rejected) · ${qaRejectionWindowShortLabel(props.qaWindow)}`
                  : `No classified QA rows (${qaRejectionWindowShortLabel(props.qaWindow)})`
              }
              valueSuffix={
                qa.classifiedRejectionPercent != null ? "%" : undefined
              }
            />
          </div>
        </Link>
      </div>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/30 p-6">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Last 24 hours
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-600">
          Rolling window ending when this page was generated. Same project and
          environment filters as above. Prompt writer counts exclude the tryouts
          import; analyzed counts use rubric{" "}
          <code className="text-zinc-500">analyzed_at</code>.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Prompts analyzed (24h)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.analyzedLast24Hours.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Prompt writers active (24h)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.authorsLast24Hours.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">
              Prompt writers with &gt;{PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD}{" "}
              tasks (24h)
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.authorsOverTaskThresholdLast24Hours.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Feedback analyzed (24h)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {f.analyzedLast24Hours.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3 sm:border-b-0">
            <dt className="text-zinc-500">Feedback reviewers active (24h)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {f.authorsLast24Hours.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/30 p-6">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          At a glance
        </h3>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Oldest pending prompt</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.pending > 0 && p.oldestPendingDays != null
                ? `${p.oldestPendingDays}d`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Prompts analyzed (7d)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.analyzedLast7Days.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Prompt writers active (7d)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.authorsLast7Days.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">
              Prompt writers with &gt;{PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD}{" "}
              tasks (7d)
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {p.authorsOverTaskThresholdLast7Days.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3 sm:border-b-0">
            <dt className="text-zinc-500">Feedback analyzed (7d)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {f.analyzedLast7Days.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/60 pb-3">
            <dt className="text-zinc-500">Feedback reviewers active (7d)</dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {f.authorsLast7Days.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 pb-1">
            <dt className="text-zinc-500">
              QA outcomes unclassified
              <span className="ml-1 text-zinc-600">
                ({qaRejectionWindowShortLabel(props.qaWindow).toLowerCase()})
              </span>
            </dt>
            <dd className="font-[family-name:var(--font-mono)] text-zinc-300">
              {qa.unknown.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
