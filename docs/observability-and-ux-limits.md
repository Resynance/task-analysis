# Observability, logging, and UI limits at scale

## Observability (non-local deployments)

The stack does not ship a centralized logging or error-reporting product. For **staging and production**:

- Emit **structured logs** (JSON lines) from server routes and background jobs so aggregators (Datadog, Cloud Logging, etc.) can search by `route`, `userId` (if applicable), `durationMs`, and `error.code`.
- Optionally add **Sentry** (or similar) for uncaught exceptions and failed LLM/export paths, with sampling and PII scrubbing.
- Optionally add **OpenTelemetry** traces for multi-step flows (ingest, special-project pipelines) if latency diagnosis becomes important.

Keep documentation and dashboards free of secret values; log **env variable names**, not values.

## Large dashboards and Markdown-heavy views

As datasets grow, unbounded lists and full-document Markdown can slow the browser.

Mitigations to consider over time (document here when implemented):

- **Pagination** or cursors for long tables (metrics, library views).
- **Virtualization** for very long lists.
- **Data caps** or summarization for export previews and report viewers.

Until then, treat very large imports as a performance test case and profile the relevant routes and client components.
