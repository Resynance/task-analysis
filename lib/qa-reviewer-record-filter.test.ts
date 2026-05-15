import { describe, expect, it } from "vitest";
import {
  filterRowsByReviewerMinRecords,
  QA_MIN_REVIEWER_RECORDS,
} from "./qa-reviewer-record-filter";

function row(createdById: string | null, idx: number) {
  return {
    id: `${createdById ?? "unknown"}-${idx}`,
    createdById,
    createdByEmail: null,
    createdByName: null,
  };
}

describe("filterRowsByReviewerMinRecords", () => {
  it("keeps only rows from reviewers at or above the minimum volume", () => {
    const enough = Array.from({ length: QA_MIN_REVIEWER_RECORDS }, (_, idx) =>
      row("reviewer-1", idx),
    );
    const tooFew = Array.from({ length: QA_MIN_REVIEWER_RECORDS - 1 }, (_, idx) =>
      row("reviewer-2", idx),
    );

    expect(
      filterRowsByReviewerMinRecords([...enough, ...tooFew]).map((r) => r.id),
    ).toEqual(enough.map((r) => r.id));
  });
});
