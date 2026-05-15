/**
 * Task **environment** dimension (`env_key` on imports): labels, URL filters, and helpers so the
 * prompt library and metrics can slice tasks by evaluation context. `TASK_ENVIRONMENTS` is the
 * canonical list of environment ids shown in the UI.
 */

import type { ProjectFilter } from "@/lib/task-project";
import { projectMatchesFilter } from "@/lib/task-project";

export const TASK_ENVIRONMENTS = [
  {
    id: "funnel",
    label: "Funnel",
    description: "Funnel flows",
  },
  {
    id: "harbor",
    label: "Harbor",
    description: "Research-based Harbor tasks",
  },
  {
    id: "quickbooks",
    label: "Quickbooks",
    description: "QuickBooks-style accounting tasks",
  },
  {
    id: "finance_lh",
    label: "Finance-lh",
    description: "Multi-app finance (Finance-lh)",
  },
] as const;

export type TaskEnvironmentId = (typeof TASK_ENVIRONMENTS)[number]["id"];

/** Non-canonical env_key — appears when exports use custom env strings (e.g. fos-code). */
export type RawEnvFilter = {
  kind: "raw_env";
  normalized: string;
  /** First-seen casing for UI (optional when parsed from URL only). */
  label?: string;
};

export type EnvFilter =
  | "all"
  | TaskEnvironmentId
  | "unmapped"
  | RawEnvFilter;

const BASE_SLUGS = new Set<string>([
  "all",
  "funnel",
  "harbor",
  "quickbooks",
  "finance_lh",
  "unmapped",
]);

/**
 * Serialize filter for `?env=` (use with parseEnvFilter).
 */
export function serializeEnvQueryValue(filter: EnvFilter): string {
  if (filter === "all") return "all";
  if (typeof filter === "object" && filter.kind === "raw_env") {
    return `raw:${encodeURIComponent(filter.normalized)}`;
  }
  return filter as string;
}

export function sameEnvFilter(a: EnvFilter, b: EnvFilter): boolean {
  if (a === b) return true;
  if (
    typeof a === "object" &&
    a !== null &&
    a.kind === "raw_env" &&
    typeof b === "object" &&
    b !== null &&
    b.kind === "raw_env"
  ) {
    return a.normalized === b.normalized;
  }
  return false;
}

export function envFilterInList(options: EnvFilter[], f: EnvFilter): boolean {
  return options.some((o) => sameEnvFilter(o, f));
}

/**
 * Map raw `env_key` from imported tasks to a canonical environment id.
 * Returns null when the key does not match any known environment (custom keys stay null → raw filters).
 */
export function resolveCanonicalEnvId(
  envKey: string | null | undefined,
): TaskEnvironmentId | null {
  if (!envKey?.trim()) return null;
  const k = envKey.trim().toLowerCase();

  if (k.includes("funnel")) return "funnel";
  if (k.includes("harbor")) return "harbor";
  if (
    k.includes("quickbooks") ||
    k === "qb" ||
    k.includes("quickbook")
  ) {
    return "quickbooks";
  }
  if (
    k.includes("finance-lh") ||
    k.includes("finance_lh") ||
    k.includes("financelh") ||
    k.includes("finance lh") ||
    k.includes("finance-lh-multi")
  ) {
    return "finance_lh";
  }

  return null;
}

export function parseEnvFilter(
  raw: Record<string, string | string[] | undefined>,
): EnvFilter {
  const vRaw = typeof raw.env === "string" ? raw.env.trim() : "";
  if (!vRaw || vRaw === "all") return "all";

  if (vRaw.startsWith("raw:")) {
    const inner = decodeURIComponent(vRaw.slice(4)).trim();
    if (!inner) return "all";
    return { kind: "raw_env", normalized: inner.toLowerCase() };
  }

  if (BASE_SLUGS.has(vRaw)) {
    return vRaw as EnvFilter;
  }

  return { kind: "raw_env", normalized: vRaw.toLowerCase() };
}

export function envMatchesFilter(
  envKey: string | null | undefined,
  filter: EnvFilter,
): boolean {
  if (filter === "all") return true;

  if (
    typeof filter === "object" &&
    filter !== null &&
    filter.kind === "raw_env"
  ) {
    return (envKey?.trim().toLowerCase() ?? "") === filter.normalized;
  }

  if (filter === "unmapped") {
    return resolveCanonicalEnvId(envKey) === null;
  }

  const id = resolveCanonicalEnvId(envKey);
  return id === filter;
}

/**
 * Row badge / labels — show canonical name, else the raw env_key string, else Unmapped.
 */
export function getEnvironmentLabel(
  envKey: string | null | undefined,
): string {
  const id = resolveCanonicalEnvId(envKey);
  if (id) {
    return TASK_ENVIRONMENTS.find((e) => e.id === id)?.label ?? "Unmapped";
  }
  if (envKey?.trim()) return envKey.trim();
  return "Unmapped";
}

/** Short label for filters in UI (Insights, exports, etc.). */
export function getEnvFilterShortLabel(filter: EnvFilter): string {
  if (filter === "all") return "All environments";
  if (filter === "unmapped") return "Unmapped";
  if (typeof filter === "object" && filter.kind === "raw_env") {
    return filter.label ?? filter.normalized;
  }
  const slug = filter as TaskEnvironmentId;
  return TASK_ENVIRONMENTS.find((e) => e.id === slug)?.label ?? slug;
}

/** One-line context for report headers; empty for unmapped or custom raw envs. */
export function getEnvFilterDescription(filter: EnvFilter): string {
  if (filter === "all" || filter === "unmapped") return "";
  if (typeof filter === "object" && filter.kind === "raw_env") {
    return "Custom evaluation environment from task exports";
  }
  const slug = filter as TaskEnvironmentId;
  return TASK_ENVIRONMENTS.find((e) => e.id === slug)?.description ?? "";
}

type RowWithEnv = { envKey?: string | null; projectKey?: string | null };

/**
 * Dropdown options from actual data: All, each canonical env present, each distinct
 * non-canonical env_key (e.g. fos-code), then Unmapped if anything maps to “unknown”.
 * When `projectFilter` is not `all`, only rows in that project are considered.
 */
export function buildEnvFilterOptionsFromRows(
  rows: RowWithEnv[],
  projectFilter: ProjectFilter = "all",
): EnvFilter[] {
  const scoped =
    projectFilter === "all"
      ? rows
      : rows.filter((r) => projectMatchesFilter(r, projectFilter));

  const out: EnvFilter[] = ["all"];
  const seenCanonical = new Set<TaskEnvironmentId>();
  const rawKeys = new Map<string, string>();

  let needsUnmapped = false;

  for (const r of scoped) {
    const id = resolveCanonicalEnvId(r.envKey);
    const ek = r.envKey?.trim();
    if (id) {
      seenCanonical.add(id);
    } else {
      needsUnmapped = true;
      if (ek) {
        const n = ek.toLowerCase();
        if (!rawKeys.has(n)) rawKeys.set(n, ek);
      }
    }
  }

  for (const env of TASK_ENVIRONMENTS) {
    if (seenCanonical.has(env.id)) out.push(env.id);
  }

  const rawSorted = [...rawKeys.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [normalized, label] of rawSorted) {
    out.push({ kind: "raw_env", normalized, label });
  }

  if (needsUnmapped) out.push("unmapped");

  return out;
}
