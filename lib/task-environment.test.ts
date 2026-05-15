import { describe, expect, it } from "vitest";

import {
  buildEnvFilterOptionsFromRows,
  envMatchesFilter,
  getEnvFilterDescription,
  getEnvFilterShortLabel,
  getEnvironmentLabel,
  parseEnvFilter,
  resolveCanonicalEnvId,
  sameEnvFilter,
  serializeEnvQueryValue,
} from "./task-environment";

describe("serializeEnvQueryValue / parseEnvFilter", () => {
  it("round-trips canonical slugs", () => {
    const f = parseEnvFilter({ env: "quickbooks" });
    expect(serializeEnvQueryValue(f)).toBe("quickbooks");
  });

  it("encodes raw env filters", () => {
    const f = parseEnvFilter({ env: "raw:my%20env" });
    expect(f).toEqual({ kind: "raw_env", normalized: "my env" });
    expect(serializeEnvQueryValue(f)).toBe("raw:my%20env");
  });

  it("treats unknown slug as raw_env", () => {
    expect(parseEnvFilter({ env: "fos-code" })).toEqual({
      kind: "raw_env",
      normalized: "fos-code",
    });
  });

  it("returns all for empty raw: payload", () => {
    expect(parseEnvFilter({ env: "raw:" })).toBe("all");
    expect(parseEnvFilter({ env: "raw:%20" })).toBe("all");
  });
});

describe("sameEnvFilter", () => {
  it("compares raw_env by normalized value", () => {
    expect(
      sameEnvFilter(
        { kind: "raw_env", normalized: "a" },
        { kind: "raw_env", normalized: "a", label: "A" },
      ),
    ).toBe(true);
    expect(
      sameEnvFilter({ kind: "raw_env", normalized: "a" }, { kind: "raw_env", normalized: "b" }),
    ).toBe(false);
  });
});

describe("resolveCanonicalEnvId", () => {
  it("maps known patterns", () => {
    expect(resolveCanonicalEnvId("QuickBooks tasks")).toBe("quickbooks");
    expect(resolveCanonicalEnvId("qb")).toBe("quickbooks");
    expect(resolveCanonicalEnvId("something funnel x")).toBe("funnel");
    expect(resolveCanonicalEnvId("Harbor research")).toBe("harbor");
    expect(resolveCanonicalEnvId("finance-lh-multi")).toBe("finance_lh");
  });

  it("returns null for unmapped keys", () => {
    expect(resolveCanonicalEnvId("custom-env")).toBe(null);
    expect(resolveCanonicalEnvId("")).toBe(null);
    expect(resolveCanonicalEnvId(null)).toBe(null);
  });
});

describe("envMatchesFilter", () => {
  it("matches raw env case-insensitively on envKey", () => {
    const filter = { kind: "raw_env" as const, normalized: "fos-code" };
    expect(envMatchesFilter("FOS-CODE", filter)).toBe(true);
    expect(envMatchesFilter("other", filter)).toBe(false);
  });

  it("treats unmapped as non-canonical keys", () => {
    expect(envMatchesFilter("totally-custom", "unmapped")).toBe(true);
    expect(envMatchesFilter("quickbooks", "unmapped")).toBe(false);
  });
});

describe("getEnvironmentLabel", () => {
  it("uses canonical label when resolvable", () => {
    expect(getEnvironmentLabel("qb")).toBe("Quickbooks");
  });

  it("falls back to raw env_key or Unmapped", () => {
    expect(getEnvironmentLabel("custom")).toBe("custom");
    expect(getEnvironmentLabel("")).toBe("Unmapped");
  });
});

describe("getEnvFilterShortLabel / getEnvFilterDescription", () => {
  it("describes filters for UI", () => {
    expect(getEnvFilterShortLabel("all")).toBe("All environments");
    expect(getEnvFilterShortLabel("unmapped")).toBe("Unmapped");
    expect(
      getEnvFilterShortLabel({ kind: "raw_env", normalized: "x", label: "X" }),
    ).toBe("X");
    expect(getEnvFilterDescription("all")).toBe("");
    expect(
      getEnvFilterDescription({ kind: "raw_env", normalized: "x" }),
    ).toContain("Custom");
  });
});

describe("buildEnvFilterOptionsFromRows", () => {
  it("includes canonical envs present, raw keys, and unmapped when needed", () => {
    const opts = buildEnvFilterOptionsFromRows(
      [
        { envKey: "qb", projectKey: "p1" },
        { envKey: "custom", projectKey: "p1" },
        { envKey: null, projectKey: "p1" },
      ],
      "all",
    );
    expect(opts[0]).toBe("all");
    expect(opts).toContain("quickbooks");
    expect(opts).toContain("unmapped");
    expect(opts.some((o) => typeof o === "object" && o.kind === "raw_env")).toBe(true);
  });

  it("scopes by project filter", () => {
    const opts = buildEnvFilterOptionsFromRows(
      [
        { envKey: "qb", projectKey: "a" },
        { envKey: "harbor", projectKey: "b" },
      ],
      "a",
    );
    expect(opts).toContain("quickbooks");
    expect(opts).not.toContain("harbor");
  });
});
