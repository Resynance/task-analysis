# Configuration & data

## Environment variables

Names and defaults are listed in **`.env.example`** at the repo root. Runtime resolution is implemented in `lib/env.ts` (database URL, default LLM provider, OpenRouter vs **hosted OpenAI-compatible** vs LM Studio URLs/models/keys). Optional OpenRouter attribution headers for provider dashboards are read via `LlmSettings` / `lib/llm-config.ts`.

### OpenRouter usage audit

Each successful in-app **OpenRouter** chat completion (via `chatCompletionCreateAudited` in **`lib/llm.ts`**) appends one row to **`OpenRouterApiAuditLog`** in SQLite: time, caller **`source`** label, model id, token counts, and **`usage.cost`** in USD when OpenRouter includes it on the response. Review and paginate under **`/configuration/openrouter-audit`**. **LM Studio** completions are not logged.

### Special projects display names (public vs internal branding)

User-visible titles for `/special-projects` and related pages are resolved in **`lib/special-project-labels.ts`**. Defaults are **neutral** (for example “Tools & exports”, “Trace exports”, “Transcript failure reports”). To restore internal-style names locally, set the **`NEXT_PUBLIC_*`** variables documented in `.env.example` and restart the dev server (or rebuild for production). HTTP routes (for example `/special-projects/openclaw`) are **not** renamed by these variables—only labels change.

### Special projects directory layout

On-disk roots for trace exports and PM / transcript failure analysis are resolved in **`lib/repo-paths.ts`**. Optional environment variables:

- **`TASK_ANALYSIS_TRACE_EXPORTS_DIR`** — repo-relative directory containing trace scripts, `workflow-steps-by-task/`, `reports/`, etc. Default: `projects/openclaw/trace-exports`.
- **`TASK_ANALYSIS_PM_FAILURE_DIR`** — repo-relative root for `task_*` transcript folders and `reports/`. Default: `projects/pm/gpt-failure analysis`.
- **`TASK_ANALYSIS_RECENT_ONBOARDS_CSV`** — repo-relative CSV file containing recent onboard emails. Default: `projects/recent-onboards/onboards.csv`.
- **`TASK_ANALYSIS_USER_TASK_AUTHENTICITY_JSON`** — repo-relative JSON for the user task authenticity review. Default: `projects/user-task-authenticity/tasks.json`.

Use forward slashes; `..` and absolute paths are rejected (falls back to defaults). **`npm run check:push-data`** loads `TASK_ANALYSIS_*` from `.env` when present so custom trees are deny-listed the same way as the built-in paths.

**Never commit:** `.env`, API keys, JWTs, or HAR captures. Use local env files ignored by git (see `.gitignore`).

#### Fresh clone: empty `projects/`

In a **public clone**, git only tracks **`projects/.gitkeep`**. The rest of `projects/` is intentionally **empty and gitignored** so local exports, scripts, and folder names never enter the remote history.

- The app does **not** scaffold these trees at startup; paths are joined from the repo root (`process.cwd()`). Until you create the directories below (or set **`TASK_ANALYSIS_*`** to other repo-relative folders you create), disk-backed special-project UIs will see **missing scripts or empty directories** — that is expected until you populate them.

#### What to add locally for disk-backed special projects

Use the **defaults** below unless you override with **`TASK_ANALYSIS_TRACE_EXPORTS_DIR`** / **`TASK_ANALYSIS_PM_FAILURE_DIR`**. Script basenames match **`lib/openclaw-trace-exports.ts`**.

1. **OpenClaw trace exports** (`/special-projects/openclaw`) — default root **`projects/openclaw/trace-exports/`**
   - Python scripts the UI invokes: **`export_openclaw_production_tasks.py`**, **`export_openclaw_task_workflow_steps.py`**, **`audit_trace_workflow_steps.py`**.
   - **`workflow-steps-by-task/`** — per-task workflow JSON produced by the step exporter.
   - **`reports/`** — Markdown workflow audits (`task_*.md`, etc.) used by the trace overview and writer pre-check “prior audit” matching.
   - Optional: **`tasks_created_after_export.json`** at the trace-export root (task list export). Optional: **`openclaw_portal_defaults.json`** next to the scripts for Supabase/portal defaults (secrets belong only in local files or env — see API copy in `get-tasks` and `lib/openclaw-portal-defaults-file.ts`).
   - Task exports default to **all lifecycle states** (`any`). Narrow the lifecycle field only when you intentionally want a subset such as `staging,production`.

2. **PM GPT failure analysis** (`/special-projects/pmgpt-failure-analysis`) — default root **`projects/pm/gpt-failure analysis/`** (folder name includes a **space**, matching the default constant)
   - One subdirectory per task: **`task_<id>/`** containing transcript **`run*.json`** files (see **`lib/pmgpt-failure-analysis.ts`** and `isSafeTaskDirName`).
   - **`reports/`** under that root for generated **`task_*.md`** reports and **`pmgpt-failure-overview.md`**.

3. **Recent onboard task quality** (`/special-projects/recent-onboards`) — default CSV **`projects/recent-onboards/onboards.csv`**
   - Minimal CSV shape:
     ```csv
     email
     person@example.com
     other@example.com
     ```
   - The report maps each email through **`users/users.json`** to find the imported user id, then matches authored prompts via prompt metadata **`extra.created_by`**. If an email is not present in `users/users.json`, it appears as unmatched.
   - Header names such as **`email`** or **`email_address`** are accepted; without a recognized header, the first CSV column is treated as the email list.

4. **User task authenticity review** (`/special-projects/user-task-authenticity`) — default JSON **`projects/user-task-authenticity/tasks.json`**
   - Minimal JSON shape:
     ```json
     {
       "tasks": [
         { "id": "task_1", "prompt": "..." },
         { "id": "task_2", "prompt": "..." }
       ]
     }
     ```
   - A top-level array is also accepted. Text can live in **`prompt`**, **`body`**, **`text`**, **`task`**, **`content`**, **`instruction`**, **`user_prompt`**, or **`description`**.
   - The page analyzes every task with extractable prompt text, regardless of lifecycle or review status.
   - The page shows deterministic evidence immediately. LLM-assisted review runs only when requested from the UI, using three configured model IDs and a median consensus score. Optional AHT is provided in the UI for the run, not in the JSON; values may be numeric seconds, clock-style durations like **`1:30`**, or unit-based durations like **`2 min`**.

You may add **other** subtrees under `projects/` for your own workflows (for example additional Python exporters); they remain ignored by git as long as they stay under `projects/`. If you point **`TASK_ANALYSIS_*`** at paths **outside** `projects/`, maintain your own `.gitignore` rules and never commit secrets or customer data.

## App settings (SQLite)

The `LlmSettings` model (`id = "default"`) stores UI-editable LLM overrides. Resolution order is documented in `lib/llm-config.ts`.

## Guidelines

Manage rubric text in the Configuration area (`/configuration/guidelines`, implementation under `app/configuration/guidelines/`). Prompts reference `guidelineId` with `onDelete: Restrict` — delete or reassign prompts before removing a guideline.

## Data ingest

**UI:** `/configuration/ingest-data` (`app/configuration/ingest-data/page.tsx`).

**API:** `app/api/prompts/ingest/route.ts` and related import paths; parsers in `lib/dataset/import-prompts-json.ts`, `lib/dataset/import-feedback-csv.ts`, `lib/dataset/prompts-json.ts`, `lib/dataset/prompts-csv.ts`, `lib/dataset/feedback-csv.ts`, `lib/dataset/csv-rfc4180.ts`.

Imports populate `sourceId`, `sourceKey`, `projectKey`, `envKey`, and structured `extra` used across filters and flags.

## LLM status UI

Header badges (`components/llm-status-badge.tsx`, `components/openrouter-credits-badge.tsx`) reflect configuration and optional OpenRouter credits refresh (`lib/openrouter-credits*.ts`).

## Public repository hygiene

- **`projects/`** — The whole directory is **gitignored** (except `projects/.gitkeep` so the folder exists in a fresh clone). Put trace-export scripts, transcripts, audits, and any paths that must not appear in a public repo **only** under `projects/` locally. If anything under `projects/` was committed before this policy, run `git rm -r --cached projects/` (keeping `.gitkeep` if you re-add it), then commit.
- **`npm run check:push-data`** — `scripts/check-push-data.mjs` fails if any path under `projects/` is tracked, plus other deny rules (datasets, build dirs, etc.). It also treats paths under custom **`TASK_ANALYSIS_*`** roots from `.env` like tracked secrets if those roots sit outside `projects/`.
- **Sample / export JSON** elsewhere may still contain realistic-looking fixture text. For a public repo, prefer synthetic fixtures or truncated samples.
- If you set **`TASK_ANALYSIS_TRACE_EXPORTS_DIR`** or **`TASK_ANALYSIS_PM_FAILURE_DIR`** to directories **outside** `projects/`, add matching `.gitignore` rules for those folders so local data is not pushed by mistake.

## Prisma

```bash
npx prisma generate
npx prisma db push
```

Seeding (if used): `package.json` `db:seed` and `prisma/` seed configuration.
