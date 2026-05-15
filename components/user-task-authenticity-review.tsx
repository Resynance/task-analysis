"use client";

import { useMemo, useState, type ReactElement } from "react";
import { UserTaskAuthenticityPdfExport } from "@/components/user-task-authenticity-pdf-export";
import { UserTaskAuthenticityRunReview } from "@/components/user-task-authenticity-run-review";
import type {
  UserTaskAuthenticityAnalysis,
  UserTaskAuthenticityTaskResult,
} from "@/lib/user-task-authenticity-analysis";

const HIGH_PROBABILITY_SCORE = 70;
const MEDIUM_PROBABILITY_SCORE = 40;

type RiskLevel = "low" | "medium" | "high";

type UserTaskAuthenticityReviewProps = {
  initialAnalysis: UserTaskAuthenticityAnalysis;
  defaultModels: [string, string, string];
};

type TaskReviewProps = {
  task: UserTaskAuthenticityTaskResult;
};

type AhtFeasibilityNoteProps = {
  label: string;
  feasibility: NonNullable<UserTaskAuthenticityTaskResult["llm"]>["aht_feasibility"];
  rationale: string;
};

function riskClass(risk: RiskLevel): string {
  if (risk === "high") return "border-rose-800/80 bg-rose-950/40 text-rose-100";
  if (risk === "medium") return "border-amber-800/80 bg-amber-950/35 text-amber-100";
  return "border-emerald-800/70 bg-emerald-950/25 text-emerald-100";
}

function signalClass(kind: string): string {
  if (kind === "ai_generated") return "border-fuchsia-900/70 text-fuchsia-200";
  if (kind === "translated") return "border-sky-900/70 text-sky-200";
  if (kind === "similar") return "border-orange-900/70 text-orange-200";
  return "border-zinc-700 text-zinc-300";
}

function scoreText(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n)}`;
}

function ahtText(task: UserTaskAuthenticityTaskResult): string | null {
  if (!task.aht) return null;
  return task.aht.seconds == null
    ? task.aht.raw
    : `${task.aht.raw} (${Math.round(task.aht.seconds)}s)`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function apiErrorMessage(body: unknown): string | null {
  const record = asRecord(body);
  if (!record) return null;

  const error = record.error;
  const errorRecord = asRecord(error);
  const firstIssue = Array.isArray(record.issues) ? asRecord(record.issues[0]) : null;

  return (
    nonEmptyString(error) ??
    nonEmptyString(errorRecord?.message) ??
    nonEmptyString(record.message) ??
    nonEmptyString(firstIssue?.message)
  );
}

function aiGeneratedScore(task: UserTaskAuthenticityTaskResult): number {
  if (task.llm) return task.llm.ai_generated;
  return task.signals.find((signal) => signal.kind === "ai_generated")?.score ?? 0;
}

function modelLabel(index: number): string {
  return `Model ${String.fromCharCode(65 + index)}`;
}

function ahtFeasibilityText(
  feasibility: AhtFeasibilityNoteProps["feasibility"],
  rationale: string,
): string | null {
  const trimmedRationale = rationale.trim();
  if (feasibility === "unknown" && !trimmedRationale) return null;
  return trimmedRationale ? `${feasibility} - ${trimmedRationale}` : feasibility;
}

function AhtFeasibilityNote({
  label,
  feasibility,
  rationale,
}: AhtFeasibilityNoteProps): ReactElement | null {
  const text = ahtFeasibilityText(feasibility, rationale);
  if (!text) return null;
  return <p className="mt-2 text-xs text-sky-200/70">{label}: {text}</p>;
}

function riskFromScore(score: number): RiskLevel {
  if (score >= HIGH_PROBABILITY_SCORE) return "high";
  if (score >= MEDIUM_PROBABILITY_SCORE) return "medium";
  return "low";
}

function getModelValidationError(models: string[]): string | null {
  if (models.some((model) => !model)) return "Enter three model IDs.";
  if (new Set(models).size !== 3) return "Use three different model IDs.";
  return null;
}

function ModelReviewDetails({ task }: TaskReviewProps): ReactElement | null {
  if (!task.llm) return null;
  return (
    <div className="mt-3 grid gap-2 lg:grid-cols-4">
      <div className="rounded-lg border border-fuchsia-950/70 bg-fuchsia-950/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-300/60">
          Consensus score
        </p>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-lg text-fuchsia-100">
          {scoreText(task.llm.ai_generated)}
        </p>
      </div>
      {task.llmReviews.map((review) => (
        <div
          key={`${review.modelIndex}-${review.model}`}
          className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
            {modelLabel(review.modelIndex)}
          </p>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-lg text-zinc-100">
            {scoreText(review.ai_generated)}
          </p>
          <p className="mt-1 truncate text-[11px] text-zinc-500" title={review.model}>
            {review.model}
          </p>
        </div>
      ))}
    </div>
  );
}

function ModelNarratives({ task }: TaskReviewProps): ReactElement | null {
  if (task.llmReviews.length === 0) return null;

  return (
    <details className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <summary className="cursor-pointer text-sm font-medium text-zinc-200">
        Model-by-model details
      </summary>
      <div className="mt-3 grid gap-3">
        {task.llmReviews.map((review) => (
          <div
            key={`${review.modelIndex}-${review.model}-detail`}
            className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                {modelLabel(review.modelIndex)}
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xs text-zinc-500">
                {review.model}
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xs text-fuchsia-200/80">
                score {scoreText(review.ai_generated)}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-300">{review.rationale}</p>
            <AhtFeasibilityNote
              label="AHT feasibility"
              feasibility={review.aht_feasibility}
              rationale={review.aht_rationale}
            />
            {review.ai_generated_rationale ? (
              <p className="mt-2 text-xs text-zinc-500">
                {review.ai_generated_rationale}
              </p>
            ) : null}
            {review.ai_generated_evidence.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-500">
                {review.ai_generated_evidence.map((evidence) => (
                  <li key={`${review.modelIndex}-${evidence}`}>{evidence}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function AiGeneratedDetails({ task }: TaskReviewProps): ReactElement | null {
  const deterministic = task.signals.filter((signal) => signal.kind === "ai_generated");
  const deterministicEvidence = deterministic.flatMap((signal) => signal.evidence);
  const llmEvidence = task.llm?.ai_generated_evidence ?? [];
  const aiScore = task.llm?.ai_generated ?? deterministic[0]?.score ?? 0;
  const rationale = task.llm?.ai_generated_rationale?.trim();

  if (!rationale && deterministicEvidence.length === 0 && llmEvidence.length === 0) {
    return null;
  }

  return (
    <details className="mt-3 rounded-xl border border-fuchsia-950/70 bg-fuchsia-950/10 p-3">
      <summary className="cursor-pointer text-sm font-medium text-fuchsia-100/90">
        Why AI-generated?{" "}
        <span className="font-[family-name:var(--font-mono)] text-xs text-fuchsia-200/70">
          score {scoreText(aiScore)}
        </span>
      </summary>
      {rationale ? (
        <p className="mt-3 text-sm leading-relaxed text-fuchsia-100/80">
          {rationale}
        </p>
      ) : null}
      {deterministicEvidence.length > 0 || llmEvidence.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-fuchsia-100/65">
          {deterministicEvidence.map((evidence) => (
            <li key={`det-${evidence}`}>Heuristic: {evidence}</li>
          ))}
          {llmEvidence.map((evidence) => (
            <li key={`llm-${evidence}`}>LLM: {evidence}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function UserTaskAuthenticityReview({
  initialAnalysis,
  defaultModels,
}: UserTaskAuthenticityReviewProps): ReactElement {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [models, setModels] = useState<[string, string, string]>(defaultModels);
  const [aht, setAht] = useState("");

  const sortedTasks = useMemo(
    () =>
      analysis.tasks
        .slice()
        .sort(
          (a, b) =>
            aiGeneratedScore(b) - aiGeneratedScore(a) || a.id.localeCompare(b.id),
        ),
    [analysis.tasks],
  );
  const aiGeneratedHighProbabilityCount = sortedTasks.filter(
    (task) => aiGeneratedScore(task) >= HIGH_PROBABILITY_SCORE,
  ).length;
  const hasLlmReview = analysis.summary.withLlm > 0 || analysis.llmModel != null;
  const normalizedModels = models.map((model) => model.trim());
  const modelValidationError = getModelValidationError(normalizedModels);
  const pdfReport = {
    generatedAtIso: new Date().toISOString(),
    summary: {
      total: analysis.summary.total,
      highProbabilityScore: HIGH_PROBABILITY_SCORE,
      aiGeneratedHighProbabilityCount,
      llmSummary: analysis.summary.llmSummary,
    },
    tasks: sortedTasks,
  };

  async function runLlmReview(): Promise<void> {
    if (modelValidationError) {
      setRunError(modelValidationError);
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const response = await fetch(
        "/api/special-projects/user-task-authenticity/run-llm",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            models: normalizedModels,
            aht: aht.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown;
        const message =
          apiErrorMessage(body) ?? `LLM review request failed (${response.status})`;
        throw new Error(message);
      }
      const nextAnalysis = (await response.json()) as UserTaskAuthenticityAnalysis;
      setAnalysis(nextAnalysis);
      setRunError(nextAnalysis.llmError);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "LLM review failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <section className="max-w-xl rounded-2xl border border-fuchsia-900/50 bg-fuchsia-950/15 p-5 text-fuchsia-100">
        <p className="text-xs uppercase tracking-[0.18em] text-fuchsia-300/60">
          High-probability AI generation
        </p>
        <p className="mt-2 text-3xl font-semibold">
          {aiGeneratedHighProbabilityCount}
        </p>
        <p className="mt-1 text-xs text-fuchsia-100/55">
          AI-generated score &gt;= {HIGH_PROBABILITY_SCORE} across{" "}
          {analysis.summary.total} task
          {analysis.summary.total === 1 ? "" : "s"}.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">LLM-assisted review</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Deterministic evidence is always shown. Configure three models and run the
              review manually to score from consensus.
            </p>
            {analysis.llmModels.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                {analysis.llmModels.map((model, index) => (
                  <span
                    key={`${index}-${model}`}
                    className="rounded-full border border-zinc-800 px-2 py-0.5"
                  >
                    {modelLabel(index)}: <code className="text-zinc-300">{model}</code>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <UserTaskAuthenticityPdfExport report={pdfReport} />
            <UserTaskAuthenticityRunReview
              hasLlmReview={hasLlmReview}
              running={running}
              disabled={modelValidationError != null}
              disabledReason={modelValidationError}
              onRun={() => void runLlmReview()}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {models.map((model, index) => (
            <label key={index} className="block text-xs text-zinc-500">
              {modelLabel(index)}
              <input
                value={model}
                onChange={(event) => {
                  const next = [...models] as [string, string, string];
                  next[index] = event.target.value;
                  setModels(next);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-zinc-200 outline-none transition focus:border-fuchsia-800"
                placeholder="provider/model-id"
              />
            </label>
          ))}
        </div>
        <label className="mt-4 block max-w-sm text-xs text-zinc-500">
          AHT (optional)
          <input
            value={aht}
            onChange={(event) => setAht(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-zinc-200 outline-none transition focus:border-sky-800"
            placeholder="e.g. 8 min, 90s, 12:30"
          />
          <span className="mt-1 block text-[11px] text-zinc-600">
            Applied to every task in this review run.
          </span>
        </label>
        {runError || analysis.llmError ? (
          <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            LLM review failed: {runError ?? analysis.llmError}
          </p>
        ) : null}
        {analysis.llmSkippedTaskCount > 0 ? (
          <p className="mt-4 text-xs text-zinc-500">
            LLM review is capped at {analysis.llmTaskLimit} tasks;{" "}
            {analysis.llmSkippedTaskCount} additional task
            {analysis.llmSkippedTaskCount === 1 ? "" : "s"} were not sent.
          </p>
        ) : null}
        {analysis.summary.llmSummary ? (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            <p className="text-sm font-medium text-zinc-100">
              AI generation:{" "}
              <span
                className={`rounded-full border px-2 py-0.5 text-xs uppercase ${riskClass(
                  analysis.summary.llmSummary.overall_risk,
                )}`}
              >
                {analysis.summary.llmSummary.overall_risk}
              </span>
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {analysis.summary.llmSummary.rationale}
            </p>
            {analysis.summary.llmSummary.recommendations.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-400">
                {analysis.summary.llmSummary.recommendations.map((rec) => (
                  <li key={rec}>{rec}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-4 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          Task evidence
        </h2>
        {sortedTasks.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-5 py-12 text-center text-zinc-500">
            No tasks to analyze yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {sortedTasks.map((task) => {
              const aiScore = aiGeneratedScore(task);
              const aiRisk = riskFromScore(aiScore);
              const aht = ahtText(task);
              const aiSignals = task.signals.filter(
                (signal) => signal.kind === "ai_generated",
              );

              return (
                <li
                  key={`${task.id}-${task.sourceIndex}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-3 py-0.5 text-xs uppercase ${riskClass(
                        aiRisk,
                      )}`}
                    >
                      {aiRisk}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-xs text-zinc-500">
                      {task.id}
                    </span>
                    <span className="rounded-full border border-fuchsia-950/70 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-fuchsia-200/80">
                      AI score {aiScore}
                    </span>
                    {aht ? (
                      <span className="rounded-full border border-sky-950/70 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-sky-200/80">
                        AHT {aht}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-black/20 p-3">
                    <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                      Full prompt
                    </p>
                    <pre className="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950/70 p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-zinc-300">
                      {task.text}
                    </pre>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {aiSignals.map((signal) => (
                      <span
                        key={`${signal.kind}-${signal.label}`}
                        className={`rounded-full border px-2 py-1 text-xs ${signalClass(
                          signal.kind,
                        )}`}
                      >
                        {signal.label}: {signal.score}
                      </span>
                    ))}
                  </div>

                  {aiSignals.some((signal) => signal.evidence.length > 0) ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-500">
                      {aiSignals.flatMap((signal) =>
                        signal.evidence.map((evidence) => (
                          <li key={`${signal.kind}-${evidence}`}>{evidence}</li>
                        )),
                      )}
                    </ul>
                  ) : null}

                  <ModelReviewDetails task={task} />
                  <AiGeneratedDetails task={task} />
                  <ModelNarratives task={task} />
                  {task.llm ? (
                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                      <p className="text-sm text-zinc-300">{task.llm.rationale}</p>
                      <AhtFeasibilityNote
                        label="Consensus AHT feasibility"
                        feasibility={task.llm.aht_feasibility}
                        rationale={task.llm.aht_rationale}
                      />
                      {task.llm.evidence.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-500">
                          {task.llm.evidence.map((evidence) => (
                            <li key={evidence}>{evidence}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
