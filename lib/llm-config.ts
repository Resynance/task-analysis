import type { PrismaClient } from "@/generated/prisma/client";
import { getLlmEnvDefaults } from "@/lib/env";

/**
 * Resolves effective LLM settings from **SQLite app settings** plus `lib/env` fallbacks, and
 * exposes `assertLlmConfigured` for routes that require a key before calling the model.
 */
const SETTINGS_ID = "default";

export type LlmProviderId = "openrouter" | "lmstudio" | "remote_api";

export type ResolvedLlmConfig = {
  provider: LlmProviderId;
  openrouterBaseUrl: string;
  openrouterModel: string;
  /** Effective key: DB override if set, otherwise env. */
  openrouterApiKey: string | null;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  remoteApiBaseUrl: string;
  remoteApiModel: string;
  remoteApiKey: string | null;
  openrouterHttpReferer: string;
  openrouterAppTitle: string;
  /** Where the OpenRouter key came from (for UI). */
  openrouterApiKeySource: "database" | "environment" | "none";
  /** Where the remote API key came from (for UI). */
  remoteApiKeySource: "database" | "environment" | "none";
};

function pick<T>(db: T | null | undefined, env: T): T {
  return db !== null && db !== undefined && db !== "" ? db : env;
}

function normalizeStoredProvider(raw: string | null | undefined): LlmProviderId {
  if (raw === "lmstudio") return "lmstudio";
  if (raw === "remote_api") return "remote_api";
  return "openrouter";
}

/** JSON `response_format: { type: "json_object" }` — supported for OpenRouter and typical OpenAI-compatible hosted APIs; not used for LM Studio in this app. */
export function supportsChatJsonObjectResponseFormat(
  cfg: ResolvedLlmConfig,
): boolean {
  return cfg.provider === "openrouter" || cfg.provider === "remote_api";
}

export function assertLlmConfigured(cfg: ResolvedLlmConfig): void {
  if (cfg.provider === "openrouter" && !cfg.openrouterApiKey?.trim()) {
    throw new Error(
      "OpenRouter requires an API key. Add one in LLM settings or set OPENROUTER_API_KEY in the environment.",
    );
  }
  if (cfg.provider === "remote_api" && !cfg.remoteApiKey?.trim()) {
    throw new Error(
      "Hosted OpenAI-compatible API requires an API key. Add one in LLM settings or set REMOTE_API_KEY or OPENAI_API_KEY in the environment.",
    );
  }
}

export async function resolveLlmConfig(
  prisma: PrismaClient,
): Promise<ResolvedLlmConfig> {
  const env = getLlmEnvDefaults();

  let row = await prisma.llmSettings.findUnique({
    where: { id: SETTINGS_ID },
  });

  if (!row) {
    row = await prisma.llmSettings.create({
      data: {
        id: SETTINGS_ID,
        provider: env.provider,
        openrouterBaseUrl: env.openrouterBaseUrl,
        openrouterModel: env.openrouterModel,
        openrouterApiKey: null,
        lmstudioBaseUrl: env.lmstudioBaseUrl,
        lmstudioModel: env.lmstudioModel,
        remoteApiBaseUrl: env.remoteApiBaseUrl,
        remoteApiModel: env.remoteApiModel,
        remoteApiKey: null,
        openrouterHttpReferer: env.openrouterHttpReferer,
        openrouterAppTitle: env.openrouterAppTitle,
      },
    });
  }

  const dbOrKey = row.openrouterApiKey?.trim() || null;
  const envOrKey = env.openrouterApiKey;
  const effectiveOpenrouterKey = dbOrKey ?? envOrKey ?? null;

  let openrouterApiKeySource: ResolvedLlmConfig["openrouterApiKeySource"] =
    "none";
  if (effectiveOpenrouterKey) {
    openrouterApiKeySource = dbOrKey ? "database" : "environment";
  }

  const dbRemoteKey = row.remoteApiKey?.trim() || null;
  const envRemoteKey = env.remoteApiKey;
  const effectiveRemoteKey = dbRemoteKey ?? envRemoteKey ?? null;

  let remoteApiKeySource: ResolvedLlmConfig["remoteApiKeySource"] = "none";
  if (effectiveRemoteKey) {
    remoteApiKeySource = dbRemoteKey ? "database" : "environment";
  }

  const provider = normalizeStoredProvider(row.provider);

  return {
    provider,
    openrouterBaseUrl: pick(row.openrouterBaseUrl, env.openrouterBaseUrl),
    openrouterModel: pick(row.openrouterModel, env.openrouterModel),
    openrouterApiKey: effectiveOpenrouterKey,
    lmstudioBaseUrl: pick(row.lmstudioBaseUrl, env.lmstudioBaseUrl),
    lmstudioModel: pick(row.lmstudioModel, env.lmstudioModel),
    remoteApiBaseUrl: pick(row.remoteApiBaseUrl, env.remoteApiBaseUrl),
    remoteApiModel: pick(row.remoteApiModel, env.remoteApiModel),
    remoteApiKey: effectiveRemoteKey,
    openrouterHttpReferer: pick(
      row.openrouterHttpReferer,
      env.openrouterHttpReferer,
    ),
    openrouterAppTitle: pick(row.openrouterAppTitle, env.openrouterAppTitle),
    openrouterApiKeySource,
    remoteApiKeySource,
  };
}
