import type { WriterPrecheckCsvRow } from "@/lib/openclaw-writer-precheck-csv";
import {
  extractAuditVerdictFromMarkdown,
  listAuditReportFiles,
  readAuditReportFile,
  type AuditVerdict,
} from "@/lib/openclaw-audit-report-read";

/**
 * Joins **writer pre-check CSV rows** with **workflow audit reports** on disk (same tree as the
 * in-repo trace analyze flow).
 *
 * **Audit files:** Markdown under `<trace-export root>/reports/task_*.md` (see `lib/repo-paths.ts`
 * for the configurable root), produced by
 * `audit_trace_workflow_steps.py` in this repository. Parsing helpers: `lib/openclaw-audit-report-read.ts`.
 *
 * **Match order:** (1) Sheet task id (`externalId`) vs report `task_key` / filename stem, with an
 * automatic `task_` prefix when the sheet omits it. (2) If no id match, compare normalized prompt
 * prefix to YAML `prompt` — only the first **140** characters exist in frontmatter (Python truncates),
 * so prompts that differ only after 140 chars look identical here. Prefix matching is skipped when
 * the normalized prefix is shorter than `MIN_PROMPT_PREFIX_LEN` to limit false positives.
 */

export type WriterPrecheckPriorAudit = {
  verdict: AuditVerdict;
  taskKey: string;
  reportFileName: string;
  auditedAt: string;
  /** `target_world` from audit report frontmatter (workflow target). */
  targetWorld: string;
  matchType: "task_key" | "prompt_prefix";
};

/** Internal index row; `mtimeMs` picks the newest report when keys collide. */
export type WriterPrecheckPriorAuditLookupRow = WriterPrecheckPriorAudit & {
  mtimeMs: number;
};

/** Align with `audit_trace_workflow_steps.py` frontmatter `prompt` (first 140 chars). */
const PROMPT_PREFIX_MAX = 140;
/** Avoid matching on very short shared prefixes. */
const MIN_PROMPT_PREFIX_LEN = 12;

/** Collapses whitespace so CSV and YAML `prompt` keys compare consistently. */
export function normalizePromptForAuditMatch(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function newer(
  a: WriterPrecheckPriorAuditLookupRow | undefined,
  b: WriterPrecheckPriorAuditLookupRow,
): WriterPrecheckPriorAuditLookupRow {
  if (!a) return b;
  if (!b) return a;
  return a.mtimeMs >= b.mtimeMs ? a : b;
}

function toPublic(entry: WriterPrecheckPriorAuditLookupRow): WriterPrecheckPriorAudit {
  return {
    verdict: entry.verdict,
    taskKey: entry.taskKey,
    reportFileName: entry.reportFileName,
    auditedAt: entry.auditedAt,
    targetWorld: entry.targetWorld,
    matchType: entry.matchType,
  };
}

function taskKeyLookupVariants(externalId: string | null): string[] {
  const t = externalId?.trim() ?? "";
  if (!t) return [];
  const out = new Set<string>();
  out.add(t);
  // Sprint exports often use `task_…` keys; spreadsheet columns sometimes drop the prefix.
  if (!t.startsWith("task_")) {
    out.add(`task_${t}`);
  }
  return [...out];
}

export type WriterPrecheckAuditLookup = {
  byTaskKey: Map<string, WriterPrecheckPriorAuditLookupRow>;
  byPromptPrefix: Map<string, WriterPrecheckPriorAuditLookupRow>;
};

/**
 * Indexes on-disk `task_*.md` workflow audit reports (same directory as the trace analyze flow).
 * Prompt matching uses the YAML `prompt` field (≤140 chars from export), normalized.
 */
export function buildWriterPrecheckAuditLookup(): WriterPrecheckAuditLookup {
  const byTaskKey = new Map<string, WriterPrecheckPriorAuditLookupRow>();
  const byPromptPrefix = new Map<string, WriterPrecheckPriorAuditLookupRow>();

  const infos = listAuditReportFiles()
    .slice()
    // Oldest first so `newer()` keeps the latest mtime when duplicate keys exist (re-audits).
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const info of infos) {
    const data = readAuditReportFile(info.fileName);
    if (!data) continue;
    const verdict = extractAuditVerdictFromMarkdown(data.raw);
    const stem = info.fileName.replace(/\.md$/, "");
    const taskKey = (data.meta.task_key ?? stem).trim() || stem;
    const auditedAt = (data.meta.audited_at ?? "").trim();
    const targetWorld = (data.meta.target_world ?? "").trim();
    const base = {
      verdict,
      taskKey,
      reportFileName: data.fileName,
      auditedAt,
      targetWorld,
      mtimeMs: info.mtimeMs,
    };

    const taskEntry: WriterPrecheckPriorAuditLookupRow = { ...base, matchType: "task_key" };
    byTaskKey.set(taskKey, newer(byTaskKey.get(taskKey), taskEntry));
    if (stem !== taskKey) {
      byTaskKey.set(stem, newer(byTaskKey.get(stem), taskEntry));
    }

    const promptMeta = (data.meta.prompt ?? "").trim();
    const prefixKey = normalizePromptForAuditMatch(promptMeta).slice(
      0,
      PROMPT_PREFIX_MAX,
    );
    if (prefixKey.length >= MIN_PROMPT_PREFIX_LEN) {
      const promptEntry: WriterPrecheckPriorAuditLookupRow = { ...base, matchType: "prompt_prefix" };
      byPromptPrefix.set(
        prefixKey,
        newer(byPromptPrefix.get(prefixKey), promptEntry),
      );
    }
  }

  return { byTaskKey, byPromptPrefix };
}

export function findWriterPrecheckPriorAudit(
  row: WriterPrecheckCsvRow,
  lookup: WriterPrecheckAuditLookup,
): WriterPrecheckPriorAudit | null {
  // Task id is authoritative when present — avoids tying the wrong audit via shared prompt text.
  for (const key of taskKeyLookupVariants(row.externalId)) {
    const hit = lookup.byTaskKey.get(key);
    if (hit) return toPublic({ ...hit, matchType: "task_key" });
  }

  const prefix = normalizePromptForAuditMatch(row.prompt).slice(
    0,
    PROMPT_PREFIX_MAX,
  );
  if (prefix.length >= MIN_PROMPT_PREFIX_LEN) {
    const hit = lookup.byPromptPrefix.get(prefix);
    if (hit) return toPublic(hit);
  }

  return null;
}
