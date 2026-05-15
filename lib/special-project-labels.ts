/**
 * User-visible names for **special projects** (trace exports, transcript failure reports, hub nav).
 *
 * Defaults are **public-repo neutral**. Operators override with `NEXT_PUBLIC_*` variables in
 * `.env` / `.env.local` (rebuild or restart dev server after changes). Only variables prefixed with
 * `NEXT_PUBLIC_` are available in client components — this module uses that prefix exclusively.
 *
 * URLs such as `/special-projects/openclaw` stay fixed; **directory** layout under the repo can
 * be overridden with `TASK_ANALYSIS_*` (see `lib/repo-paths.ts`). Only display strings are
 * configurable here via `NEXT_PUBLIC_*`.
 */
export type SpecialProjectUiLabels = {
  /** Main nav link label pointing at `/special-projects`. */
  projectsNavLabel: string;
  /** Eyebrow / small header on special-projects hub and child pages. */
  projectsEyebrowLabel: string;
  /** Primary H1 on `/special-projects`. */
  projectsPageTitle: string;
  /** Subtitle on `/special-projects`. */
  projectsPageSubtitle: string;
  /** Card H2 + trace integration title (e.g. hub card, openclaw overview H1). */
  traceProjectDisplayName: string;
  /** Hub card body for the trace export integration. */
  traceProjectHubDescription: string;
  /** Small kicker above writer pre-check (often “Name · phase”). */
  writerPrecheckKicker: string;
  /** Breadcrumb-style line: “{eyebrow} · {trace}”. */
  traceBreadcrumbLabel: string;
  /** Back link to `/special-projects/openclaw` from run/analyze flows. */
  traceOverviewBackLabel: string;
  /** Back link from run export page including “worlds”. */
  traceOverviewWorldsBackLabel: string;
  /** Inline link text to the trace overview page (no leading arrow). */
  traceOverviewLinkText: string;
  /** Back link from a child special-project page to the hub. */
  projectsHubBackLabel: string;
  /** Transcript failure tool title (hub + panel). */
  transcriptFailureDisplayName: string;
  /** Hub card body for transcript failure tool. */
  transcriptFailureHubDescription: string;
};

function pick(key: string, fallback: string): string {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

export function getSpecialProjectUiLabels(): SpecialProjectUiLabels {
  const projectsEyebrowLabel = pick(
    "NEXT_PUBLIC_SPECIAL_PROJECTS_EYEBROW_LABEL",
    "Tools & exports",
  );
  const projectsPageTitle = pick(
    "NEXT_PUBLIC_SPECIAL_PROJECTS_PAGE_TITLE",
    "Tools & exports",
  );
  const traceProjectDisplayName = pick(
    "NEXT_PUBLIC_TRACE_PROJECT_DISPLAY_NAME",
    "Trace exports",
  );

  const writerPrecheckKicker = pick(
    "NEXT_PUBLIC_WRITER_PRECHECK_KICKER",
    `${traceProjectDisplayName} · pre-recording`,
  );

  return {
    projectsNavLabel: pick(
      "NEXT_PUBLIC_SPECIAL_PROJECTS_NAV_LABEL",
      projectsPageTitle,
    ),
    projectsEyebrowLabel,
    projectsPageTitle,
    projectsPageSubtitle: pick(
      "NEXT_PUBLIC_SPECIAL_PROJECTS_PAGE_SUBTITLE",
      "Long-running retrieval and analysis workflows beside the core prompt library.",
    ),
    traceProjectDisplayName,
    traceProjectHubDescription: pick(
      "NEXT_PUBLIC_TRACE_PROJECT_HUB_DESCRIPTION",
      "Export task lists and workflow-step traces into JSON for local audit and tooling.",
    ),
    writerPrecheckKicker,
    traceBreadcrumbLabel: pick(
      "NEXT_PUBLIC_TRACE_BREADCRUMB_LABEL",
      `${projectsEyebrowLabel} · ${traceProjectDisplayName}`,
    ),
    traceOverviewBackLabel: pick(
      "NEXT_PUBLIC_TRACE_OVERVIEW_BACK_LABEL",
      `← ${traceProjectDisplayName} overview`,
    ),
    traceOverviewWorldsBackLabel: pick(
      "NEXT_PUBLIC_TRACE_OVERVIEW_WORLDS_BACK_LABEL",
      `← ${traceProjectDisplayName} overview & worlds`,
    ),
    traceOverviewLinkText: pick(
      "NEXT_PUBLIC_TRACE_OVERVIEW_LINK_TEXT",
      `${traceProjectDisplayName} overview`,
    ),
    projectsHubBackLabel: pick(
      "NEXT_PUBLIC_SPECIAL_PROJECTS_HUB_BACK_LABEL",
      `← All ${projectsEyebrowLabel}`,
    ),
    transcriptFailureDisplayName: pick(
      "NEXT_PUBLIC_TRANSCRIPT_FAILURE_DISPLAY_NAME",
      "Transcript failure reports",
    ),
    transcriptFailureHubDescription: pick(
      "NEXT_PUBLIC_TRANSCRIPT_FAILURE_HUB_DESCRIPTION",
      "Build per-task Markdown reports from agent run transcripts under",
    ),
  };
}
