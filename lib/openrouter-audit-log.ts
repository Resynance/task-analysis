import type OpenAI from "openai";
import { getOpenRouterApiAuditLogDb } from "@/lib/openrouter-audit-prisma";

/** OpenRouter extends chat `usage` with USD billing (`usage.cost`). */
type OpenRouterCompletionUsage = NonNullable<
  OpenAI.Chat.Completions.ChatCompletion["usage"]
> & {
  cost?: number;
};

/**
 * Persists one audit row for a completed OpenRouter chat completion. Swallows errors so LLM
 * callers still succeed if SQLite write fails.
 */
export async function recordOpenRouterAuditLog(input: {
  source: string;
  completion: OpenAI.Chat.Completions.ChatCompletion;
}): Promise<void> {
  const usage = input.completion.usage as OpenRouterCompletionUsage | undefined;
  const cost =
    typeof usage?.cost === "number" && Number.isFinite(usage.cost)
      ? usage.cost
      : null;

  const audit = getOpenRouterApiAuditLogDb();
  if (!audit) return;

  try {
    await audit.create({
      data: {
        source: input.source.slice(0, 240),
        model: (input.completion.model ?? "").slice(0, 512),
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        costUsd: cost,
        completionId: input.completion.id
          ? input.completion.id.slice(0, 256)
          : null,
      },
    });
  } catch (e) {
    console.error("[openrouter-audit-log] failed to persist row:", e);
  }
}
