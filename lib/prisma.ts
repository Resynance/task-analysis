import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseUrl } from "@/lib/env";

function resolveSqlitePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Expected a file: SQLite URL, got: ${databaseUrl}`);
  }
  const raw = databaseUrl.slice("file:".length);
  return path.resolve(process.cwd(), raw.replace(/^\.\//, ""));
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  sqliteAdapter: PrismaBetterSqlite3 | undefined;
  /** Invalidates cached PrismaClient after `prisma generate` / schema shape changes (dev HMR). */
  prismaClientRevision: number | undefined;
};

/**
 * Bump when the generated client shape changes incompatibly with an older cached instance.
 * (Next dev keeps `globalForPrisma.prisma` across reloads; stale clients reject new selects.)
 */
const PRISMA_CLIENT_REVISION = 9;

function prismaClientIsStale(client: PrismaClient | undefined): boolean {
  if (!client) return true;
  if (globalForPrisma.prismaClientRevision !== PRISMA_CLIENT_REVISION) return true;
  const delegates = client as unknown as {
    coachingInsight?: unknown;
    prunedTaskAnalysis?: unknown;
    userCoachingInsight?: unknown;
    feedback?: unknown;
    mentorshipPod?: unknown;
    podMembership?: unknown;
    openclawWorld?: unknown;
    openRouterApiAuditLog?: unknown;
  };
  return (
    delegates.coachingInsight == null ||
    delegates.prunedTaskAnalysis == null ||
    delegates.userCoachingInsight == null ||
    delegates.feedback == null ||
    delegates.mentorshipPod == null ||
    delegates.podMembership == null ||
    delegates.openclawWorld == null ||
    delegates.openRouterApiAuditLog == null
  );
}

function getAdapter(): PrismaBetterSqlite3 {
  if (!globalForPrisma.sqliteAdapter) {
    const databaseUrl = getDatabaseUrl();
    globalForPrisma.sqliteAdapter = new PrismaBetterSqlite3({
      url: resolveSqlitePath(databaseUrl),
    });
  }
  return globalForPrisma.sqliteAdapter;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: getAdapter(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

let prisma: PrismaClient;
if (prismaClientIsStale(globalForPrisma.prisma)) {
  prisma = createPrismaClient();
} else {
  prisma = globalForPrisma.prisma!;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClientRevision = PRISMA_CLIENT_REVISION;
}

export { prisma };
