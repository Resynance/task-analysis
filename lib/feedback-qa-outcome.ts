/**
 * QA approval / rejection signals come from ingested feedback CSV columns stored in `extra`
 * (`is_positive`, `rejection_reason`, `rejection_reason_label`). See `import-feedback-csv.ts`.
 */

export type FeedbackQaOutcome = "approved" | "rejected" | "unknown";

export function getFeedbackQaOutcome(extra: unknown): FeedbackQaOutcome {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    return "unknown";
  }
  const o = extra as Record<string, unknown>;

  const ip = o.is_positive;
  if (ip === true || ip === "true") return "approved";
  if (ip === false || ip === "false") return "rejected";

  const rr =
    typeof o.rejection_reason === "string" && o.rejection_reason.trim().length > 0;
  const rl =
    typeof o.rejection_reason_label === "string" &&
    o.rejection_reason_label.trim().length > 0;
  if (rr || rl) return "rejected";

  return "unknown";
}
