import { prisma } from "@/lib/prisma";

/** Minimal surface used by the audit log page and writer. */
export type OpenRouterApiAuditLogDelegate = {
  count: (args?: object) => Promise<number>;
  findMany: (args: object) => Promise<object[]>;
  aggregate: (args: object) => Promise<{ _sum: { costUsd: number | null } }>;
  create: (args: object) => Promise<unknown>;
};

/**
 * Returns the Prisma delegate when the generated client includes `OpenRouterApiAuditLog`.
 * `generated/` is gitignored — run `npx prisma generate` (and `npx prisma db push`) after pulling
 * schema changes or the delegate is missing at runtime.
 */
export function getOpenRouterApiAuditLogDb(): OpenRouterApiAuditLogDelegate | null {
  const d = (prisma as unknown as { openRouterApiAuditLog?: OpenRouterApiAuditLogDelegate })
    .openRouterApiAuditLog;
  return d ?? null;
}
