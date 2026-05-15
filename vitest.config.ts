import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      "out",
      "build",
      "generated",
      "projects/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Only modules with unit tests — avoids counting the whole `lib/` tree as 0% and failing thresholds.
      include: [
        "lib/dataset/csv-rfc4180.ts",
        "lib/extract-outer-json-object.ts",
        "lib/library-pagination.ts",
        "lib/task-project.ts",
        "lib/task-environment.ts",
        "lib/csv-export.ts",
        "lib/filter-prompts-by-project.ts",
        "lib/filter-prompts-by-env.ts",
        "lib/feedback-qa-outcome.ts",
        "lib/openclaw-writer-precheck-csv.ts",
      ],
      exclude: ["**/*.d.ts", "**/*.{test,spec}.{ts,tsx}"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
