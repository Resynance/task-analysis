import { describe, expect, it } from "vitest";

import type { PromptAnalysisProblemArea } from "@/lib/analyze-prompt";
import type { WriterPrecheckPriorAudit } from "@/lib/openclaw-writer-precheck-prior-audit";

import {
  buildWriterPrecheckReportHtml,
  type WriterPrecheckPdfInput,
} from "./openclaw-writer-precheck-pdf";

function baseInput(
  overrides: Partial<WriterPrecheckPdfInput> = {},
): WriterPrecheckPdfInput {
  return {
    guidelineName: "G1",
    worldLabel: "W1",
    userStorySource: "none",
    generatedAtIso: "2026-05-11T12:00:00.000Z",
    summary: {
      total: 1,
      excellent: 1,
      average: 0,
      poor: 0,
      failed: 0,
    },
    parseWarnings: [],
    results: [
      {
        rowIndex: 1,
        externalId: "task_x",
        writerName: "Ada",
        score: "EXCELLENT",
        rationale: "Good.",
        error: null,
        problemAreas: [],
        priorAudit: null,
      },
    ],
    ...overrides,
  };
}

describe("buildWriterPrecheckReportHtml", () => {
  it("escapes HTML in guideline and rationale", () => {
    const html = buildWriterPrecheckReportHtml(
      baseInput({
        guidelineName: "<script>x</script>",
        results: [
          {
            rowIndex: 1,
            externalId: null,
            writerName: null,
            score: "AVERAGE",
            rationale: '<evil attr="y">',
            error: null,
            problemAreas: [],
            priorAudit: null,
          },
        ],
      }),
      "t",
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;evil attr=");
    expect(html).not.toContain("<script>");
  });

  it("includes stopped-early note when flagged", () => {
    const html = buildWriterPrecheckReportHtml(
      baseInput({ stoppedEarly: true }),
      "t",
    );
    expect(html).toContain("stopped before all rows");
  });

  it("renders parse warnings list", () => {
    const html = buildWriterPrecheckReportHtml(
      baseInput({ parseWarnings: ["warn one"] }),
      "t",
    );
    expect(html).toContain("warn one");
    expect(html).toContain("CSV parse warnings");
  });

  it("renders problem areas with excerpt and prior workflow audit", () => {
    const areas: PromptAnalysisProblemArea[] = [
      {
        source: "prompt",
        excerpt: 'He said "stop"',
        concern: "Too vague.",
      },
    ];
    const prior: WriterPrecheckPriorAudit = {
      verdict: "CONDITIONAL",
      taskKey: "task_abc",
      reportFileName: "task_abc.md",
      auditedAt: "2026-01-02",
      targetWorld: "env-a",
      matchType: "task_key",
    };
    const html = buildWriterPrecheckReportHtml(
      baseInput({
        results: [
          {
            rowIndex: 2,
            externalId: "e",
            writerName: null,
            score: "POOR",
            rationale: "r",
            error: null,
            problemAreas: areas,
            priorAudit: prior,
          },
        ],
      }),
      "t",
    );
    expect(html).toContain("CONDITIONAL");
    expect(html).toContain("task_abc.md");
    expect(html).toContain("&quot;stop&quot;");
    expect(html).toContain("Too vague.");
  });

  it("renders error row and omits prior-audit verdict when null", () => {
    const html = buildWriterPrecheckReportHtml(
      baseInput({
        results: [
          {
            rowIndex: 3,
            externalId: null,
            writerName: null,
            score: null,
            rationale: null,
            error: "LLM failed",
            problemAreas: [],
            priorAudit: null,
          },
        ],
      }),
      "t",
    );
    expect(html).toContain("LLM failed");
    expect(html).toContain("no matching");
  });
});
