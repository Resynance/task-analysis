import { NextResponse } from "next/server";
import { z } from "zod";
import { DATASET_IMPORTED_TASKS_GUIDELINE_NAME } from "@/lib/dataset/guideline-names";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

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

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  const existing = await prisma.guideline.findUnique({
    where: { id },
    select: { name: true },
  });
  if (
    existing?.name === DATASET_IMPORTED_TASKS_GUIDELINE_NAME &&
    parsed.data.name != null &&
    parsed.data.name !== DATASET_IMPORTED_TASKS_GUIDELINE_NAME
  ) {
    return NextResponse.json(
      { error: "The import rubric name is fixed; you can still edit its content." },
      { status: 400 },
    );
  }

  try {
    const guideline = await prisma.guideline.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(guideline);
  } catch {
    return NextResponse.json({ error: "Guideline not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const g = await prisma.guideline.findUnique({
    where: { id },
    select: { name: true },
  });
  if (g?.name === DATASET_IMPORTED_TASKS_GUIDELINE_NAME) {
    return NextResponse.json(
      { error: "The import rubric cannot be deleted; it is required for JSON ingest." },
      { status: 403 },
    );
  }

  const inUse = await prisma.prompt.count({ where: { guidelineId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot delete a guideline that prompts still reference. Reassign or delete those prompts first.",
      },
      { status: 409 },
    );
  }

  try {
    await prisma.guideline.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Guideline not found" }, { status: 404 });
  }
}
