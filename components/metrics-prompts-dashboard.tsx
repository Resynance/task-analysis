import {
  PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD,
  type MetricsSnapshot,
} from "@/lib/metrics-compute";
import {
  DistributionBar,
  Legend,
  MetricCard,
} from "@/components/metrics-shared";

export function MetricsPromptsDashboard(props: {
  prompts: MetricsSnapshot["prompts"];
}) {
  const p = props.prompts;
  const scoredPromptTotal =
    p.byScore.EXCELLENT +
    p.byScore.AVERAGE +
    p.byScore.POOR +
    p.byScore.PRUNED;

  return (
    <section className="flex flex-col gap-10">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-zinc-100">
          Prompt metrics
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Training prompts after ingest filters: rubric scoring progress, tier mix for
          scored rows, and lifecycle metadata from task exports.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          label="Total prompts"
          value={p.total}
          hint="Rows in scope after ingest"
        />
        <MetricCard
          label="Scored"
          value={p.scored}
          hint={
            p.scoredPercent != null ? `${p.scoredPercent}% of total` : undefined
          }
        />
        <MetricCard
          label="Pending rubric score"
          value={p.pending}
          hint={
            p.pending > 0 && p.pendingEligibleForRubricAnalysis < p.pending
              ? `${p.pendingEligibleForRubricAnalysis} eligible for LLM analysis (lifecycle)`
              : p.pending > 0
                ? "All pending rows may be analyzed"
                : undefined
          }
        />
        <MetricCard
          label="Created (7d)"
          value={p.createdLast7Days}
          hint="Production-eligible lifecycle only · createdAt in the last 7 days (legacy unset counts)"
        />
        <MetricCard
          label="Analyzed (7d)"
          value={p.analyzedLast7Days}
          hint="Scored rows with analyzedAt in the last week"
        />
        <MetricCard
          label="Writers active (7d)"
          value={p.authorsLast7Days}
          hint="Distinct authors (`created_by`) · excludes tryouts import · by created date"
        />
        <MetricCard
          label={`Writers with >${PROMPT_WRITER_HIGH_VOLUME_TASK_THRESHOLD} tasks (7d)`}
          value={p.authorsOverTaskThresholdLast7Days}
          hint="Distinct authors · non-tryouts prompts · created date"
        />
      </div>

      {p.pending > 0 && p.oldestPendingDays != null ? (
        <p className="text-xs text-zinc-500">
          Oldest pending prompt in this scope:{" "}
          <strong className="font-medium text-zinc-400">
            {p.oldestPendingDays} day{p.oldestPendingDays === 1 ? "" : "s"} ago
          </strong>{" "}
          (by created date).
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/50 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Score mix (prompts)
          </h3>
          <p className="mt-1 text-xs text-zinc-600">
            Among scored prompts only ({scoredPromptTotal} rows).
          </p>
          <div className="mt-4">
            <DistributionBar total={scoredPromptTotal} breakdown={p.byScore} />
            <Legend breakdown={p.byScore} total={scoredPromptTotal} />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/50 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Import lifecycle
          </h3>
          <p className="mt-1 text-xs text-zinc-600">
            From <code className="text-zinc-500">task_lifecycle_status</code> metadata
            on ingest.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-zinc-300">
            <li className="flex justify-between gap-4 border-b border-zinc-800/80 pb-2">
              <span className="text-zinc-500">No status (legacy)</span>
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {p.lifecycle.unset}
              </span>
            </li>
            <li className="flex justify-between gap-4 border-b border-zinc-800/80 pb-2">
              <span className="text-zinc-500">Production</span>
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {p.lifecycle.production}
              </span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-zinc-500">Other lifecycle</span>
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {p.lifecycle.nonProduction}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
