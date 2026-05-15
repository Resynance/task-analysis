/** Dispatched on `window` when OpenRouter usage may have changed (debounced). */
export const OPENROUTER_CREDITS_REFRESH_EVENT = "openrouter-credits-refresh";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce rapid LLM calls (e.g. batch) into a single balance refresh. */
export function requestOpenRouterCreditsRefresh(): void {
  if (typeof window === "undefined") return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    window.dispatchEvent(new CustomEvent(OPENROUTER_CREDITS_REFRESH_EVENT));
  }, 450);
}
