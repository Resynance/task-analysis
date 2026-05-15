# Architecture

## Stack

- **Framework:** [Next.js](https://nextjs.org) App Router (`app/`), React 19, Server Components for data-heavy pages.
- **Database:** SQLite via [Prisma](https://www.prisma.io) (`prisma/schema.prisma`, generated client under `generated/prisma/`).
- **LLM calls:** OpenAI-compatible clients created in `lib/llm.ts` from `lib/llm-config.ts` — either **OpenRouter** (hosted models) or **LM Studio** (local OpenAI-compatible server). Defaults come from `lib/env.ts`; overrides can be stored in `LlmSettings` (see schema).

## High-level data flow

1. **Imports** — JSON and CSV pipelines under `lib/dataset/` and `app/api/prompts/ingest` populate `Prompt` and `Feedback` rows (and related metadata in `extra` JSON).
2. **Rubric storage** — `Guideline` records hold the text rubrics used for scoring.
3. **Analysis** — API routes under `app/api/prompts/`, `app/api/feedback/`, and related paths invoke `lib/analyze-prompt.ts`, `lib/analyze-feedback.ts`, or specialized analyzers; results write `score`, `rationale`, `analyzedAt`.
4. **Derived reports** — Coaching insights, pruned-task themes, combined writer reports, etc. are persisted in dedicated models (`CoachingInsight`, `PrunedTaskAnalysis`, …) or generated on demand from SQLite.

## Important directories

| Path | Role |
|------|------|
| `app/` | Routes, layouts, server page composition |
| `app/api/` | JSON and streaming (NDJSON) HTTP handlers |
| `components/` | Client and shared UI; large dashboards live here |
| `lib/` | Domain logic, parsers, LLM prompts, metrics aggregation |
| `lib/dataset/` | CSV/JSON import helpers |
| `projects/` | Optional on-disk inputs/outputs for **special projects**; roots are configurable via `lib/repo-paths.ts`. Treat as local-only or sanitized for public git — see [Configuration & data](./configuration-and-data.md) |
| `prisma/` | Schema and migrations / `db push` workflow |

## Streaming responses

Several flows return **newline-delimited JSON** (`application/x-ndjson` or `text/x-ndjson`) so the browser can render progress row-by-row. Event type definitions live next to the feature (for example `lib/batch-analyze-stream.ts`, `lib/openclaw-analysis-stream.ts`).

## Auth

This codebase is oriented toward a **trusted operator** deployment (no built-in end-user auth layer in the paths reviewed for this doc). If you expose the app publicly, add authentication and network controls at the deployment boundary.
