/** @vitest-environment node */
import { afterAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/guidelines/route";
import { prisma } from "@/lib/prisma";

describe("GET /api/guidelines", () => {
  it("returns JSON array", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("POST /api/guidelines", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.guideline.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/guidelines", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty body fields with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", content: "x" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a guideline with 201", async () => {
    const name = `vitest-guideline-${Date.now()}`;
    const res = await POST(
      new Request("http://localhost/api/guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: "Integration test body." }),
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.name).toBe(name);
    expect(typeof row.id).toBe("string");
    createdIds.push(row.id);
  });
});
