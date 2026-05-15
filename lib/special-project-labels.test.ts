import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSpecialProjectUiLabels } from "./special-project-labels";

describe("getSpecialProjectUiLabels", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses neutral defaults when NEXT_PUBLIC_* vars are unset", () => {
    const l = getSpecialProjectUiLabels();
    expect(l.projectsEyebrowLabel).toBe("Tools & exports");
    expect(l.traceProjectDisplayName).toBe("Trace exports");
    expect(l.transcriptFailureDisplayName).toBe("Transcript failure reports");
    expect(l.traceBreadcrumbLabel).toBe("Tools & exports · Trace exports");
  });

  it("reads NEXT_PUBLIC_TRACE_PROJECT_DISPLAY_NAME when set", () => {
    vi.stubEnv("NEXT_PUBLIC_TRACE_PROJECT_DISPLAY_NAME", "  Custom trace  ");
    const l = getSpecialProjectUiLabels();
    expect(l.traceProjectDisplayName).toBe("Custom trace");
    expect(l.writerPrecheckKicker).toBe("Custom trace · pre-recording");
  });
});
