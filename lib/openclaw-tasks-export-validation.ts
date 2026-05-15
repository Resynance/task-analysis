import { readFileSync } from "node:fs";

type TasksExportPayload = {
  tasks?: unknown[];
  api_errors?: Array<{ error?: string; warning?: string }>;
  list_source?: string;
  stats?: { tasks_exported?: number };
};

/**
 * Validates `tasks_created_after_export.json` before kicking off long-running export steps.
 * The upstream exporter can exit successfully with an empty task list when remote listing is not
 * configured — this guard surfaces a clear operator message instead of a no-op run.
 */
export function validateTasksExportHasRows(tasksJsonPath: string):
  | { ok: true; taskCount: number }
  | { ok: false; userMessage: string } {
  let data: TasksExportPayload;
  try {
    data = JSON.parse(readFileSync(tasksJsonPath, "utf8")) as TasksExportPayload;
  } catch (e) {
    return {
      ok: false,
      userMessage: `Could not parse tasks export: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (tasks.length > 0) {
    return { ok: true, taskCount: tasks.length };
  }

  const exported = data.stats?.tasks_exported;
  if (typeof exported === "number" && exported > 0) {
    return { ok: true, taskCount: exported };
  }

  let userMessage =
    "No tasks were exported. Configure Supabase (URL + anon key or JWT) or use a HAR that includes a successful PostgREST /rest/v1 request with apikey so the production script can fetch rows.";

  if (data.list_source === "api_missing_config") {
    userMessage =
      "Supabase access is missing: REST URL, publishable anon key (apikey), and a user JWT for Authorization. Use openclaw_portal_defaults.json (supabase_url / supabase_anon_key), the form, OPENCLAW_SUPABASE_* / SUPABASE_* on the Next.js process, page-data scrape when it runs, or a HAR with any PostgREST /rest/v1 request that includes apikey.";
  }

  const apiErrs = data.api_errors;
  if (Array.isArray(apiErrs) && apiErrs.length > 0) {
    const first = apiErrs[0];
    const fromApi =
      (typeof first?.error === "string" && first.error) ||
      (typeof first?.warning === "string" && first.warning);
    if (fromApi) {
      userMessage = fromApi;
    }
  }

  return { ok: false, userMessage };
}
