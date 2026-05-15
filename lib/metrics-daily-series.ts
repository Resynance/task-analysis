const MS_PER_DAY = 86400000;

export type DailyCreationPoint = {
  /** ISO date key `YYYY-MM-DD` (UTC calendar day of `createdAt`) */
  dateKey: string;
  /** Short label for the chart axis */
  label: string;
  prompts: number;
  feedback: number;
};

function buildUtcDayKeys(windowDays: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  const baseUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const d = new Date(baseUtc - offset * MS_PER_DAY);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function shortUtcLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Counts prompts and feedback rows whose `createdAt` falls on each UTC calendar day
 * in the rolling window ending today (UTC). Rows should already be scoped (e.g. project/env).
 */
export function computeDailyCreationSeries(
  prompts: { createdAt: Date }[],
  feedback: { createdAt: Date }[],
  windowDays = 30,
): DailyCreationPoint[] {
  const dayKeys = buildUtcDayKeys(windowDays);
  const promptCounts = new Map<string, number>();
  const feedbackCounts = new Map<string, number>();
  for (const k of dayKeys) {
    promptCounts.set(k, 0);
    feedbackCounts.set(k, 0);
  }

  for (const p of prompts) {
    const k = p.createdAt.toISOString().slice(0, 10);
    if (promptCounts.has(k)) {
      promptCounts.set(k, (promptCounts.get(k) ?? 0) + 1);
    }
  }
  for (const p of feedback) {
    const k = p.createdAt.toISOString().slice(0, 10);
    if (feedbackCounts.has(k)) {
      feedbackCounts.set(k, (feedbackCounts.get(k) ?? 0) + 1);
    }
  }

  return dayKeys.map((dateKey) => ({
    dateKey,
    label: shortUtcLabel(dateKey),
    prompts: promptCounts.get(dateKey) ?? 0,
    feedback: feedbackCounts.get(dateKey) ?? 0,
  }));
}
