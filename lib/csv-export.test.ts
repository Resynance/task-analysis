import { describe, expect, it } from "vitest";

import { csvEscape, promptsToCsv } from "./csv-export";

describe("csvEscape", () => {
  it("returns empty string for nullish", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("returns plain values when no special chars", () => {
    expect(csvEscape("abc")).toBe("abc");
    expect(csvEscape(42)).toBe("42");
  });

  it("quotes and escapes RFC 4180 specials", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
    expect(csvEscape("c\rd")).toBe('"c\rd"');
  });
});

describe("promptsToCsv", () => {
  it("writes header and one data row with ISO dates", () => {
    const created = new Date("2024-01-02T03:04:05.000Z");
    const analyzed = new Date("2024-01-03T00:00:00.000Z");
    const csv = promptsToCsv([
      {
        id: "id1",
        sourceId: null,
        sourceKey: "sk",
        projectKey: "p",
        guidelineName: "G",
        score: "POOR",
        rationale: 'Has "quotes"',
        body: "body",
        envKey: "e",
        canonicalEnv: "quickbooks",
        taskModality: "text",
        analyzedAt: analyzed,
        createdAt: created,
      },
    ]);
    expect(csv).toContain("id,source_id,source_key,project_key");
    expect(csv).toContain('"Has ""quotes"""');
    expect(csv).toContain("2024-01-03T00:00:00.000Z");
    expect(csv).toContain("2024-01-02T03:04:05.000Z");
  });

  it("leaves analyzed_at empty when null", () => {
    const csv = promptsToCsv([
      {
        id: "i",
        sourceId: null,
        sourceKey: null,
        projectKey: null,
        guidelineName: "G",
        score: null,
        rationale: null,
        body: "b",
        envKey: null,
        taskModality: null,
        analyzedAt: null,
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    ]);
    expect(csv.split("\n")[1]?.split(",")[10]).toBe("");
  });
});
