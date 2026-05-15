/**
 * NDJSON event types from `POST /api/special-projects/openclaw/get-tasks` when exporting task JSON
 * and workflow step bundles (`Content-Type: application/x-ndjson`).
 */
export type OpenclawExportStreamEvent =
  | {
      type: "phase";
      phase: "production_tasks" | "workflow_steps";
      status: "started" | "finished";
      exitCode?: number | null;
    }
  | {
      type: "log";
      phase: "production_tasks" | "workflow_steps";
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "complete";
      ok: true;
      tasksExportPath: string;
      workflowStepsOutDir: string;
    }
  | {
      type: "complete";
      ok: false;
      step: string;
      error: string;
      tasksExportPath?: string;
    }
  /** Unexpected server error before/during streaming. */
  | { type: "fatal"; message: string };
