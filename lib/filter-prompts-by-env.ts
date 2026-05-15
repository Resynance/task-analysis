import type { EnvFilter } from "@/lib/task-environment";
import { envMatchesFilter } from "@/lib/task-environment";

/**
 * Shared row filter: keep prompts whose `envKey` matches the active environment filter.
 */
type Row = { envKey?: string | null };

export function filterRowsByEnv<T extends Row>(rows: T[], filter: EnvFilter): T[] {
  if (filter === "all") return rows;
  return rows.filter((r) => envMatchesFilter(r.envKey, filter));
}
