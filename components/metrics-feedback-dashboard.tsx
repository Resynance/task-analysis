import {
  DistributionBar,
  Legend,
  MetricCard,
} from "@/components/metrics-shared";
import { QaRejectionByUserTable } from "@/components/qa-rejection-by-user-table";
import { QaFlagsByUserTable } from "@/components/qa-flags-by-user-table";
import type { MetricsSnapshot } from "@/lib/metrics-compute";
import type { QaFlagSnapshot } from "@/lib/feedback-qa-flags";
import type { QaRejectionSnapshot } from "@/lib/qa-rejection-metrics";
import type { QaRejectionWindow } from "@/lib/qa-rejection-window";
import { qaRejectionWindowShortLabel } from "@/lib/qa-rejection-window";
import { QA_MIN_REVIEWER_RECORDS } from "@/lib/qa-reviewer-record-filter";

export function MetricsFeedbackDashboard(props: {
  feedback: MetricsSnapshot["feedback"];
  qaRejection: QaRejectionSnapshot;
  qaFlags: QaFlagSnapshot;
  qaWindow: QaRejectionWindow;
  minQaRecordsEnabled: boolean;
}) {
  const f = props.feedback;
  const qaRejection = props.qaRejection;
  const qaFlags = props.qaFlags;
  const qa = qaRejection.scope;
  const flags = qaFlags.scope;
  const wLabel = qaRejectionWindowShortLabel(props.qaWindow);
  const minRecordsLabel = props.minQaRecordsEnabled
    ? ` Reviewers with fewer than ${QA_MIN_REVIEWER_RECORDS} records in that window are excluded.`
    : "";
  const reviewerFilterEmptySuffix = props.minQaRecordsEnabled
    ? ", and reviewer-volume filter"
    : "";

  const analyzedFeedbackTotal =
    f.byScore.EXCELLENT + f.byScore.AVERAGE + f.byScore.POOR + f.byScore.PRUNED;

  return (
    <section className="flex flex-col gap-12">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-zinc-100">
          Feedback metrics
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          QA submissions: LLM analysis coverage, rubric tier distribution, and reviewer
          approve/reject signals from imported CSV metadata.
        </p>
      </div>

      <div>
        <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-zinc-100">
          QA bugged / escalated usage
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Counts feedback rows whose linked task is currently in lifecycle state{" "}
          <code className="text-zinc-400">bugged</code> or{" "}
          <code className="text-zinc-400">escalated-fleet-review</code>. Use this to spot
          task-quality issues and reviewers who interact with these states unusually often.
          Only feedback in{" "}
          <strong className="font-medium text-zinc-400">{wLabel.toLowerCase()}</strong>{" "}
          is included (after project/env scope).{minRecordsLabel}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Flagged feedback"
            value={flags.flagged}
            hint={
              flags.flaggedPercent != null
                ? `${flags.flaggedPercent}% of ${flags.total.toLocaleString()} rows · ${wLabel}`
                : `No feedback rows (${wLabel})`
            }
          />
          <MetricCard
            label="Escalated rows"
            value={flags.escalated}
            hint={`${flags.escalatedTaskCount.toLocaleString()} distinct tasks · ${wLabel}`}
          />
          <MetricCard
            label="Bugged rows"
            value={flags.bugged}
            hint={`${flags.buggedTaskCount.toLocaleString()} distinct tasks · ${wLabel}`}
          />
          <MetricCard
            label="Distinct flagged tasks"
            value={flags.flaggedTaskCount}
            hint="Deduped by task key/id where available"
          />
        </div>

        <div className="mt-8">
          <QaFlagsByUserTable
            rows={qaFlags.byUser}
            emptyMessage={`No bugged/escalated feedback rows match this scope, period (${wLabel.toLowerCase()})${reviewerFilterEmptySuffix}.`}
          />
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Flag rate = feedback rows linked to bugged or escalated-fleet-review tasks ÷ all
          feedback rows for that reviewer ({wLabel}). Counts depend on task lifecycle state
          and should be spot-checked against task context before treating them as QA
          accuracy findings.
        </p>

        {qaFlags.recentFlaggedTasks.length > 0 ? (
          <details className="mt-6 rounded-2xl border border-zinc-800/90 bg-zinc-950/45 p-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-200">
              Recent flagged tasks ({qaFlags.recentFlaggedTasks.length})
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-zinc-500">
                  <tr className="border-b border-zinc-800/80">
                    <th className="py-2 pr-3 font-medium">Task</th>
                    <th className="py-2 pr-3 font-medium">Reviewer</th>
                    <th className="py-2 pr-3 font-medium">Flags</th>
                    <th className="py-2 pr-3 font-medium">Lifecycle</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {qaFlags.recentFlaggedTasks.map((row) => (
                    <tr
                      key={`${row.taskKey}-${row.reviewerGroupKey}-${row.createdAtIso}`}
                      className="border-b border-zinc-800/50 last:border-0"
                    >
                      <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-zinc-400">
                        {row.taskKey}
                      </td>
                      <td className="py-2 pr-3">{row.reviewerLabel}</td>
                      <td className="py-2 pr-3">
                        {[
                          row.escalated ? "escalated" : null,
                          row.bugged ? "bugged" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td className="max-w-[22rem] py-2 pr-3 text-zinc-400">
                        {row.lifecycleStatus ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-zinc-500">
                        {new Date(row.createdAtIso).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Analysis & tiers
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            label="Total feedback rows"
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
            label="Pending analysis"
            value={f.pending}
            hint={f.pending === 0 ? "None waiting" : undefined}
          />
          <MetricCard
            label="Analyzed (7d)"
            value={f.analyzedLast7Days}
            hint="Runs in the last week"
          />
          <MetricCard
            label="Reviewers active (7d)"
            value={f.authorsLast7Days}
            hint="Distinct users with ≥1 submission by created date"
          />
        </div>

        <div className="mt-8 rounded-2xl border border-zinc-800/90 bg-zinc-950/50 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Score mix (feedback)
          </h3>
          <p className="mt-1 text-xs text-zinc-600">
            Among analyzed rows only ({analyzedFeedbackTotal} rows).
          </p>
          <div className="mt-4">
            <DistributionBar total={analyzedFeedbackTotal} breakdown={f.byScore} />
            <Legend breakdown={f.byScore} total={analyzedFeedbackTotal} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-zinc-100">
          QA rejection rate
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Uses ingest metadata on each feedback row:{" "}
          <code className="text-zinc-400">is_positive</code> when present, otherwise
          non-empty <code className="text-zinc-400">rejection_reason</code> /{" "}
          <code className="text-zinc-400">rejection_reason_label</code> counts as
          rejected. Rows with none of these signals are{" "}
          <span className="text-zinc-400">unclassified</span>. Only feedback with{" "}
          <code className="text-zinc-400">created_at</code> in{" "}
          <strong className="font-medium text-zinc-400">{wLabel.toLowerCase()}</strong>{" "}
          is included (after project/env scope).{minRecordsLabel}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Scope rejection rate"
            value={
              qa.classifiedRejectionPercent != null
                ? qa.classifiedRejectionPercent
                : "—"
            }
            hint={
              qa.classifiedRejectionPercent != null
                ? `Rejected ÷ (approved + rejected) · ${qa.approved + qa.rejected} classified · ${wLabel}`
                : `No classified QA outcomes (${wLabel})`
            }
            valueSuffix={qa.classifiedRejectionPercent != null ? "%" : undefined}
          />
          <MetricCard
            label="QA approved (scope)"
            value={qa.approved}
            hint={`is_positive = true · ${wLabel}`}
          />
          <MetricCard
            label="QA rejected (scope)"
            value={qa.rejected}
            hint={`Negative signal · ${wLabel}`}
          />
          <MetricCard
            label="Unclassified"
            value={qa.unknown}
            hint={`No approve/reject metadata · ${wLabel}`}
          />
        </div>

        <div className="mt-8">
          <QaRejectionByUserTable
            rows={qaRejection.byUser}
            emptyMessage={`No feedback rows match this scope, period (${wLabel.toLowerCase()})${reviewerFilterEmptySuffix}.`}
          />
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Rejection rate = rejected ÷ (approved + rejected) for that reviewer when at
          least one row is classified ({wLabel}). Reviewers are grouped by{" "}
          <code className="text-zinc-500">created_by_id</code>, then email, then name —
          matching the feedback library.
        </p>
      </div>
    </section>
  );
}
