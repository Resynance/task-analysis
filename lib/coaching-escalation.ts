/**
 * Detects records tied to escalated QA workflows so they are excluded from
 * user-level coaching (we do not want the model to learn from that slice).
 */

function readEscalatedCountFromMetadata(meta: unknown): number | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  const e = m.escalated;
  if (typeof e === "number" && Number.isFinite(e)) return e;
  if (typeof e === "string" && /^\d+$/.test(e.trim())) return parseInt(e.trim(), 10);
  if (e === true) return 1;
  return null;
}

/** True when import metadata records at least one escalation for the task. */
export function promptExtraIndicatesEscalated(extra: unknown): boolean {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return false;
  const ex = extra as Record<string, unknown>;
  const etv = ex.eval_task_versions;
  if (etv && typeof etv === "object" && !Array.isArray(etv)) {
    const meta = (etv as Record<string, unknown>).metadata;
    const n = readEscalatedCountFromMetadata(meta);
    if (n !== null && n > 0) return true;
  }
  const topMeta = ex.metadata;
  const n2 = readEscalatedCountFromMetadata(topMeta);
  if (n2 !== null && n2 > 0) return true;
  return false;
}

const TEXT_ESCALATION_PATTERNS: RegExp[] = [
  /\bescalated\s+to\s+fleet/i,
  /\bfleet\s+review\b/i,
  /flagged\s+as\s+bugg/i,
  /\btask\s+cannot\s+be\s+graded\b/i,
  /\bcannot\s+be\s+graded\s+correctly\b/i,
  /\bcannot\s+grade\s+(this\s+)?task\b/i,
  /\bescalation\s+to\s+(fleet|engineering|review)\b/i,
  /\bnot\s+gradable\b/i,
  /\bungradable\b/i,
];

function textIndicatesEscalation(body: string, rationale: string | null): boolean {
  const combined = `${body}\n${rationale ?? ""}`;
  return TEXT_ESCALATION_PATTERNS.some((re) => re.test(combined));
}

export function isExcludedFromUserCoaching(opts: {
  body: string;
  rationale: string | null;
  extra?: unknown | null;
}): boolean {
  if (opts.extra != null && promptExtraIndicatesEscalated(opts.extra)) {
    return true;
  }
  return textIndicatesEscalation(opts.body, opts.rationale);
}
