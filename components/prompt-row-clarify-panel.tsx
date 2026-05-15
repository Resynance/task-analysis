"use client";

import { useCallback, useEffect, useState } from "react";
import type { PromptAnalysisClarification } from "@/lib/prompt-analysis-clarification";
import { requestOpenRouterCreditsRefresh } from "@/lib/openrouter-credits-refresh";

export function PromptRowClarifyPanel(props: {
  promptId: string;
  rationale: string | null;
  analysisClarification: PromptAnalysisClarification | null | undefined;
  disabled: boolean;
  onAfterClarify: () => void;
}) {
  const {
    promptId,
    rationale,
    analysisClarification,
    disabled,
    onAfterClarify,
  } = props;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PromptAnalysisClarification | null>(
    analysisClarification ?? null,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync clarification from refreshed row props
    setSaved(analysisClarification ?? null);
  }, [analysisClarification]);

  const canAsk = Boolean(rationale?.trim());

  const submit = useCallback(async () => {
    const q = question.trim();
    if (!q || !canAsk) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${promptId}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as {
        error?: string;
        clarification?: PromptAnalysisClarification;
      };
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (data.clarification) {
        setSaved(data.clarification);
        setQuestion("");
        requestOpenRouterCreditsRefresh();
        onAfterClarify();
      } else {
        setError("Unexpected response from server.");
      }
    } catch {
      setError("Network error while requesting clarification.");
    } finally {
      setBusy(false);
    }
  }, [canAsk, onAfterClarify, promptId, question]);

  if (!canAsk) return null;

  return (
    <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="text-left text-sm text-amber-200/90 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {open ? "Hide follow-up" : "Ask about this result"}
      </button>
      <p className="mt-1 text-xs text-zinc-500">
        Optional second LLM pass: questions or specifics about the model note and tier—does not
        change the saved score (re-run analysis for that).
      </p>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={4000}
            disabled={busy || disabled}
            placeholder="e.g. Why did the model flag ambiguity here? What rubric line applies?"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || disabled || !question.trim()}
              className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-1.5 text-sm font-medium text-amber-100/95 transition hover:bg-amber-950/55 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Running…" : "Get clarification"}
            </button>
          </div>
          {error ? (
            <p className="text-sm text-rose-300/95">{error}</p>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <div className={open ? "mt-4 border-t border-zinc-800/80 pt-4" : "mt-3"}>
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Saved follow-up
            {saved.updatedAt
              ? ` · ${new Date(saved.updatedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}`
              : ""}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            <span className="font-medium text-zinc-400">Q: </span>
            {saved.question}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {saved.answer}
          </p>
        </div>
      ) : null}
    </div>
  );
}
