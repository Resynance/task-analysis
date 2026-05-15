import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveLlmConfig } from "@/lib/llm-config";

export async function GET() {
  try {
    const cfg = await resolveLlmConfig(prisma);
    const configured =
      cfg.provider === "lmstudio" ||
      (cfg.provider === "openrouter" && Boolean(cfg.openrouterApiKey?.trim())) ||
      (cfg.provider === "remote_api" && Boolean(cfg.remoteApiKey?.trim()));

    const model =
      cfg.provider === "openrouter"
        ? cfg.openrouterModel
        : cfg.provider === "remote_api"
          ? cfg.remoteApiModel
          : cfg.lmstudioModel;
    const baseUrl =
      cfg.provider === "openrouter"
        ? cfg.openrouterBaseUrl
        : cfg.provider === "remote_api"
          ? cfg.remoteApiBaseUrl
          : cfg.lmstudioBaseUrl;

    return NextResponse.json({
      provider: cfg.provider,
      model,
      baseUrl,
      configured,
      openrouterApiKeySource: cfg.openrouterApiKeySource,
      remoteApiKeySource: cfg.remoteApiKeySource,
    });
  } catch (e) {
    return NextResponse.json(
      {
        provider: null,
        model: null,
        baseUrl: null,
        configured: false,
        error: e instanceof Error ? e.message : "Invalid configuration",
      },
      { status: 200 },
    );
  }
}
