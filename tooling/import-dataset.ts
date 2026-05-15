import "dotenv/config";
import { ingestPromptsFromPromptsDirectories } from "../lib/dataset/import-prompts-json";
import { prisma } from "../lib/prisma";

async function main() {
  const result = await ingestPromptsFromPromptsDirectories(prisma);
  console.log(result.message);
  if (result.filePaths.length === 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
