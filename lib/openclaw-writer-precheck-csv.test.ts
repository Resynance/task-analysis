import { describe, expect, it } from "vitest";

import { parseWriterPrecheckCsv } from "./openclaw-writer-precheck-csv";

describe("parseWriterPrecheckCsv", () => {
  it("parses prompt-only minimal CSV", () => {
    const { rows, errors } = parseWriterPrecheckCsv("prompt\nHello task");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowIndex: 1,
      externalId: null,
      prompt: "Hello task",
      writerRubric: null,
      notes: null,
      writerName: null,
      personaName: null,
    });
  });

  it("maps rubric, notes, and id columns", () => {
    const csv =
      "id,prompt_body,rubric,notes\n" +
      "t1,Do the thing,Check A,Writer note\n";
    const { rows, errors } = parseWriterPrecheckCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      externalId: "t1",
      prompt: "Do the thing",
      writerRubric: "Check A",
      notes: "Writer note",
      writerName: null,
      personaName: null,
    });
  });

  it("errors when no prompt column", () => {
    const { rows, errors } = parseWriterPrecheckCsv("foo,bar\n1,2");
    expect(rows).toEqual([]);
    expect(errors.some((e) => e.includes("Missing prompt"))).toBe(true);
  });

  it("parses sprint-style sheet headers with Prompt/Task alias", () => {
    const header =
      "Name,Persona Name,Prompt/Task,Rubric,Task Key/ID or Instance ID,Notes/Comments,Updated Task ID";
    const row =
      'Writer One,Persona Alpha,"Compare invoices",Long rubric text,task_key_1,A note,';
    const { rows, errors } = parseWriterPrecheckCsv(`${header}\n${row}`);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowIndex: 1,
      externalId: "task_key_1",
      prompt: "Compare invoices",
      writerRubric: "Long rubric text",
      notes: "A note",
      writerName: "Writer One",
      personaName: "Persona Alpha",
    });
  });

  it("uses Updated Task ID when task key column is empty", () => {
    const header =
      "Name,Persona Name,Prompt/Task,Rubric,Task Key/ID or Instance ID,Notes/Comments,Updated Task ID";
    const row = 'A,B,"Do work",r,,,updated_only';
    const { rows, errors } = parseWriterPrecheckCsv(`${header}\n${row}`);
    expect(errors).toEqual([]);
    expect(rows[0]?.externalId).toBe("updated_only");
  });
});
