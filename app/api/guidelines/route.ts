import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const guidelines = await prisma.guideline.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(guidelines);
}

const postSchema = z.object({
  name: z.string().min(1, "Name is required"),
  content: z.string().min(1, "Guideline content is required"),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const guideline = await prisma.guideline.create({
    data: parsed.data,
  });

  return NextResponse.json(guideline, { status: 201 });
}
