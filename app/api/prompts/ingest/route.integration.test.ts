/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/prompts/ingest/route";

describe("POST /api/prompts/ingest", () => {
  it(
    "returns JSON with prompts and feedback ingest results",
    async () => {
      const res = await POST();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBeDefined();
      expect(body.prompts).toBeDefined();
      expect(body.feedback).toBeDefined();
      expect(typeof body.prompts?.message).toBe("string");
      expect(typeof body.feedback?.message).toBe("string");
    },
    60_000,
  );
});
