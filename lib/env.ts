import { z } from "zod";

/**
 * Process-environment bootstrap: `DATABASE_URL`, default LLM provider and URLs. These are env
 * defaults; persisted app settings can override LLM fields (`lib/llm-config.ts`).
 */
const providerSchema = z.enum(["openrouter", "lmstudio", "remote_api"]);

/** Required for Prisma / SQLite bootstrap only. */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  return url;
}

/** Baseline LLM values from environment (overridden by app settings when present). */
export function getLlmEnvDefaults() {
  const providerRaw = process.env.LLM_PROVIDER ?? "openrouter";
  const provider = providerSchema.safeParse(providerRaw).success
    ? (providerRaw as z.infer<typeof providerSchema>)
    : "openrouter";

  const remoteApiKey =
    process.env.REMOTE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null;

  return {
    provider,
    openrouterBaseUrl:
      process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    openrouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() ?? null,
    lmstudioBaseUrl:
      process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
    lmstudioModel: process.env.LMSTUDIO_MODEL ?? "local-model",
    remoteApiBaseUrl:
      process.env.REMOTE_API_BASE_URL ?? "https://api.openai.com/v1",
    remoteApiModel: process.env.REMOTE_API_MODEL ?? "gpt-4o-mini",
    remoteApiKey,
    openrouterHttpReferer:
      process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:3000",
    openrouterAppTitle: process.env.OPENROUTER_APP_TITLE ?? "task-analysis",
  };
}
