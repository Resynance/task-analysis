import { redirect } from "next/navigation";

/**
 * QA rejection metrics **time window** (`qaWindow` query param): resolve `all` | `7d` | `30d` or
 * redirect with invalid keys stripped so dashboard URLs stay canonical.
 */
const MS_PER_DAY = 86400000;

export type QaRejectionWindow = "all" | "7d" | "30d";

export function resolveQaRejectionWindow(
  sp: Record<string, string | string[] | undefined>,
  /** Used when stripping an invalid `qaWindow` value */
  metricsPath: string,
): QaRejectionWindow {
  const raw =
    typeof sp.qaWindow === "string" ? sp.qaWindow.trim().toLowerCase() : "";
  if (!raw) return "all";
  if (raw === "all" || raw === "7d" || raw === "30d") return raw;
  redirectPreservingSearchOmitKeys(metricsPath, sp, ["qaWindow"]);
}

function redirectPreservingSearchOmitKeys(
  basePath: string,
  sp: Record<string, string | string[] | undefined>,
  omitKeys: string[],
): never {
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (omitKeys.includes(key)) continue;
    if (typeof val === "string") p.set(key, val);
    else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") p.append(key, v);
      }
    }
  }
  const qs = p.toString();
  redirect(qs ? `${basePath}?${qs}` : basePath);
}

export function filterRowsForQaRejectionWindow<T extends { createdAt: Date }>(
  rows: T[],
  window: QaRejectionWindow,
  now: Date,
): T[] {
  if (window === "all") return rows;
  const days = window === "7d" ? 7 : 30;
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  return rows.filter((r) => r.createdAt >= cutoff);
}

export function qaRejectionWindowShortLabel(window: QaRejectionWindow): string {
  switch (window) {
    case "all":
      return "All time";
    case "7d":
      return "Past 7 days";
    case "30d":
      return "Past 30 days";
    default:
      return window;
  }
}
