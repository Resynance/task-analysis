import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reads optional `openclaw_portal_defaults.json` beside trace-export scripts. Shape is shared with
 * the Python exporters; keep real ids out of committed defaults in public forks.
 */
export function readOpenclawPortalDefaultsFile(traceExportsDir: string): {
  portalProjectId: string | null;
  teamId: string | null;
} {
  const filePath = path.join(traceExportsDir, "openclaw_portal_defaults.json");
  if (!existsSync(filePath)) {
    return { portalProjectId: null, teamId: null };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { portalProjectId: null, teamId: null };
    }
    const o = raw as Record<string, unknown>;
    const portal =
      typeof o.portal_project_id === "string"
        ? o.portal_project_id.trim() || null
        : null;
    const team =
      typeof o.team_id === "string" ? o.team_id.trim() || null : null;
    return { portalProjectId: portal, teamId: team };
  } catch {
    return { portalProjectId: null, teamId: null };
  }
}
