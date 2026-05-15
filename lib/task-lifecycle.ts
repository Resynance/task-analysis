/**
 * Task lifecycle from imported `extra.task_lifecycle_status` (JSON/CSV: `task_lifecycle_status` / `lifecycle_status`).
 * Rubric LLM analysis and related flows only run for **production** (or legacy rows with no status set).
 */

const PRODUCTION = "production";

export function getTaskLifecycleStatusFromExtra(
  extra: unknown,
): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    return null;
  }
  const raw = (extra as Record<string, unknown>).task_lifecycle_status;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/**
 * When `task_lifecycle_status` is **absent**, treat as legacy import and allow analysis.
 * When present, only **production** (case-insensitive) qualifies for rubric analysis.
 */
export function taskLifecycleEligibleForLlmAnalysis(extra: unknown): boolean {
  const s = getTaskLifecycleStatusFromExtra(extra);
  if (s == null) return true;
  return s.toLowerCase() === PRODUCTION;
}
