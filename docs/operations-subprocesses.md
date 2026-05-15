# Special projects: subprocesses, streaming, and safety notes

Several **special project** and export flows run **Node subprocesses** (Python scripts, bundled tooling) and may stream **NDJSON** or large text over HTTP. This page is a short design note for maintainers and security review; it does not replace reading the route handlers.

## Where this applies

- OpenClaw trace exports, writer pre-check, audit reports, and related APIs under `app/api/special-projects/openclaw/`.
- PM GPT failure analysis generation and export routes under `app/api/special-projects/pmgpt-failure-analysis/`.
- Other long-running tools that shell out or stream progress (search for `spawn`, `execFile`, NDJSON, or `maxDuration` in `app/api/special-projects/`).

## Practices to preserve

1. **Timeouts** — Prefer bounded waits for child processes and upstream HTTP (Next route `maxDuration` is set on several ingest/analysis routes; align subprocess timeouts with that budget where applicable).
2. **Request body size** — Large JSON payloads (e.g. HAR snippets, transcript excerpts) should stay within Next/Node limits; validate size before writing to disk or passing to subprocesses.
3. **Path validation** — User- or query-supplied paths (including **`harPath`**-style parameters) must be validated against directory allowlists and must reject `..`, absolute paths outside intended roots, and unexpected schemes. Repo defaults live in `lib/repo-paths.ts` and related helpers.
4. **Resource limits** — Streaming NDJSON progress lines should not grow unbounded in memory; prefer incremental parsing and backpressure where possible.
5. **Secrets** — Never log raw tokens or full HAR contents; use env names only in logs and documentation.

## Related

- [Configuration & data](./configuration-and-data.md) — directory layout and `TASK_ANALYSIS_*` env vars.
- [Special projects & exports](./special-projects-and-exports.md) — feature-level behavior.
