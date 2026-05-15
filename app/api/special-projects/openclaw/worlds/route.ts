import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  body: z.string(),
});

/** List saved worlds (metadata only). */
export async function GET() {
  const rows = await prisma.openclawWorld.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json({ worlds: rows });
}

/** Create a new saved world. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const row = await prisma.openclawWorld.create({
    data: {
      name: parsed.data.name.trim(),
      body: parsed.data.body,
    },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json(row);
}
