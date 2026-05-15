import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveCanonicalEnvId } from "@/lib/task-environment";

/** Cached scenario maps per env slug (small files; invalidated only on process restart). */
const scenarioMapCache = new Map<
  string,
  Record<string, string> | null | undefined
>();

export function getTaskProjectTargetIdFromExtra(
  extra: unknown,
): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const v = (extra as Record<string, unknown>).task_project_target_id;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/**
 * Filename stem for `scenarios/${slug}.json` — canonical env id or normalized raw env_key.
 */
export function scenarioSlugFromEnvKey(
  envKey: string | null | undefined,
): string | null {
  const canonical = resolveCanonicalEnvId(envKey);
  if (canonical) return canonical;
  const trimmed = envKey?.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length ? slug : null;
}

function normalizeScenarioMap(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !v.trim()) continue;
    out[k.trim().toLowerCase()] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Load `scenarios/{slug}.json` as a map of project id → user story text.
 * Keys in the file may be any casing; matching is case-insensitive.
 *
 * If `{slug}.json` is missing, also tries hyphen ↔ underscore variants (e.g. `fos-code` vs `fos_code`).
 */
export function loadScenarioProjectMap(
  slug: string,
): Record<string, string> | null {
  if (scenarioMapCache.has(slug)) {
    const c = scenarioMapCache.get(slug);
    return c === undefined ? null : c;
  }
  const cwd = process.cwd();
  const candidates = [
    slug,
    slug.replace(/-/g, "_"),
    slug.replace(/_/g, "-"),
  ].filter((s, i, arr) => arr.indexOf(s) === i);

  for (const stem of candidates) {
    const filePath = path.join(cwd, "scenarios", `${stem}.json`);
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      const map = normalizeScenarioMap(raw);
      scenarioMapCache.set(slug, map);
      return map;
    } catch {
      scenarioMapCache.set(slug, null);
      return null;
    }
  }

  scenarioMapCache.set(slug, null);
  return null;
}

/**
 * Resolves the user story for a task when `scenarios/{env}.json` contains the task's
 * `task_project_target_id` (from ingest `extra`).
 */
export function getUserStoryForPrompt(
  envKey: string | null | undefined,
  extra: unknown,
): string | null {
  const projectId = getTaskProjectTargetIdFromExtra(extra);
  if (!projectId) return null;
  const slug = scenarioSlugFromEnvKey(envKey);
  if (!slug) return null;
  const map = loadScenarioProjectMap(slug);
  if (!map) return null;
  return map[projectId.toLowerCase()] ?? null;
}
