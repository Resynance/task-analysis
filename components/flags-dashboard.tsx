import Link from "next/link";
import {
  DEFAULT_MIN_SCORED_SAMPLE,
  DEFAULT_POOR_PERCENT_THRESHOLD,
  type FlaggedUserRow,
  type FlagsSnapshot,
  type UserScoreBreakdown,
} from "@/lib/user-flags";

function formatPercent(p: number | null): string {
  if (p == null) return "—";
  if (Number.isInteger(p)) return `${p.toFixed(0)}%`;
  return `${p.toFixed(1)}%`;
}

function FlagCategorySummary(props: {
  label: string;
  breakdown: UserScoreBreakdown;
  flagged: boolean;
  threshold: number;
  minScoredSample: number;
}) {
  const { breakdown, flagged } = props;
  const reason: string | null = (() => {
    if (breakdown.classified === 0) return "No classified samples";
    if (breakdown.classified < props.minScoredSample) {
      return `Below sample minimum (${breakdown.classified} of ${props.minScoredSample})`;
    }
    if (!flagged) return "Within threshold";
    return null;
  })();
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        flagged
          ? "border-rose-800/70 bg-rose-950/30"
          : "border-zinc-800/80 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          {props.label}
        </p>
        <p
          className={`font-[family-name:var(--font-mono)] text-xl font-semibold tabular-nums ${
            flagged ? "text-rose-200" : "text-zinc-300"
          }`}
        >
          {formatPercent(breakdown.poorPercent)}
        </p>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {breakdown.poor.toLocaleString()} POOR of{" "}
        {breakdown.classified.toLocaleString()} classified
        {breakdown.scored !== breakdown.classified ? (
          <>
            {" "}
            <span className="text-zinc-600">
              ({(breakdown.scored - breakdown.classified).toLocaleString()} pruned
              excluded)
            </span>
          </>
        ) : null}
      </p>
      {reason ? (
        <p className="mt-1 text-[11px] text-zinc-600">{reason}</p>
      ) : null}
    </div>
  );
}

function FlaggedRow(props: {
  row: FlaggedUserRow;
  threshold: number;
  minScoredSample: number;
}) {
  const { row } = props;
  const reasons: string[] = [];
  if (row.promptsFlagged) reasons.push("Prompts");
  if (row.feedbackFlagged) reasons.push("Feedback");
  return (
    <li className="rounded-2xl border border-zinc-800/90 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/users/${row.encodedUserKey}`}
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-zinc-50 hover:text-amber-200/90 hover:underline"
            >
              {row.displayName}
            </Link>
            {reasons.map((r) => (
              <span
                key={r}
                className="rounded-full border border-rose-800/70 bg-rose-950/40 px-2 py-0.5 text-[11px] uppercase tracking-wide text-rose-200"
              >
                {r}
              </span>
            ))}
          </div>
          {row.secondaryEmail ? (
            <p className="mt-0.5 truncate text-sm text-zinc-500">
              {row.secondaryEmail}
            </p>
          ) : null}
        </div>
        <Link
          href={`/users/${row.encodedUserKey}`}
          className="text-xs text-amber-200/90 underline-offset-2 hover:underline"
        >
          Open profile →
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FlagCategorySummary
          label="Prompts · POOR rate"
          breakdown={row.prompts}
          flagged={row.promptsFlagged}
          threshold={props.threshold}
          minScoredSample={props.minScoredSample}
        />
        <FlagCategorySummary
          label="Feedback · POOR rate"
          breakdown={row.feedback}
          flagged={row.feedbackFlagged}
          threshold={props.threshold}
          minScoredSample={props.minScoredSample}
        />
      </div>
    </li>
  );
}

export function FlagsDashboard(props: { snapshot: FlagsSnapshot }) {
  const { snapshot } = props;
  const filtersActive =
    snapshot.threshold !== DEFAULT_POOR_PERCENT_THRESHOLD ||
    snapshot.minScoredSample !== DEFAULT_MIN_SCORED_SAMPLE;
  const thresholdLabel = formatPercent(snapshot.threshold);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.25em] text-zinc-500">
          Quality
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-zinc-50">
          Flags
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          Users with a high share of <span className="text-rose-200">POOR</span>{" "}
          rubric scores on their prompts or feedback. Pruned items are excluded
          from the denominator. Tryouts-import prompts are excluded from the
          prompt rate.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5">
        <p className="mb-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          Threshold
        </p>
        <form method="get" action="/flags" className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>Flag if POOR % is greater than</span>
            <input
              type="number"
              name="threshold"
              min={0}
              max={100}
              step="0.1"
              defaultValue={snapshot.threshold}
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            <span>Minimum classified samples</span>
            <input
              type="number"
              name="min"
              min={0}
              step="1"
              defaultValue={snapshot.minScoredSample}
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            Apply
          </button>
          {filtersActive ? (
            <Link
              href="/flags"
              className="text-sm text-zinc-500 underline-offset-2 hover:text-amber-200/90 hover:underline"
            >
              Reset
            </Link>
          ) : null}
        </form>
        <p className="mt-3 text-xs text-zinc-600">
          Default: greater than {DEFAULT_POOR_PERCENT_THRESHOLD}% POOR with at
          least {DEFAULT_MIN_SCORED_SAMPLE} classified samples (EXCELLENT +
          AVERAGE + POOR).
        </p>
      </section>

      <section className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-zinc-400">
          <span className="font-[family-name:var(--font-mono)] text-zinc-200">
            {snapshot.flagged.length}
          </span>{" "}
          of{" "}
          <span className="font-[family-name:var(--font-mono)] text-zinc-300">
            {snapshot.totalUsersWithRecords.toLocaleString()}
          </span>{" "}
          users flagged at &gt;{thresholdLabel}
        </p>
        <p className="text-xs text-zinc-600">
          Sample minimum: {snapshot.minScoredSample}
        </p>
      </section>

      {snapshot.flagged.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 py-16 text-center text-zinc-500">
          No users meet the current flag conditions.{" "}
          {filtersActive ? (
            <>
              Try lowering the threshold or sample minimum, or{" "}
              <Link href="/flags" className="text-amber-200/90 hover:underline">
                reset to defaults
              </Link>
              .
            </>
          ) : (
            <>Adjust the threshold to see softer matches.</>
          )}
        </section>
      ) : (
        <ul className="flex flex-col gap-4">
          {snapshot.flagged.map((row) => (
            <FlaggedRow
              key={row.userKey}
              row={row}
              threshold={snapshot.threshold}
              minScoredSample={snapshot.minScoredSample}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
