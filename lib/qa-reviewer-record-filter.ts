export const QA_MIN_REVIEWER_RECORDS = 10;

export type QaReviewerRecordRow = {
  createdById: string | null;
  createdByEmail: string | null;
  createdByName: string | null;
};

function reviewerGroupKey(row: QaReviewerRecordRow): string {
  const id = row.createdById?.trim();
  if (id) return `id:${id}`;
  const email = row.createdByEmail?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = row.createdByName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return "unknown";
}

export function filterRowsByReviewerMinRecords<T extends QaReviewerRecordRow>(
  rows: T[],
  minRecords = QA_MIN_REVIEWER_RECORDS,
): T[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = reviewerGroupKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.filter((row) => {
    const key = reviewerGroupKey(row);
    return (counts.get(key) ?? 0) >= minRecords;
  });
}
