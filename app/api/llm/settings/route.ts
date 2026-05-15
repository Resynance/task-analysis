import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmEnvDefaults } from "@/lib/env";
import { resolveLlmConfig } from "@/lib/llm-config";
import type { LlmProviderId } from "@/lib/llm-config";

const SETTINGS_ID = "default";

const providerEnum = z.enum(["openrouter", "lmstudio", "remote_api"]);

function parseFormProvider(raw: string | null | undefined): LlmProviderId {
  const p = providerEnum.safeParse(raw);
  return p.success ? p.data : "openrouter";
}

export async function GET() {
  try {
    const cfg = await resolveLlmConfig(prisma);
    const env = getLlmEnvDefaults();
    const row = await prisma.llmSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    const safeDefaults = {
      provider: env.provider,
      openrouterBaseUrl: env.openrouterBaseUrl,
      openrouterModel: env.openrouterModel,
      lmstudioBaseUrl: env.lmstudioBaseUrl,
      lmstudioModel: env.lmstudioModel,
      remoteApiBaseUrl: env.remoteApiBaseUrl,
      remoteApiModel: env.remoteApiModel,
      openrouterHttpReferer: env.openrouterHttpReferer,
      openrouterAppTitle: env.openrouterAppTitle,
    };
    return NextResponse.json({
      effective: {
        provider: cfg.provider,
        openrouterBaseUrl: cfg.openrouterBaseUrl,
        openrouterModel: cfg.openrouterModel,
        lmstudioBaseUrl: cfg.lmstudioBaseUrl,
        lmstudioModel: cfg.lmstudioModel,
        remoteApiBaseUrl: cfg.remoteApiBaseUrl,
        remoteApiModel: cfg.remoteApiModel,
        hasOpenrouterApiKey: Boolean(cfg.openrouterApiKey),
        openrouterApiKeySource: cfg.openrouterApiKeySource,
        hasRemoteApiKey: Boolean(cfg.remoteApiKey),
        remoteApiKeySource: cfg.remoteApiKeySource,
      },
      defaults: safeDefaults,
      form: {
        provider: parseFormProvider(row?.provider ?? env.provider),
        openrouterBaseUrl: row?.openrouterBaseUrl ?? "",
        openrouterModel: row?.openrouterModel ?? "",
        lmstudioBaseUrl: row?.lmstudioBaseUrl ?? "",
        lmstudioModel: row?.lmstudioModel ?? "",
        remoteApiBaseUrl: row?.remoteApiBaseUrl ?? "",
        remoteApiModel: row?.remoteApiModel ?? "",
        openrouterHttpReferer: row?.openrouterHttpReferer ?? "",
        openrouterAppTitle: row?.openrouterAppTitle ?? "",
        openrouterApiKeyStored: Boolean(row?.openrouterApiKey?.trim()),
        remoteApiKeyStored: Boolean(row?.remoteApiKey?.trim()),
      },
      envHasOpenrouterKey: Boolean(env.openrouterApiKey),
      envHasRemoteApiKey: Boolean(env.remoteApiKey),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load settings" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  provider: providerEnum.optional(),
  openrouterBaseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  openrouterModel: z.union([z.string().min(1), z.literal("")]).optional(),
  lmstudioBaseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  lmstudioModel: z.union([z.string().min(1), z.literal("")]).optional(),
  remoteApiBaseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  remoteApiModel: z.union([z.string().min(1), z.literal("")]).optional(),
  openrouterHttpReferer: z.union([z.string(), z.literal("")]).optional(),
  openrouterAppTitle: z.union([z.string(), z.literal("")]).optional(),
  /** Pass empty string to clear the stored key and use the environment variable. */
  openrouterApiKey: z.string().optional(),
  remoteApiKey: z.string().optional(),
});

function toNull(s: string | undefined): string | null | undefined {
  if (s === undefined) return undefined;
  return s === "" ? null : s;
}

export async function PATCH(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await resolveLlmConfig(prisma);

  const d = parsed.data;
  const data: Record<string, unknown> = {};

  if (d.provider !== undefined) data.provider = d.provider;
  if (d.openrouterBaseUrl !== undefined) {
    data.openrouterBaseUrl = toNull(d.openrouterBaseUrl);
  }
  if (d.openrouterModel !== undefined) {
    data.openrouterModel = toNull(d.openrouterModel);
  }
  if (d.lmstudioBaseUrl !== undefined) {
    data.lmstudioBaseUrl = toNull(d.lmstudioBaseUrl);
  }
  if (d.lmstudioModel !== undefined) {
    data.lmstudioModel = toNull(d.lmstudioModel);
  }
  if (d.remoteApiBaseUrl !== undefined) {
    data.remoteApiBaseUrl = toNull(d.remoteApiBaseUrl);
  }
  if (d.remoteApiModel !== undefined) {
    data.remoteApiModel = toNull(d.remoteApiModel);
  }
  if (d.openrouterHttpReferer !== undefined) {
    data.openrouterHttpReferer = toNull(d.openrouterHttpReferer);
  }
  if (d.openrouterAppTitle !== undefined) {
    data.openrouterAppTitle = toNull(d.openrouterAppTitle);
  }
  if (d.openrouterApiKey !== undefined) {
    data.openrouterApiKey =
      d.openrouterApiKey === "" ? null : d.openrouterApiKey;
  }
  if (d.remoteApiKey !== undefined) {
    data.remoteApiKey = d.remoteApiKey === "" ? null : d.remoteApiKey;
  }

  if (Object.keys(data).length > 0) {
    await prisma.llmSettings.update({
      where: { id: SETTINGS_ID },
      data,
    });
  }

  const cfg = await resolveLlmConfig(prisma);
  return NextResponse.json({
    ok: true,
    hasOpenrouterApiKey: Boolean(cfg.openrouterApiKey),
    openrouterApiKeySource: cfg.openrouterApiKeySource,
    hasRemoteApiKey: Boolean(cfg.remoteApiKey),
    remoteApiKeySource: cfg.remoteApiKeySource,
  });
}
