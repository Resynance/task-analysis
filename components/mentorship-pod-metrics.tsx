"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  MenteePodMetricRow,
  PodMenteeMetricsSnapshot,
} from "@/lib/mentorship-metrics";
import { encodeUserKeyForPath } from "@/lib/users-directory";

function TierBreakdown(props: {
  excellent: number;
  average: number;
  poor: number;
  pruned: number;
}) {
  const { excellent, average, poor, pruned } = props;
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-1 pt-2 text-[11px] leading-tight sm:text-xs">
      <div className="rounded-md bg-zinc-900/60 px-2 py-1.5 text-center">
        <div className="font-medium text-zinc-500">Ex</div>
        <div className="font-[family-name:var(--font-mono)] tabular-nums text-zinc-300">
          {excellent.toLocaleString()}
        </div>
      </div>
      <div className="rounded-md bg-zinc-900/60 px-2 py-1.5 text-center">
        <div className="font-medium text-zinc-500">Av</div>
        <div className="font-[family-name:var(--font-mono)] tabular-nums text-zinc-300">
          {average.toLocaleString()}
        </div>
      </div>
      <div className="rounded-md bg-zinc-900/60 px-2 py-1.5 text-center">
        <div className="font-medium text-zinc-500">Po</div>
        <div className="font-[family-name:var(--font-mono)] tabular-nums text-zinc-300">
          {poor.toLocaleString()}
        </div>
      </div>
      <div className="rounded-md bg-zinc-900/60 px-2 py-1.5 text-center">
        <div className="font-medium text-zinc-500">Pr</div>
        <div className="font-[family-name:var(--font-mono)] tabular-nums text-zinc-300">
          {pruned.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function FeedbackPanel(props: {
  row: Pick<
    MenteePodMetricRow,
    "feedbackCount" | "feedbackScored" | "feedbackByScore"
  >;
  emphasize?: boolean;
}) {
  const { row, emphasize } = props;
  const mono = emphasize
    ? "font-[family-name:var(--font-mono)] tabular-nums text-zinc-200"
    : "font-[family-name:var(--font-mono)] tabular-nums text-zinc-300";
  const scoredClass = emphasize
    ? "font-[family-name:var(--font-mono)] tabular-nums text-emerald-200/90"
    : "font-[family-name:var(--font-mono)] tabular-nums text-emerald-300/85";

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Feedback
      </h4>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] text-zinc-500">Total</dt>
          <dd className={mono}>{row.feedbackCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-zinc-500">Scored</dt>
          <dd className={scoredClass}>{row.feedbackScored.toLocaleString()}</dd>
        </div>
      </dl>
      <TierBreakdown
        excellent={row.feedbackByScore.EXCELLENT}
        average={row.feedbackByScore.AVERAGE}
        poor={row.feedbackByScore.POOR}
        pruned={row.feedbackByScore.PRUNED}
      />
    </div>
  );
}

function PromptPanel(props: {
  row: Pick<
    MenteePodMetricRow,
    "promptCount" | "scoredPrompts" | "pendingPrompts" | "byScore"
  >;
  emphasize?: boolean;
}) {
  const { row, emphasize } = props;
  const mono = emphasize
    ? "font-[family-name:var(--font-mono)] tabular-nums text-zinc-200"
    : "font-[family-name:var(--font-mono)] tabular-nums text-zinc-300";
  const scoredClass = emphasize
    ? "font-[family-name:var(--font-mono)] tabular-nums text-emerald-200/90"
    : "font-[family-name:var(--font-mono)] tabular-nums text-emerald-300/85";
  const pendingClass = emphasize
    ? "font-[family-name:var(--font-mono)] tabular-nums text-zinc-400"
    : "font-[family-name:var(--font-mono)] tabular-nums text-zinc-500";

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Prompts (rubric)
      </h4>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] text-zinc-500">Total</dt>
          <dd className={mono}>{row.promptCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-zinc-500">Scored</dt>
          <dd className={scoredClass}>{row.scoredPrompts.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-zinc-500">Pending</dt>
          <dd className={pendingClass}>{row.pendingPrompts.toLocaleString()}</dd>
        </div>
      </dl>
      <TierBreakdown
        excellent={row.byScore.EXCELLENT}
        average={row.byScore.AVERAGE}
        poor={row.byScore.POOR}
        pruned={row.byScore.PRUNED}
      />
    </div>
  );
}

function stopSummaryToggle(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function MenteeMetricsCollapsible(props: {
  m: MenteePodMetricRow;
  defaultOpen: boolean;
}) {
  const { m, defaultOpen } = props;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="group border-b border-zinc-800/80 last:border-b-0 open:bg-zinc-950/25"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 sm:py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className="inline-block shrink-0 text-zinc-500 transition-transform duration-200 select-none group-open:rotate-90"
            aria-hidden
          >
            ▸
          </span>
          <Link
            href={`/users/${encodeUserKeyForPath(m.userKey)}`}
            className="min-w-0 text-base font-medium text-amber-200/90 underline-offset-2 hover:text-amber-100 hover:underline sm:text-lg"
            onClick={stopSummaryToggle}
            onPointerDown={stopSummaryToggle}
          >
            {m.label}
          </Link>
          <span className="min-w-0 truncate font-[family-name:var(--font-mono)] text-[11px] text-zinc-600">
            {m.userKey}
          </span>
          <span className="ml-auto shrink-0 rounded-md border border-zinc-800/80 bg-zinc-900/50 px-2 py-0.5 text-[11px] text-zinc-500 tabular-nums">
            Fb {m.feedbackCount.toLocaleString()} · Pr {m.promptCount.toLocaleString()}
          </span>
        </div>
      </summary>

      <div className="border-t border-zinc-800/40 px-4 pb-4 sm:px-5">
        <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-2">
          <FeedbackPanel row={m} />
          <PromptPanel row={m} />
        </div>
      </div>
    </details>
  );
}

export function MentorshipPodMetrics(props: { snapshot: PodMenteeMetricsSnapshot }) {
  const { mentees, totals } = props.snapshot;

  if (mentees.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-500">
        Add mentees to this pod to see aggregated activity from prompts and feedback that match
        each person&apos;s user key.
      </p>
    );
  }

  const defaultOpenIndexCutoff = mentees.length > 6 ? 4 : mentees.length;

  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/50">
      <div className="flex flex-col">
        {mentees.map((m, index) => (
          <MenteeMetricsCollapsible
            key={m.userKey}
            m={m}
            defaultOpen={index < defaultOpenIndexCutoff}
          />
        ))}

        <article className="border-t border-zinc-800/80 bg-zinc-900/35 p-4 sm:p-5">
          <h3 className="text-sm font-medium text-zinc-300">Pod total</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FeedbackPanel
              emphasize
              row={{
                feedbackCount: totals.feedbackCount,
                feedbackScored: totals.feedbackScored,
                feedbackByScore: totals.feedbackByScore,
              }}
            />
            <PromptPanel
              emphasize
              row={{
                promptCount: totals.promptCount,
                scoredPrompts: totals.scoredPrompts,
                pendingPrompts: totals.pendingPrompts,
                byScore: totals.byScore,
              }}
            />
          </div>
        </article>
      </div>

      <p className="border-t border-zinc-800/80 px-4 py-3 text-xs leading-relaxed text-zinc-600 sm:px-5">
        Feedback uses reviewer identity on each feedback row. Prompts match creator{" "}
        <span className="font-[family-name:var(--font-mono)] text-zinc-500">created_by</span> in
        import metadata. Rubric tiers only include analyzed rows (non-null score); tiers use the same{" "}
        <span className="font-[family-name:var(--font-mono)] text-zinc-500">EXCELLENT</span> /{" "}
        <span className="font-[family-name:var(--font-mono)] text-zinc-500">AVERAGE</span> /{" "}
        <span className="font-[family-name:var(--font-mono)] text-zinc-500">POOR</span> /{" "}
        <span className="font-[family-name:var(--font-mono)] text-zinc-500">PRUNED</span> enums as
        elsewhere.
      </p>
    </div>
  );
}
