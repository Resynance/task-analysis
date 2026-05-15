import { describe, expect, it } from "vitest";

import { extractOuterJsonObject } from "./extract-outer-json-object";

describe("extractOuterJsonObject", () => {
  it("extracts first balanced object", () => {
    const raw = 'prefix {"score":"poor","rationale":"ok"}';
    expect(extractOuterJsonObject(raw)).toBe('{"score":"poor","rationale":"ok"}');
  });

  it("does not treat } inside a string as object end", () => {
    const inner = '{"score":"average","rationale":"Use } carefully."}';
    const raw = `Here you go: ${inner} trailing`;
    expect(extractOuterJsonObject(raw)).toBe(inner);
  });

  it("throws when no opening brace", () => {
    expect(() => extractOuterJsonObject("no json")).toThrow(
      "Model did not return a JSON object",
    );
  });

  it("throws on truncated object", () => {
    expect(() => extractOuterJsonObject('{"a":1')).toThrow(
      "Incomplete JSON object",
    );
  });
});
