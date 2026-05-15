import { getTaskLifecycleStatusFromExtra } from "@/lib/task-lifecycle";

/** Query param value when no lifecycle filter (shows every task status). */
export const TASK_LIFECYCLE_ALL = "all";

/** URL/query token for rows with no `task_lifecycle_status` in import metadata. */
export const TASK_LIFECYCLE_UNSET_QUERY = "_unset";

export type TaskLifecycleFilter =
  | typeof TASK_LIFECYCLE_ALL
  | typeof TASK_LIFECYCLE_UNSET_QUERY
  | string;

export type TaskLifecycleOption = {
  value: TaskLifecycleFilter;
  label: string;
};

export function parseTaskLifecycleFilter(
  raw: Record<string, string | string[] | undefined>,
): TaskLifecycleFilter {
  const v =
    typeof raw.taskStatus === "string" ? raw.taskStatus.trim().toLowerCase() : "";
  if (!v || v === TASK_LIFECYCLE_ALL) return TASK_LIFECYCLE_ALL;
  return v;
}

/** Lowercase lifecycle slug or `_unset` — omit param when `all`. */
export function serializeTaskLifecycleQueryValue(
  filter: TaskLifecycleFilter,
): string {
  return filter === TASK_LIFECYCLE_ALL ? TASK_LIFECYCLE_ALL : filter;
}

export function lifecycleMatchesFilter(
  extra: unknown,
  filter: TaskLifecycleFilter,
): boolean {
  if (filter === TASK_LIFECYCLE_ALL) return true;
  const status = getTaskLifecycleStatusFromExtra(extra);
  if (filter === TASK_LIFECYCLE_UNSET_QUERY) return status == null;
  return (
    status != null && status.toLowerCase() === filter.toLowerCase()
  );
}

/** Values that may appear in `?taskStatus=` for the current project/env/rubric scope. */
export function collectAllowedLifecycleValues(
  rows: { extra: unknown }[],
): Set<string> {
  const s = new Set<string>();
  s.add(TASK_LIFECYCLE_UNSET_QUERY);
  for (const r of rows) {
    const st = getTaskLifecycleStatusFromExtra(r.extra);
    if (st) s.add(st.toLowerCase());
  }
  return s;
}

export function lifecycleFilterIsValid(
  filter: TaskLifecycleFilter,
  allowed: Set<string>,
): boolean {
  if (filter === TASK_LIFECYCLE_ALL) return true;
  return allowed.has(filter);
}

export function buildTaskLifecycleFilterOptions(
  rows: { extra: unknown }[],
): TaskLifecycleOption[] {
  const slugs = new Set<string>();
  for (const r of rows) {
    const st = getTaskLifecycleStatusFromExtra(r.extra);
    if (st) slugs.add(st.toLowerCase());
  }
  const sorted = [...slugs].sort((a, b) => a.localeCompare(b));

  const out: TaskLifecycleOption[] = [
    { value: TASK_LIFECYCLE_ALL, label: "All statuses" },
    {
      value: TASK_LIFECYCLE_UNSET_QUERY,
      label: "No status (legacy)",
    },
  ];
  for (const slug of sorted) {
    out.push({
      value: slug,
      label: formatLifecycleOptionLabel(slug),
    });
  }
  return out;
}

function formatLifecycleOptionLabel(slug: string): string {
  if (!slug) return slug;
  return slug
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function taskLifecycleFilterShortLabel(
  filter: TaskLifecycleFilter,
): string {
  if (filter === TASK_LIFECYCLE_ALL) return "All statuses";
  if (filter === TASK_LIFECYCLE_UNSET_QUERY) return "No status (legacy)";
  return formatLifecycleOptionLabel(filter);
}
