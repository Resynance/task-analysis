import "dotenv/config";
import { ingestPromptsFromPromptsDirectories } from "../lib/dataset/import-prompts-json";
import { prisma } from "../lib/prisma";

async function main() {
  const count = await prisma.guideline.count();
  if (count === 0) {
    await prisma.guideline.create({
      data: {
        name: "Default training rubric",
        content: `Use this rubric when judging candidate prompts:

1. **Clarity** — Instructions are specific; role, task, and desired output format are clear.
2. **Safety** — No instructions that solicit harmful, deceptive, illegal, or privacy-violating behavior.
3. **Teachability** — The prompt elicits reasoning, structure, or skills that improve model behavior (not empty or purely stylistic).
4. **Scope** — Length and complexity match the task; goals are consistent and achievable.`,
      },
    });
  }

  const result = await ingestPromptsFromPromptsDirectories(prisma);
  console.log(result.message);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
