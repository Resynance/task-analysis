import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveCanonicalEnvId } from "@/lib/task-environment";

const PRUNED_DIR = "all_prompt_status";

/** Stored when analysis short-circuits because the task is listed in `{env}-pruned.json`. */
export const PRUNED_SCORE_RATIONALE =
  "This task’s key appears in the environment pruned-task list (all_prompt_status/{env}-pruned.json). It was not scored against the rubric by the model; pruned tasks are excluded from coaching insights.";

type PrunedSourceRow = { key?: unknown };

export function normalizePrunedTaskKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * File stem for `{stem}-pruned.json` — matches `runPrunedTasksAnalysis` / UI env filters.
 */
export function prunedFileStemFromPromptEnvKey(
  envKey: string | null | undefined,
): string | null {
  if (!envKey?.trim()) return null;
  const canonical = resolveCanonicalEnvId(envKey);
  if (canonical) return canonical;
  return envKey.trim().toLowerCase();
}

export async function loadPrunedSourceKeySet(
  stem: string,
): Promise<Set<string>> {
  const rel = `${PRUNED_DIR}/${stem}-pruned.json`;
  const full = path.join(process.cwd(), rel);
  let raw: string;
  try {
    raw = await readFile(full, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return new Set();
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return new Set();
  const out = new Set<string>();
  for (const row of parsed as PrunedSourceRow[]) {
    if (typeof row.key === "string" && row.key.trim()) {
      out.add(normalizePrunedTaskKey(row.key));
    }
  }
  return out;
}

export function promptMatchesPrunedSet(
  envKey: string | null | undefined,
  sourceKey: string | null | undefined,
  prunedByStem: Map<string, Set<string>>,
): boolean {
  const stem = prunedFileStemFromPromptEnvKey(envKey);
  if (!stem || !sourceKey?.trim()) return false;
  const set = prunedByStem.get(stem);
  if (!set || set.size === 0) return false;
  return set.has(normalizePrunedTaskKey(sourceKey));
}

/** Load pruned key sets for every distinct env stem present in the rows. */
export async function loadPrunedKeySetsForEnvStems(
  stems: Iterable<string>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const stem of stems) {
    if (!stem || out.has(stem)) continue;
    out.set(stem, await loadPrunedSourceKeySet(stem));
  }
  return out;
}

export function collectPrunedStemsFromPromptRows(
  rows: { envKey: string | null | undefined }[],
): Set<string> {
  const stems = new Set<string>();
  for (const r of rows) {
    const s = prunedFileStemFromPromptEnvKey(r.envKey);
    if (s) stems.add(s);
  }
  return stems;
}
