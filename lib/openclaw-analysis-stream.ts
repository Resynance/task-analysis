/**
 * NDJSON event types from `POST /api/special-projects/openclaw/run-analysis` (spawned audit script
 * stdout/stderr parsed into phases, progress, and completion).
 */
export type OpenclawAnalysisStreamEvent =
  | {
      type: "phase";
      phase: "openclaw_analysis";
      status: "started" | "finished";
      exitCode?: number | null;
    }
  | {
      /** Derived from audit script stdout (`Auditing N…`, `[i/n] …`). */
      type: "progress";
      phase: "openclaw_analysis";
      /** Tasks finished so far (updates when each `[i/n]` line starts). */
      completed: number;
      /** Total tasks in this run, or null until the script prints counts. */
      total: number | null;
      /** Short status for the bar area. */
      label: string;
    }
  | {
      /** Prior `task_*.md` files removed before this run (when skip-existing is off). */
      type: "reports_cleared";
      phase: "openclaw_analysis";
      count: number;
    }
  | {
      /** Structured counts emitted once before auditing (`audit_trace_workflow_steps.py`). */
      type: "queue_info";
      phase: "openclaw_analysis";
      workflowJsonFiles: number;
      withStepsEligible: number;
      toAudit: number;
      skipExisting: boolean;
    }
  | {
      type: "log";
      phase: "openclaw_analysis";
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "complete";
      ok: true;
      reportsDir: string;
      workflowStepsDir: string;
    }
  | {
      type: "complete";
      ok: false;
      error: string;
    }
  | { type: "fatal"; message: string };
