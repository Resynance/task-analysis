# Analytics & LLM-backed reports

## Metrics (`/metrics`, `/metrics/prompts`, `/metrics/feedback`)

**Purpose:** Rolling-window **counts and distributions** (scores, authors, volumes) for prompts and feedback, with filters aligned to the library (environment, project, lifecycle where applicable).

**Computation:** `lib/metrics-compute.ts`, `lib/metrics-daily-series.ts`, `lib/metrics-scope.ts`, `lib/qa-rejection-metrics.ts`, `lib/qa-rejection-window.ts`.

**UI:** `app/metrics/page.tsx` and nested routes; shared widgets in `components/metrics-*.tsx`.

## Insights (`/insights`, `/reports/insights`)

**Purpose:** **Coaching insight** reports — LLM-generated summaries over scoped samples of scored prompts, cached per project + environment + guideline scope.

**Persistence:** `CoachingInsight` model; generation orchestrated from `lib/coaching-insights.ts`, `lib/coaching-insight-report.ts`, API routes under `app/api/insights/`.

**Stale flags:** `lib/insights-stale.ts` compares report timestamps to newer prompt analysis so the UI can prompt regeneration.

## Pruned analysis (`/reports/pruned-analysis`, `/pruned-analysis`)

**Purpose:** Thematic analysis over **pruned** tasks (tasks marked pruned in external status exports), with evidence prompts pulled from configured paths.

**Logic:** `lib/pruned-analysis.ts`, UI `components/pruned-analysis-panel.tsx`, API `app/api/pruned-analysis/`.

**Persistence:** `PrunedTaskAnalysis` model.

## Combined reports (`/reports/combined`)

**Purpose:** Merge multiple report sources (for example writer-facing bundles) into a single downloadable or viewable output.

**Entry:** `app/reports/combined/page.tsx`, `components/combined-reports-panel.tsx`, `app/api/reports/combined/run/route.ts`, `lib/combined-writer-report.ts`.

## Dataset QA (`/reports/dataset-qa`)

**Purpose:** Ask a **fixed operator question** against stratified samples of scored prompts (tier caps, filters), store LLM answers for review.

**Logic:** `lib/dataset-qa.ts`, `app/api/dataset-qa/route.ts`, UI `components/dataset-qa-panel.tsx`.

## Reports hub (`/reports`)

**Purpose:** Navigation shell for report sub-pages (`components/reports-subnav.tsx`, `app/reports/page.tsx`).

## Export prompts (`/api/prompts/export`)

**Purpose:** Server-side CSV generation for the current library slice — `app/api/prompts/export/route.ts`, `lib/csv-export.ts`.
