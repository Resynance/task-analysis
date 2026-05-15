import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePromptsJsonFile } from "./prompts-json";

describe("parsePromptsJsonFile", () => {
  it("accepts rows with explicit null eval_task_versions", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "prompts-json-test-"));
    const file = path.join(dir, "prompts.json");
    try {
      writeFileSync(
        file,
        JSON.stringify([
          {
            id: "task-1",
            key: "TASK-1",
            created_at: "2026-01-01T00:00:00.000Z",
            eval_task_versions: null,
          },
        ]),
      );

      expect(parsePromptsJsonFile(file)).toEqual([
        {
          id: "task-1",
          key: "TASK-1",
          created_at: "2026-01-01T00:00:00.000Z",
          eval_task_versions: null,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
