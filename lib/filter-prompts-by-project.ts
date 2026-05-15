import type { ProjectFilter } from "@/lib/task-project";
import { projectMatchesFilter } from "@/lib/task-project";

type Row = { projectKey?: string | null };

export function filterRowsByProject<T extends Row>(
  rows: T[],
  filter: ProjectFilter,
): T[] {
  if (filter === "all") return rows;
  return rows.filter((r) => projectMatchesFilter(r, filter));
}
