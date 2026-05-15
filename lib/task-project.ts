/**
 * A **project** is the JSON import source (basename of the file under Prompts/ or prompts/), e.g. tryouts.json → `tryouts`.
 * Tasks still carry an **environment** via `env_key` (e.g. quickbooks, fos-hr).
 */

/** URL/query value for prompts with no `projectKey` (legacy imports, manual rows). */
export const UNASSIGNED_PROJECT_QUERY = "_unassigned";

export type ProjectFilter = "all" | typeof UNASSIGNED_PROJECT_QUERY | string;

type RowWithProject = { projectKey?: string | null };

export function parseProjectFilter(
  raw: Record<string, string | string[] | undefined>,
): ProjectFilter {
  const vRaw = typeof raw.project === "string" ? raw.project.trim() : "";
  if (!vRaw || vRaw === "all") return "all";
  if (vRaw === UNASSIGNED_PROJECT_QUERY) return UNASSIGNED_PROJECT_QUERY;
  return vRaw.toLowerCase();
}

export function serializeProjectQueryValue(filter: ProjectFilter): string {
  if (filter === "all") return "all";
  return filter;
}

export function sameProjectFilter(a: ProjectFilter, b: ProjectFilter): boolean {
  return a === b;
}

export function projectFilterInList(
  options: ProjectFilter[],
  f: ProjectFilter,
): boolean {
  return options.some((o) => sameProjectFilter(o, f));
}

export function projectMatchesFilter(
  row: RowWithProject,
  filter: ProjectFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === UNASSIGNED_PROJECT_QUERY) {
    return !(row.projectKey?.trim());
  }
  return (row.projectKey ?? "").trim().toLowerCase() === filter;
}

/** Import basename for `tryouts.json` — onboarding tasks; omitted from prompt “writers active (7d)”. */
export const TRYOUTS_PROJECT_SLUG = "tryouts";

export function isTryoutsImportProject(
  projectKey: string | null | undefined,
): boolean {
  return (
    (projectKey ?? "").trim().toLowerCase() === TRYOUTS_PROJECT_SLUG
  );
}

/** Value stored on `CoachingInsight` / `PrunedTaskAnalysis` / matching `Prompt.projectKey`. */
export function projectFilterToDbKey(filter: ProjectFilter): string {
  if (filter === "all") return "";
  if (filter === UNASSIGNED_PROJECT_QUERY) return "";
  return filter;
}

export function getProjectFilterShortLabel(filter: ProjectFilter): string {
  if (filter === "all") return "All projects";
  if (filter === UNASSIGNED_PROJECT_QUERY) return "No project (legacy)";
  return filter;
}

/**
 * Dropdown options: `all`, optional `_unassigned` when any row lacks a project, then sorted distinct slugs.
 */
export function buildProjectFilterOptionsFromRows(
  rows: RowWithProject[],
): ProjectFilter[] {
  const out: ProjectFilter[] = ["all"];
  const hasUnassigned = rows.some((r) => !(r.projectKey?.trim()));
  const slugs = new Set<string>();
  for (const r of rows) {
    const k = r.projectKey?.trim().toLowerCase();
    if (k) slugs.add(k);
  }
  const sorted = [...slugs].sort((a, b) => a.localeCompare(b));
  if (hasUnassigned) out.push(UNASSIGNED_PROJECT_QUERY);
  out.push(...sorted);
  return out;
}
