import type { PrismaClient } from "@/generated/prisma/client";
import { DATASET_IMPORTED_TASKS_GUIDELINE_NAME } from "@/lib/dataset/guideline-names";

/** Shown in filters, batch scope, and new-prompt form — not the system import rubric. */
export function filterGuidelinesForUi<T extends { name: string }>(
  guidelines: T[],
): T[] {
  return guidelines.filter(
    (g) => g.name !== DATASET_IMPORTED_TASKS_GUIDELINE_NAME,
  );
}

export function findDatasetImportedTasksGuidelineId(
  guidelines: { id: string; name: string }[],
): string | null {
  return (
    guidelines.find((g) => g.name === DATASET_IMPORTED_TASKS_GUIDELINE_NAME)
      ?.id ?? null
  );
}

export async function getDatasetImportedTasksGuidelineId(
  prisma: PrismaClient,
): Promise<string | null> {
  const r = await prisma.guideline.findFirst({
    where: { name: DATASET_IMPORTED_TASKS_GUIDELINE_NAME },
    select: { id: true },
  });
  return r?.id ?? null;
}

/**
 * When users pick specific visible rubrics, prompts scored with the hidden
 * import rubric still match (ingest assigns that rubric automatically).
 */
export function matchesRubricFilter(
  promptGuidelineId: string,
  selectedRubricIds: string[],
  datasetImportedGuidelineId: string | null,
): boolean {
  if (selectedRubricIds.length === 0) return true;
  if (selectedRubricIds.includes(promptGuidelineId)) return true;
  if (
    datasetImportedGuidelineId &&
    promptGuidelineId === datasetImportedGuidelineId
  ) {
    return true;
  }
  return false;
}
