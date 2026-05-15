import { describe, expect, it } from "vitest";

import { normalizeCsvHeader, parseCsvToRows } from "./csv-rfc4180";

describe("normalizeCsvHeader", () => {
  it("trims, lowercases, and collapses spaces to underscores", () => {
    expect(normalizeCsvHeader("  Foo Bar  ")).toBe("foo_bar");
    expect(normalizeCsvHeader("A")).toBe("a");
  });
});

describe("parseCsvToRows", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsvToRows("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields with commas and doubled quotes", () => {
    expect(parseCsvToRows('"hello, world",x\n"""quoted""",y')).toEqual([
      ["hello, world", "x"],
      ['"quoted"', "y"],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsvToRows('"line1\nline2",z')).toEqual([["line1\nline2", "z"]]);
  });

  it("ignores carriage returns outside quoted content", () => {
    expect(parseCsvToRows("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsvToRows("")).toEqual([]);
  });
});
