import path from "node:path";

import { getTraceExportsRootAbsolute } from "@/lib/repo-paths";

/** Repo-relative root for trace-export scripts and their outputs (see `TASK_ANALYSIS_TRACE_EXPORTS_DIR`). */
export function getOpenclawTraceExportsDir(): string {
  return getTraceExportsRootAbsolute();
}

export function getOpenclawProductionExportScriptPath(): string {
  return path.join(
    getOpenclawTraceExportsDir(),
    "export_openclaw_production_tasks.py",
  );
}

export function getOpenclawWorkflowStepsScriptPath(): string {
  return path.join(
    getOpenclawTraceExportsDir(),
    "export_openclaw_task_workflow_steps.py",
  );
}

export function getOpenclawTasksExportJsonPath(): string {
  return path.join(getOpenclawTraceExportsDir(), "tasks_created_after_export.json");
}

export function getOpenclawWorkflowStepsOutDir(): string {
  return path.join(getOpenclawTraceExportsDir(), "workflow-steps-by-task");
}

export function getOpenclawAuditScriptPath(): string {
  return path.join(getOpenclawTraceExportsDir(), "audit_trace_workflow_steps.py");
}

/** Markdown audit reports (fleet-audit/openclaw-compatible layout). */
export function getOpenclawAuditReportsDir(): string {
  return path.join(getOpenclawTraceExportsDir(), "reports");
}
