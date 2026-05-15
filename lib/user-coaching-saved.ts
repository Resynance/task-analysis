import { z } from "zod";
import type { UserCoachingAnalysisResult } from "@/lib/user-coaching-analysis";
import { userCoachingStoredResultSchema } from "@/lib/user-coaching-analysis";

export const userCoachingSavedFiltersSchema = z.object({
  env: z.string(),
  records: z.enum(["all", "prompts", "feedback"]),
});

export type UserCoachingSavedFilters = z.infer<
  typeof userCoachingSavedFiltersSchema
>;

export const userCoachingSavedPayloadSchema = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  displayName: z.string(),
  filters: userCoachingSavedFiltersSchema,
  additionalContextPresent: z.boolean(),
  result: userCoachingStoredResultSchema,
});

export type UserCoachingSavedPayload = z.infer<
  typeof userCoachingSavedPayloadSchema
>;

export function parseUserCoachingSavedPayload(
  json: unknown,
): UserCoachingSavedPayload | null {
  const r = userCoachingSavedPayloadSchema.safeParse(json);
  return r.success ? r.data : null;
}

export function buildUserCoachingSavedPayload(input: {
  displayName: string;
  filters: UserCoachingSavedFilters;
  additionalContextPresent: boolean;
  result: UserCoachingAnalysisResult;
}): UserCoachingSavedPayload {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    displayName: input.displayName,
    filters: input.filters,
    additionalContextPresent: input.additionalContextPresent,
    result: input.result,
  };
}
