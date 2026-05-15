import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await prisma.openclawWorld.findUnique({
    where: { id },
    select: { id: true, name: true, body: true, updatedAt: true },
  });
  if (!row) {
    return NextResponse.json({ error: "World not found." }, { status: 404 });
  }
  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data: { name?: string; body?: string } = {};
  if (parsed.data.name != null) data.name = parsed.data.name.trim();
  if (parsed.data.body != null) data.body = parsed.data.body;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }
  try {
    const row = await prisma.openclawWorld.update({
      where: { id },
      data,
      select: { id: true, name: true, updatedAt: true },
    });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "World not found." }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    await prisma.openclawWorld.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "World not found." }, { status: 404 });
  }
}
