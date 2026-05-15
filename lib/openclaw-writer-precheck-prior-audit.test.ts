import { describe, expect, it } from "vitest";

import type { WriterPrecheckCsvRow } from "@/lib/openclaw-writer-precheck-csv";

import {
  findWriterPrecheckPriorAudit,
  normalizePromptForAuditMatch,
  type WriterPrecheckAuditLookup,
  type WriterPrecheckPriorAuditLookupRow,
} from "./openclaw-writer-precheck-prior-audit";

function row(partial: Partial<WriterPrecheckCsvRow>): WriterPrecheckCsvRow {
  return {
    rowIndex: 1,
    externalId: null,
    prompt: "default prompt long enough for tests",
    writerRubric: null,
    notes: null,
    writerName: null,
    personaName: null,
    ...partial,
  };
}

function lookupFrom(
  byTask: [string, WriterPrecheckPriorAuditLookupRow][],
  byPrefix: [string, WriterPrecheckPriorAuditLookupRow][],
): WriterPrecheckAuditLookup {
  return {
    byTaskKey: new Map(byTask),
    byPromptPrefix: new Map(byPrefix),
  };
}

function entry(
  p: Partial<WriterPrecheckPriorAuditLookupRow> &
    Pick<
      WriterPrecheckPriorAuditLookupRow,
      "verdict" | "taskKey" | "reportFileName"
    >,
): WriterPrecheckPriorAuditLookupRow {
  return {
    auditedAt: "",
    targetWorld: "",
    matchType: "task_key",
    mtimeMs: 1,
    ...p,
  };
}

describe("normalizePromptForAuditMatch", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizePromptForAuditMatch("  a\n\tb   c  ")).toBe("a b c");
  });
});

describe("findWriterPrecheckPriorAudit", () => {
  it("matches by exact task id", () => {
    const lu = lookupFrom(
      [
        [
          "task_abc",
          entry({
            verdict: "PASS",
            taskKey: "task_abc",
            reportFileName: "task_abc.md",
            mtimeMs: 10,
          }),
        ],
      ],
      [],
    );
    const hit = findWriterPrecheckPriorAudit(
      row({ externalId: "task_abc", prompt: "x".repeat(50) }),
      lu,
    );
    expect(hit?.verdict).toBe("PASS");
    expect(hit?.matchType).toBe("task_key");
  });

  it("adds task_ prefix when sheet id omits it", () => {
    const lu = lookupFrom(
      [
        [
          "task_xyz",
          entry({
            verdict: "FAIL",
            taskKey: "task_xyz",
            reportFileName: "task_xyz.md",
            mtimeMs: 1,
          }),
        ],
      ],
      [],
    );
    const hit = findWriterPrecheckPriorAudit(
      row({ externalId: "xyz", prompt: "y".repeat(50) }),
      lu,
    );
    expect(hit?.verdict).toBe("FAIL");
    expect(hit?.matchType).toBe("task_key");
  });

  it("prefers task id over prompt prefix when both match", () => {
    const shared = "match-me-on-prefix-123456789012";
    const rowEntry = entry({
      verdict: "PASS",
      taskKey: "task_onlyid",
      reportFileName: "task_onlyid.md",
      mtimeMs: 5,
    });
    const prefixEntry = entry({
      verdict: "FAIL",
      taskKey: "task_other",
      reportFileName: "task_other.md",
      matchType: "prompt_prefix",
      mtimeMs: 9,
    });
    const lu = lookupFrom(
      [
        [
          "task_onlyid",
          rowEntry,
        ],
      ],
      [[normalizePromptForAuditMatch(shared).slice(0, 140), prefixEntry]],
    );
    const hit = findWriterPrecheckPriorAudit(
      row({ externalId: "task_onlyid", prompt: shared }),
      lu,
    );
    expect(hit?.verdict).toBe("PASS");
    expect(hit?.matchType).toBe("task_key");
  });

  it("matches by normalized prompt prefix when id missing", () => {
    const p = "unique-prefix-abcdefghijklm";
    const lu = lookupFrom(
      [],
      [
        [
          normalizePromptForAuditMatch(p).slice(0, 140),
          entry({
            verdict: "CONDITIONAL",
            taskKey: "task_z",
            reportFileName: "task_z.md",
            matchType: "prompt_prefix",
            mtimeMs: 1,
          }),
        ],
      ],
    );
    const hit = findWriterPrecheckPriorAudit(
      row({ externalId: null, prompt: p }),
      lu,
    );
    expect(hit?.verdict).toBe("CONDITIONAL");
    expect(hit?.matchType).toBe("prompt_prefix");
  });

  it("returns null when prefix too short", () => {
    const lu = lookupFrom(
      [],
      [
        [
          "short",
          entry({
            verdict: "PASS",
            taskKey: "t",
            reportFileName: "task_t.md",
            matchType: "prompt_prefix",
            mtimeMs: 1,
          }),
        ],
      ],
    );
    expect(
      findWriterPrecheckPriorAudit(row({ externalId: null, prompt: "hi" }), lu),
    ).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(
      findWriterPrecheckPriorAudit(
        row({ externalId: "missing", prompt: "nope" }),
        lookupFrom([], []),
      ),
    ).toBeNull();
  });
});
