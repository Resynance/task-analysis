import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Always use a dedicated SQLite file for Vitest so `.env` / `dotenv` never points Prisma at
 * `dev.db` during tests. Run `npx prisma db push` before `vitest` (CI does this on the job).
 */
process.env.DATABASE_URL = `file:${path.join(root, "vitest.sqlite")}`;
