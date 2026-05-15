import {
  getFeedbackQaOutcome,
  type FeedbackQaOutcome,
} from "@/lib/feedback-qa-outcome";

export type FeedbackRowForQaMetrics = {
  extra: unknown;
  createdById: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

export type QaRejectionUserRow = {
  /** Stable grouping key for sorting / React keys */
  groupKey: string;
  /** Same display rules as the feedback library */
  label: string;
  total: number;
  approved: number;
  rejected: number;
  unknown: number;
  /** `rejected / (approved + rejected)` when there is at least one classified row */
  classifiedRejectionPercent: number | null;
};

export type QaRejectionSnapshot = {
  byUser: QaRejectionUserRow[];
  scope: {
    total: number;
    approved: number;
    rejected: number;
    unknown: number;
    classifiedRejectionPercent: number | null;
  };
};

function reviewerLabel(row: FeedbackRowForQaMetrics): string {
  return (
    row.createdByName?.trim() ||
    row.createdByEmail?.trim() ||
    row.createdById?.trim() ||
    "Unknown reviewer"
  );
}

function reviewerGroupKey(row: FeedbackRowForQaMetrics): string {
  const id = row.createdById?.trim();
  if (id) return `id:${id}`;
  const email = row.createdByEmail?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = row.createdByName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return "unknown";
}

function tallyOutcome(
  counts: { approved: number; rejected: number; unknown: number },
  outcome: FeedbackQaOutcome,
): void {
  if (outcome === "approved") counts.approved += 1;
  else if (outcome === "rejected") counts.rejected += 1;
  else counts.unknown += 1;
}

export function computeQaRejectionMetrics(
  rows: FeedbackRowForQaMetrics[],
): QaRejectionSnapshot {
  const map = new Map<
    string,
    {
      label: string;
      approved: number;
      rejected: number;
      unknown: number;
    }
  >();

  let scopeApproved = 0;
  let scopeRejected = 0;
  let scopeUnknown = 0;

  for (const row of rows) {
    const outcome = getFeedbackQaOutcome(row.extra);
    const key = reviewerGroupKey(row);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { label: reviewerLabel(row), approved: 0, rejected: 0, unknown: 0 };
      map.set(key, bucket);
    } else {
      // Prefer a richer display name when the same person appears with more fields later
      const nextLabel = reviewerLabel(row);
      if (
        bucket.label === "Unknown reviewer" &&
        nextLabel !== "Unknown reviewer"
      ) {
        bucket.label = nextLabel;
      }
    }
    tallyOutcome(bucket, outcome);
    if (outcome === "approved") scopeApproved += 1;
    else if (outcome === "rejected") scopeRejected += 1;
    else scopeUnknown += 1;
  }

  const classified = scopeApproved + scopeRejected;
  const scopeRate =
    classified > 0
      ? Math.round((scopeRejected / classified) * 1000) / 10
      : null;

  const byUser: QaRejectionUserRow[] = [...map.entries()].map(([groupKey, b]) => {
    const total = b.approved + b.rejected + b.unknown;
    const cls = b.approved + b.rejected;
    const classifiedRejectionPercent =
      cls > 0 ? Math.round((b.rejected / cls) * 1000) / 10 : null;
    return {
      groupKey,
      label: b.label,
      total,
      approved: b.approved,
      rejected: b.rejected,
      unknown: b.unknown,
      classifiedRejectionPercent,
    };
  });

  byUser.sort((a, b) => {
    const ar = a.classifiedRejectionPercent;
    const br = b.classifiedRejectionPercent;
    if (ar != null && br != null && br !== ar) return br - ar;
    if (ar == null && br != null) return 1;
    if (br == null && ar != null) return -1;
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });

  return {
    byUser,
    scope: {
      total: rows.length,
      approved: scopeApproved,
      rejected: scopeRejected,
      unknown: scopeUnknown,
      classifiedRejectionPercent: scopeRate,
    },
  };
}
