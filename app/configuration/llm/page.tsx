import Link from "next/link";
import { LlmSettingsForm } from "@/components/llm-settings-form";
import type { LlmProviderOption } from "@/components/llm-settings-form";
import { getLlmEnvDefaults } from "@/lib/env";
import { resolveLlmConfig } from "@/lib/llm-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function storedProvider(
  raw: string | null | undefined,
  envFallback: LlmProviderOption,
): LlmProviderOption {
  if (raw === "lmstudio") return "lmstudio";
  if (raw === "remote_api") return "remote_api";
  if (raw === "openrouter") return "openrouter";
  return envFallback;
}

export default async function LlmSettingsPage() {
  await resolveLlmConfig(prisma);
  const fullEnv = getLlmEnvDefaults();
  const defaults = {
    provider: fullEnv.provider,
    openrouterBaseUrl: fullEnv.openrouterBaseUrl,
    openrouterModel: fullEnv.openrouterModel,
    lmstudioBaseUrl: fullEnv.lmstudioBaseUrl,
    lmstudioModel: fullEnv.lmstudioModel,
    remoteApiBaseUrl: fullEnv.remoteApiBaseUrl,
    remoteApiModel: fullEnv.remoteApiModel,
    openrouterHttpReferer: fullEnv.openrouterHttpReferer,
    openrouterAppTitle: fullEnv.openrouterAppTitle,
  };
  const row = await prisma.llmSettings.findUnique({
    where: { id: "default" },
  });

  const initial = {
    provider: storedProvider(row?.provider, fullEnv.provider),
    openrouterBaseUrl: row?.openrouterBaseUrl ?? "",
    openrouterModel: row?.openrouterModel ?? "",
    lmstudioBaseUrl: row?.lmstudioBaseUrl ?? "",
    lmstudioModel: row?.lmstudioModel ?? "",
    remoteApiBaseUrl: row?.remoteApiBaseUrl ?? "",
    remoteApiModel: row?.remoteApiModel ?? "",
    openrouterHttpReferer: row?.openrouterHttpReferer ?? "",
    openrouterAppTitle: row?.openrouterAppTitle ?? "",
  };

  return (
    <>
      <div className="mx-auto mt-8 w-full max-w-2xl px-5">
        <Link
          href="/configuration"
          className="text-sm text-zinc-500 transition hover:text-amber-200/90"
        >
          ← Back to configuration
        </Link>
      </div>
      <LlmSettingsForm
        defaults={defaults}
        initial={initial}
        envHasOpenrouterKey={Boolean(fullEnv.openrouterApiKey)}
        envHasRemoteApiKey={Boolean(fullEnv.remoteApiKey)}
        initialOpenrouterKeyStored={Boolean(row?.openrouterApiKey?.trim())}
        initialRemoteApiKeyStored={Boolean(row?.remoteApiKey?.trim())}
      />
    </>
  );
}
