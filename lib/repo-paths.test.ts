import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPmgptFailureRootRelative,
  getRecentOnboardsCsvRelative,
  getTraceExportsRootRelative,
  PM_FAILURE_ROOT_RELATIVE_DEFAULT,
  RECENT_ONBOARDS_CSV_RELATIVE_DEFAULT,
  TRACE_EXPORTS_RELATIVE_DEFAULT,
} from "./repo-paths";

describe("repo-paths", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults trace and PM failure roots", () => {
    expect(getTraceExportsRootRelative()).toBe(TRACE_EXPORTS_RELATIVE_DEFAULT);
    expect(getPmgptFailureRootRelative()).toBe(PM_FAILURE_ROOT_RELATIVE_DEFAULT);
    expect(getRecentOnboardsCsvRelative()).toBe(
      RECENT_ONBOARDS_CSV_RELATIVE_DEFAULT,
    );
  });

  it("rejects path traversal in TASK_ANALYSIS_TRACE_EXPORTS_DIR", () => {
    vi.stubEnv("TASK_ANALYSIS_TRACE_EXPORTS_DIR", "projects/../../etc");
    expect(getTraceExportsRootRelative()).toBe(TRACE_EXPORTS_RELATIVE_DEFAULT);
  });

  it("accepts a custom trace root", () => {
    vi.stubEnv(
      "TASK_ANALYSIS_TRACE_EXPORTS_DIR",
      "projects/custom/trace-exports",
    );
    expect(getTraceExportsRootRelative()).toBe("projects/custom/trace-exports");
  });

  it("accepts a custom recent onboards CSV path", () => {
    vi.stubEnv(
      "TASK_ANALYSIS_RECENT_ONBOARDS_CSV",
      "projects/custom/onboards.csv",
    );
    expect(getRecentOnboardsCsvRelative()).toBe("projects/custom/onboards.csv");
  });
});
