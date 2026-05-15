"use client";

import type { ReactElement } from "react";

type UserTaskAuthenticityRunReviewProps = {
  hasLlmReview: boolean;
  running: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onRun: () => void;
};

function getRunReviewLabel({
  hasLlmReview,
  running,
}: Pick<UserTaskAuthenticityRunReviewProps, "hasLlmReview" | "running">): string {
  if (running) return "Running LLM review...";
  if (hasLlmReview) return "Run 3-model review again";
  return "Run 3-model review";
}

export function UserTaskAuthenticityRunReview({
  hasLlmReview,
  running,
  disabled = false,
  disabledReason = null,
  onRun,
}: UserTaskAuthenticityRunReviewProps): ReactElement {
  const isDisabled = running || disabled;

  return (
    <div className="min-w-56">
      <button
        type="button"
        disabled={isDisabled}
        onClick={onRun}
        className="group relative overflow-hidden rounded-xl border border-amber-700/80 bg-amber-900/25 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-900/40 disabled:cursor-wait disabled:border-fuchsia-700/60 disabled:bg-fuchsia-950/30 disabled:text-fuchsia-100"
      >
        <span className="relative z-10">
          {getRunReviewLabel({ hasLlmReview, running })}
        </span>
        {running ? (
          <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-fuchsia-950">
            <span className="block h-full w-1/2 animate-[pulse_1.1s_ease-in-out_infinite] bg-fuchsia-300" />
          </span>
        ) : null}
      </button>
      {running ? (
        <p className="mt-2 text-xs text-fuchsia-100/60" aria-live="polite">
          Running three models in small batches. This may take a minute.
        </p>
      ) : disabledReason ? (
        <p className="mt-2 text-xs text-amber-200/70" aria-live="polite">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
