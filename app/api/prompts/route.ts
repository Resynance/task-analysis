import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const prompts = await prisma.prompt.findMany({
    orderBy: { createdAt: "desc" },
    include: { guideline: { select: { id: true, name: true } } },
  });
  return NextResponse.json(prompts);
}

const postSchema = z.object({
  body: z.string().min(1, "Prompt text is required"),
  guidelineId: z.string().min(1).optional(),
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

  let guidelineId = parsed.data.guidelineId;
  if (!guidelineId) {
    const first = await prisma.guideline.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!first) {
      return NextResponse.json(
        {
          error:
            "No guidelines exist yet. Add a guideline set under Guidelines before creating prompts.",
        },
        { status: 400 },
      );
    }
    guidelineId = first.id;
  } else {
    const exists = await prisma.guideline.findUnique({
      where: { id: guidelineId },
    });
    if (!exists) {
      return NextResponse.json(
        { error: "Guideline not found" },
        { status: 400 },
      );
    }
  }

  const prompt = await prisma.prompt.create({
    data: { body: parsed.data.body, guidelineId },
    include: { guideline: { select: { id: true, name: true } } },
  });

  return NextResponse.json(prompt, { status: 201 });
}
