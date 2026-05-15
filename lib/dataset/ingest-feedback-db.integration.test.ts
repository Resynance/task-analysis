/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestFeedbackFromFeedbackDirectory } from "@/lib/dataset/import-feedback-csv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

describe("ingestFeedbackFromFeedbackDirectory (fixture DB)", () => {
  let dbPath: string;
  let prisma: PrismaClient;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `task-analysis-ingest-${randomUUID()}.sqlite`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const databaseUrl = `file:${dbPath}`;
    execFileSync("npx", ["prisma", "db", "push"], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it("imports rows from tracked feedback/samples CSVs", async () => {
    const result = await ingestFeedbackFromFeedbackDirectory(prisma);
    expect(result.filePaths.length).toBeGreaterThan(0);
    expect(result.synced + result.skipped).toBeGreaterThan(0);
    const count = await prisma.feedback.count();
    expect(count).toBeGreaterThan(0);
  });
});
