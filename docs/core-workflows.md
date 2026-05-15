# Core workflows

## Prompt library (`/`)

**Purpose:** Browse and filter imported **prompts** (training task text), tied to a **guideline** (rubric), with optional LLM score and rationale.

**UI:** `app/page.tsx` composes `components/prompt-dashboard.tsx`.

**Behavior:**

- Query params drive sorting, pagination, environment and project filters, guideline multi-select, author search, body search, and optional grouping by user. Parsing helpers live in `lib/prompt-library-page.ts`, `lib/sort-prompts.ts`, `lib/library-pagination.ts`, `lib/guideline-query.ts`, `lib/task-environment.ts`, `lib/task-project.ts`, `lib/task-lifecycle-filter.ts`, `lib/explore/filter-by-user.ts`, `lib/prompt-body-search.ts`.
- **Guideline scope** — some imports are tagged as “dataset” tasks; `lib/guideline-scope.ts` hides or scopes certain guidelines in the toolbar so operators do not score the wrong corpus.

**Per-prompt actions:** Single-row analyze and “clarify” Q&A live under `app/api/prompts/[id]/analyze`, `app/api/prompts/[id]/clarify`, with logic in `lib/analyze-prompt.ts` and `lib/prompt-analysis-clarify.ts` / `lib/prompt-analysis-clarification.ts`.

## Feedback (`/feedback`)

**Purpose:** Review imported **feedback** rows (often paired with tasks), apply the same style of LLM scoring where configured, and navigate by project/environment like prompts.

**UI:** `app/feedback/page.tsx`, dashboard components under `components/feedback-dashboard.tsx` (and related).

**API:** Batch and single analyze routes under `app/api/feedback/`. Scoring logic: `lib/analyze-feedback.ts`.

**QA outcome signals:** Approved vs rejected heuristics from CSV `extra` fields are centralized in `lib/feedback-qa-outcome.ts`.

## Users (`/users`, `/users/[userKey]`)

**Purpose:** Aggregate prompts and feedback by a **stable author key** derived from import metadata (`id:…`, `email:…`, `name:…`).

**Logic:** `lib/users-directory.ts`, `lib/users-lookup.ts`, `lib/explore/creator-from-extra.ts`.

**User detail:** Per-user coaching generation and display — `app/users/[userKey]/page.tsx`, `components/user-coaching-panel.tsx`, `lib/user-coaching-analysis.ts`, API under `app/api/users/coaching/`.

## Mentorship (`/mentorship`)

**Purpose:** Define **pods** (groups) with mentor/mentee membership for organizational tracking; metrics views per pod.

**Data:** `MentorshipPod`, `PodMembership` in `prisma/schema.prisma`. Server actions: `app/mentorship/actions.ts`.

## Flags (`/flags`)

**Purpose:** Operator-facing **flags** derived from prompt `extra` / policy helpers (`lib/user-flags.ts`, `components/flags-dashboard.tsx`). Used to surface rows that need attention without changing core list filters.

## Guidelines (`/guidelines`)

**Purpose:** CRUD-style management of rubric text stored in `Guideline` (see configuration doc for edit paths).

## Related API (batch jobs)

- **Analyze pending prompts:** `app/api/prompts/analyze-pending/route.ts` — streams events typed in `lib/batch-analyze-stream.ts`.
- **Analyze pending feedback:** `app/api/feedback/analyze-pending/route.ts` — same stream shape for feedback rows.
