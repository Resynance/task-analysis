import { describe, expect, it } from "vitest";

import { getFeedbackQaOutcome } from "./feedback-qa-outcome";

describe("getFeedbackQaOutcome", () => {
  it("returns unknown for non-objects", () => {
    expect(getFeedbackQaOutcome(null)).toBe("unknown");
    expect(getFeedbackQaOutcome(undefined)).toBe("unknown");
    expect(getFeedbackQaOutcome("x")).toBe("unknown");
    expect(getFeedbackQaOutcome([])).toBe("unknown");
  });

  it("reads is_positive", () => {
    expect(getFeedbackQaOutcome({ is_positive: true })).toBe("approved");
    expect(getFeedbackQaOutcome({ is_positive: "true" })).toBe("approved");
    expect(getFeedbackQaOutcome({ is_positive: false })).toBe("rejected");
    expect(getFeedbackQaOutcome({ is_positive: "false" })).toBe("rejected");
  });

  it("treats rejection fields as rejected when is_positive absent", () => {
    expect(getFeedbackQaOutcome({ rejection_reason: "bad" })).toBe("rejected");
    expect(getFeedbackQaOutcome({ rejection_reason_label: "X" })).toBe("rejected");
    expect(getFeedbackQaOutcome({ rejection_reason: "  " })).toBe("unknown");
  });
});
