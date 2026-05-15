import type { ScoreBreakdown } from "@/lib/metrics-compute";

export function scoreLabel(tier: keyof ScoreBreakdown): string {
  switch (tier) {
    case "EXCELLENT":
      return "Excellent";
    case "AVERAGE":
      return "Average";
    case "POOR":
      return "Poor";
    case "PRUNED":
      return "Pruned";
    default:
      return tier;
  }
}

function scoreColor(tier: keyof ScoreBreakdown): string {
  switch (tier) {
    case "EXCELLENT":
      return "bg-emerald-500/80";
    case "AVERAGE":
      return "bg-amber-500/80";
    case "POOR":
      return "bg-rose-500/80";
    case "PRUNED":
      return "bg-zinc-500/80";
    default:
      return "bg-zinc-500/80";
  }
}

export function DistributionBar({
  total,
  breakdown,
}: {
  total: number;
  breakdown: ScoreBreakdown;
}) {
  if (total === 0) {
    return (
      <div className="h-2 w-full rounded-full bg-zinc-800" title="No scored rows" />
    );
  }
  const tiers: (keyof ScoreBreakdown)[] = [
    "EXCELLENT",
    "AVERAGE",
    "POOR",
    "PRUNED",
  ];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      {tiers.map((tier) => {
        const n = breakdown[tier];
        if (n === 0) return null;
        const pct = (n / total) * 100;
        return (
          <div
            key={tier}
            className={`${scoreColor(tier)} min-w-0 transition-[width]`}
            style={{ width: `${pct}%` }}
            title={`${scoreLabel(tier)}: ${n} (${Math.round(pct * 10) / 10}%)`}
          />
        );
      })}
    </div>
  );
}

export function Legend({
  breakdown,
  total,
}: {
  breakdown: ScoreBreakdown;
  total: number;
}) {
  const tiers: (keyof ScoreBreakdown)[] = [
    "EXCELLENT",
    "AVERAGE",
    "POOR",
    "PRUNED",
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      {tiers.map((tier) => {
        const n = breakdown[tier];
        if (n === 0) return null;
        const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
        return (
          <li key={tier} className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-sm ${scoreColor(tier)}`}
              aria-hidden
            />
            <span>
              {scoreLabel(tier)}: {n}
              {total > 0 ? ` (${pct}%)` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MetricCard(props: {
  label: string;
  value: number | string;
  hint?: string;
  /** Appended to numeric values only (e.g. "%") */
  valueSuffix?: string;
}) {
  const display =
    typeof props.value === "number"
      ? `${props.value.toLocaleString()}${props.valueSuffix ?? ""}`
      : props.value;
  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/80 to-zinc-950/90 p-5 shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums text-zinc-50">
        {display}
      </p>
      {props.hint ? (
        <p className="mt-2 text-xs leading-snug text-zinc-600">{props.hint}</p>
      ) : null}
    </div>
  );
}
