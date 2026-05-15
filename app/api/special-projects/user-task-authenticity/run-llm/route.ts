import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzeUserTaskAuthenticity } from "@/lib/user-task-authenticity-analysis";

export const dynamic = "force-dynamic";

function parseModels(raw: unknown): string[] {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!Array.isArray(body.models)) return [];
  return body.models
    .map((model) => (typeof model === "string" ? model.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
}

function parseAht(raw: unknown): string | null {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return typeof body.aht === "string" && body.aht.trim() ? body.aht.trim() : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const models = parseModels(body);
  if (models.length !== 3 || new Set(models).size !== 3) {
    return NextResponse.json(
      { error: "Provide three different model ids." },
      { status: 400 },
    );
  }

  const analysis = await analyzeUserTaskAuthenticity(prisma, {
    runLlm: true,
    models,
    aht: parseAht(body),
  });
  return NextResponse.json(analysis);
}
