import OpenAI from "openai";
import type { ResolvedLlmConfig } from "@/lib/llm-config";
import { assertLlmConfigured } from "@/lib/llm-config";
import { recordOpenRouterAuditLog } from "@/lib/openrouter-audit-log";

/**
 * Thin OpenAI-compatible client factory: **OpenRouter**, **remote OpenAI-compatible API**, or
 * **LM Studio** (local). Model id and base URL come from `ResolvedLlmConfig` (`lib/llm-config.ts`).
 */
export function createLlmClient(cfg: ResolvedLlmConfig): OpenAI {
  assertLlmConfigured(cfg);

  if (cfg.provider === "openrouter") {
    return new OpenAI({
      baseURL: cfg.openrouterBaseUrl,
      apiKey: cfg.openrouterApiKey!,
      defaultHeaders: {
        "HTTP-Referer": cfg.openrouterHttpReferer,
        "X-Title": cfg.openrouterAppTitle,
      },
    });
  }

  if (cfg.provider === "remote_api") {
    return new OpenAI({
      baseURL: cfg.remoteApiBaseUrl,
      apiKey: cfg.remoteApiKey!,
    });
  }

  return new OpenAI({
    baseURL: cfg.lmstudioBaseUrl,
    apiKey: "lm-studio",
  });
}

export function getChatModel(cfg: ResolvedLlmConfig): string {
  if (cfg.provider === "openrouter") return cfg.openrouterModel;
  if (cfg.provider === "remote_api") return cfg.remoteApiModel;
  return cfg.lmstudioModel;
}

/**
 * Non-streaming chat completion. When the active provider is **OpenRouter**, writes one audit row
 * (tokens + `usage.cost` when the API returns it). LM Studio calls are not logged.
 */
export async function chatCompletionCreateAudited(
  cfg: ResolvedLlmConfig,
  auditSource: string,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const client = createLlmClient(cfg);
  const completion = await client.chat.completions.create(params);
  if (cfg.provider === "openrouter") {
    await recordOpenRouterAuditLog({ source: auditSource, completion });
  }
  return completion;
}
