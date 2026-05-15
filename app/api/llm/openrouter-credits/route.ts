import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveLlmConfig } from "@/lib/llm-config";
import { fetchOpenRouterCredits } from "@/lib/openrouter-credits";

export async function GET() {
  let cfg;
  try {
    cfg = await resolveLlmConfig(prisma);
  } catch {
    return NextResponse.json({ show: false as const });
  }

  if (cfg.provider !== "openrouter" || !cfg.openrouterApiKey?.trim()) {
    return NextResponse.json({ show: false as const });
  }

  try {
    const snapshot = await fetchOpenRouterCredits(cfg);
    return NextResponse.json({
      show: true as const,
      ok: true as const,
      remaining: snapshot.remaining,
      totalCredits: snapshot.totalCredits,
      totalUsage: snapshot.totalUsage,
    });
  } catch (e) {
    return NextResponse.json({
      show: true as const,
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not load credits",
    });
  }
}
