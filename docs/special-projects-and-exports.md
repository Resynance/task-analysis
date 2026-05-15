# Special projects & exports

Display titles for this area are configurable via **`NEXT_PUBLIC_*`** environment variables (see `lib/special-project-labels.ts` and `.env.example`). **On-disk folder roots** for the same flows are configurable via **`TASK_ANALYSIS_*`** (see `lib/repo-paths.ts`). Defaults match this repo’s layout; HTTP routes such as `/special-projects/openclaw` stay fixed.

**Local `projects/`:** A fresh clone only has **`projects/.gitkeep`**; the real trees are **gitignored** and you create them locally. See **[Configuration & data → Special projects directory layout](./configuration-and-data.md#special-projects-directory-layout)** for the exact default folders, script filenames, and transcript/report layout to populate before the OpenClaw and PM failure-analysis flows can run against disk.

**Special projects** are long-running or disk-backed workflows that sit beside the core SQLite library. Entry hub: `app/special-projects/page.tsx`, routes under `app/special-projects/*`, APIs under `app/api/special-projects/`.

## Trace export integration (`/special-projects/openclaw`)

**Purpose:** Operator UI to run Python exporters **from** `projects/openclaw/trace-exports/` on your machine (task lists, workflow steps; that tree is gitignored in the public repo), stream logs to the browser, and optionally run workflow **audit** scripts that write Markdown reports under `reports/`.

**Paths:** `lib/openclaw-trace-exports.ts` centralizes repo-relative directories. Stream types: `lib/openclaw-export-stream.ts`, `lib/openclaw-analysis-stream.ts`. Audit file I/O: `lib/openclaw-audit-report-read.ts`.

**Saved worlds:** `OpenclawWorld` in Prisma stores named persona/world text used as optional context for audits and pre-check (`prisma/schema.prisma`).

**Do not commit** large secrets, HAR files, or private exports; see [Configuration & data](./configuration-and-data.md) and `npm run check:push-data`.

### Writer draft pre-check (`/special-projects/openclaw/writer-precheck`)

**Purpose:** Upload a **CSV** of draft prompts (and optional rubric/notes/ids). For each row, the app scores the prompt against a selected **guideline**, optionally with **user story** context from a saved world or pasted text. Results stream as **NDJSON**; the client can export CSV or print HTML to PDF.

**Code:** `app/api/special-projects/openclaw/writer-precheck/route.ts`, `components/openclaw-writer-precheck-panel.tsx`, `lib/openclaw-writer-precheck-csv.ts`, `lib/openclaw-writer-precheck-pdf.ts`, `lib/openclaw-writer-precheck-prior-audit.ts`, shared scoring in `lib/analyze-prompt.ts`.

**Prior workflow audit column:** When matching `task_*.md` audit files exist on disk (by task id or prompt prefix), the API attaches a short prior verdict — see comments in `lib/openclaw-writer-precheck-prior-audit.ts` for matching limits (prefix length, etc.).

## PM GPT failure analysis (`/special-projects/pmgpt-failure-analysis`)

**Purpose:** Build per-task (and overview) **Markdown reports** from run transcripts stored under `projects/pm/gpt-failure analysis/` — structured LLM narrative with deterministic fact extraction where implemented.

**Code:** `lib/pmgpt-failure-analysis.ts`, `lib/pmgpt-transcript-facts.ts`, APIs under `app/api/special-projects/pmgpt-failure-analysis/`, UI `components/pmgpt-failure-analysis-panel.tsx`.

**Note:** Report templates and system prompts are long-lived **product logic** in code; edit them deliberately and keep examples synthetic when adjusting copy for a public fork.

## Recent onboard task quality (`/special-projects/recent-onboards`)

**Purpose:** Review recent onboard task authorship and prompt quality from a local CSV of emails. The CSV defaults to `projects/recent-onboards/onboards.csv` (or `TASK_ANALYSIS_RECENT_ONBOARDS_CSV`) and stays gitignored with the rest of `projects/`.

**Data flow:** The page parses the email CSV, maps emails to imported user ids from `users/users.json`, then matches authored prompts via `Prompt.extra.created_by`. It summarizes authored task volume, scored / pending counts, quality tiers, poor-rate, project spread, environment spread, and unmatched emails.

**Code:** `app/special-projects/recent-onboards/page.tsx`, analysis in `lib/recent-onboards-analysis.ts`, path resolution in `lib/repo-paths.ts`, and email/id lookup in `lib/users-lookup.ts`.
