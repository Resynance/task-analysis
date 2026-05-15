import type { DailyCreationPoint } from "@/lib/metrics-daily-series";

const W = 720;
const H = 220;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 36;

export function MetricsCreationChart(props: {
  series: DailyCreationPoint[];
  scopeNote?: string;
}) {
  const { series } = props;
  if (series.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/40 text-sm text-zinc-500">
        No data in range.
      </div>
    );
  }

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  let maxY = 1;
  for (const d of series) {
    maxY = Math.max(maxY, d.prompts, d.feedback);
  }
  const maxTick = niceCeil(maxY);

  const n = series.length;
  const xAt = (i: number) =>
    PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) =>
    PAD_T + innerH - (v / maxTick) * innerH;

  const promptPts = series.map((d, i) => `${xAt(i)},${yAt(d.prompts)}`).join(" ");
  const feedbackPts = series
    .map((d, i) => `${xAt(i)},${yAt(d.feedback)}`)
    .join(" ");

  const promptArea = areaUnderPolyline(series.map((d, i) => ({ x: xAt(i), y: yAt(d.prompts) })), PAD_T + innerH);
  const feedbackArea = areaUnderPolyline(
    series.map((d, i) => ({ x: xAt(i), y: yAt(d.feedback) })),
    PAD_T + innerH,
  );

  const yTicks = pickYTicks(maxTick);
  const xLabelIndices = pickXLabelIndices(n);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-h-[280px] text-zinc-400"
        role="img"
        aria-label="Line chart of prompts and feedback created per day over the last 30 days"
      >
        <title>Prompts and feedback created per day (last 30 days, UTC)</title>

        {/* Horizontal grid */}
        {yTicks.map((t) => {
          const y = yAt(t);
          return (
            <line
              key={t}
              x1={PAD_L}
              y1={y}
              x2={PAD_L + innerW}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
          );
        })}

        {/* Y axis labels */}
        {yTicks.map((t) => {
          const y = yAt(t);
          return (
            <text
              key={`yl-${t}`}
              x={PAD_L - 6}
              y={y + 4}
              textAnchor="end"
              className="fill-zinc-500 text-[10px]"
            >
              {t}
            </text>
          );
        })}

        {/* Areas */}
        <path
          d={promptArea}
          fill="rgba(251, 191, 36, 0.12)"
          stroke="none"
        />
        <path
          d={feedbackArea}
          fill="rgba(56, 189, 248, 0.1)"
          stroke="none"
        />

        {/* Lines */}
        <polyline
          fill="none"
          stroke="rgb(251, 191, 36)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={promptPts}
        />
        <polyline
          fill="none"
          stroke="rgb(56, 189, 248)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={feedbackPts}
        />

        {/* Points */}
        {series.map((d, i) => (
          <g key={d.dateKey}>
            <circle
              cx={xAt(i)}
              cy={yAt(d.prompts)}
              r={3}
              fill="rgb(250, 250, 250)"
              stroke="rgb(251, 191, 36)"
              strokeWidth={1.5}
            >
              <title>{`${d.label}: ${d.prompts} prompt(s)`}</title>
            </circle>
            <circle
              cx={xAt(i)}
              cy={yAt(d.feedback)}
              r={3}
              fill="rgb(250, 250, 250)"
              stroke="rgb(56, 189, 248)"
              strokeWidth={1.5}
            >
              <title>{`${d.label}: ${d.feedback} feedback row(s)`}</title>
            </circle>
          </g>
        ))}

        {/* X labels */}
        {xLabelIndices.map((i) => (
          <text
            key={series[i].dateKey}
            x={xAt(i)}
            y={H - 10}
            textAnchor="middle"
            className="fill-zinc-500 text-[10px]"
          >
            {series[i].label}
          </text>
        ))}

        {/* Baseline */}
        <line
          x1={PAD_L}
          y1={PAD_T + innerH}
          x2={PAD_L + innerW}
          y2={PAD_T + innerH}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      </svg>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-500">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-6 rounded-sm bg-amber-400/90"
            aria-hidden
          />
          Prompts created
        </span>
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-6 rounded-sm bg-sky-400/90"
            aria-hidden
          />
          Feedback created
        </span>
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-600">
        Daily counts by UTC date · {props.scopeNote ?? "Respects project and environment filters above"}
      </p>
    </div>
  );
}

function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const exp = Math.floor(Math.log10(n));
  const f = n / 10 ** exp;
  let nf = 10;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * 10 ** exp;
}

function pickYTicks(max: number): number[] {
  const step =
    max <= 5 ? 1 : Math.max(1, Math.round(max / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks.length === 0 || ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function pickXLabelIndices(n: number): number[] {
  if (n <= 8) return [...Array(n).keys()];
  const out = new Set<number>();
  out.add(0);
  out.add(n - 1);
  const step = Math.ceil(n / 6);
  for (let i = 0; i < n; i += step) out.add(i);
  out.add(n - 1);
  return [...out].sort((a, b) => a - b);
}

function areaUnderPolyline(
  pts: { x: number; y: number }[],
  floorY: number,
): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const line = pts.map((p) => `${p.x},${p.y}`).join(" L ");
  return `M ${first.x},${floorY} L ${line} L ${last.x},${floorY} Z`;
}
