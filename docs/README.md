# Task Analysis — documentation

These pages describe **what the application does** and where behavior lives in the repo. They follow the same rules as in-code documentation:

- **Purpose first** — what a feature is for, who consumes it (UI vs API vs scripts), and how data flows.
- **Pointers, not duplication** — file and route paths so you can read the source of truth.
- **Public-safe wording** — no customer-specific scenarios, internal codenames as proprietary claims, or operational secrets. Use env variable **names** only, never example keys.

## Contents

| Document | Scope |
|----------|--------|
| [Architecture](./architecture.md) | Stack, storage, LLM wiring, repo layout |
| [Core workflows](./core-workflows.md) | Prompt library, feedback, users, mentorship, flags |
| [Analytics & reports](./analytics-and-llm-reports.md) | Metrics dashboards, coaching insights, pruned analysis, combined reports, dataset QA |
| [Special projects & exports](./special-projects-and-exports.md) | Trace-export tooling, writer pre-check, transcript-based failure reports |
| [Configuration & data](./configuration-and-data.md) | Guidelines, ingest, LLM settings, env vars, OpenRouter audit log, **empty `projects/` in clone and what to add locally** for special projects, public-repo hygiene |

## Contributing to docs

When you add or change a feature, update the relevant section here in the same PR when the behavior is user-visible or cross-cutting. Prefer one accurate paragraph over a long runbook.
