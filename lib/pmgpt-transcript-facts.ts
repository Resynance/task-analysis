import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  extractTaskPromptFromTranscript,
  getPmgptFailureAnalysisRoot,
  isSafeTaskDirName,
} from "@/lib/pmgpt-failure-analysis";

type Msg = {
  role?: string;
  content?: string | null;
  created_at?: string;
  position?: number;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }> | null;
};

function parseMessages(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object") as Msg[];
}

function orderedMessages(raw: unknown): Msg[] {
  const arr = parseMessages(raw);
  return [...arr].sort((a, b) => {
    const pa = typeof a.position === "number" ? a.position : Number.NaN;
    const pb = typeof b.position === "number" ? b.position : Number.NaN;
    if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
    const ta = Date.parse(String(a.created_at ?? ""));
    const tb = Date.parse(String(b.created_at ?? ""));
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return 0;
  });
}

type CalendarRow = {
  id?: number | string;
  name?: string;
  isDefaultCalendar?: boolean;
};

function parseCalendarListJson(content: string): CalendarRow[] | null {
  const t = content.trim();
  if (!t.startsWith("[")) return null;
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr.filter((x) => x && typeof x === "object") as CalendarRow[];
  } catch {
    return null;
  }
}

export type OutlookCalendarFacts = {
  /** Numeric id string → display name from latest list_calendars */
  idToName: Record<string, string>;
  defaultCalendarId: string | null;
  /** calendarId passed to outlook__create_calendar_event (in order) */
  createEventCalendarIds: string[];
  /** Flattened ids from outlook__list_calendar_events calendarIds arrays */
  listEventsCalendarIds: string[];
  /** outlook__move_calendar_event, outlook__update_calendar_event if present */
  otherCalendarIdUses: { tool: string; calendarId: string }[];
};

function emptyOutlookFacts(): OutlookCalendarFacts {
  return {
    idToName: {},
    defaultCalendarId: null,
    createEventCalendarIds: [],
    listEventsCalendarIds: [],
    otherCalendarIdUses: [],
  };
}

function mergeCalendarRows(
  facts: OutlookCalendarFacts,
  rows: CalendarRow[],
): void {
  for (const r of rows) {
    if (r.id == null || typeof r.name !== "string") continue;
    const id = String(r.id);
    facts.idToName[id] = r.name;
    if (r.isDefaultCalendar === true) {
      facts.defaultCalendarId = id;
    }
  }
}

/**
 * Deterministic extraction from a single run transcript: Outlook calendar id↔name
 * from tool results, and calendar ids used in write calls.
 */
export function extractOutlookCalendarFactsFromTranscript(
  raw: unknown,
): OutlookCalendarFacts {
  const facts = emptyOutlookFacts();
  const callMeta = new Map<
    string,
    { name: string; arguments: Record<string, unknown> }
  >();

  for (const m of orderedMessages(raw)) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const id = typeof tc.id === "string" ? tc.id : "";
        const name = tc.function?.name ?? "";
        if (!id) continue;
        let args: Record<string, unknown> = {};
        const rawArgs = tc.function?.arguments;
        if (typeof rawArgs === "string" && rawArgs.length > 0) {
          try {
            args = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            args = {};
          }
        }
        callMeta.set(id, { name, arguments: args });
      }
    }

    if (m.role !== "tool" || typeof m.tool_call_id !== "string") continue;
    const meta = callMeta.get(m.tool_call_id);
    const content = typeof m.content === "string" ? m.content : "";
    if (!meta) continue;

    if (meta.name === "outlook__list_calendars") {
      const rows = parseCalendarListJson(content);
      if (rows) mergeCalendarRows(facts, rows);
    }

    if (meta.name === "outlook__create_calendar_event") {
      const cid = meta.arguments.calendarId;
      if (cid != null) facts.createEventCalendarIds.push(String(cid));
    }

    if (meta.name === "outlook__list_calendar_events") {
      const ids = meta.arguments.calendarIds;
      if (Array.isArray(ids)) {
        for (const x of ids) facts.listEventsCalendarIds.push(String(x));
      }
    }

    if (
      meta.name === "outlook__update_calendar_event" ||
      meta.name === "outlook__move_calendar_event"
    ) {
      const cid = meta.arguments.calendarId;
      if (cid != null) {
        facts.otherCalendarIdUses.push({
          tool: meta.name,
          calendarId: String(cid),
        });
      }
    }
  }

  return facts;
}

export type PromptCalendarHints = {
  mentionsWorkCalendar: boolean;
  mentionsDefaultCalendar: boolean;
  mentionsTeamCalendar: boolean;
  mentionsPersonalCalendar: boolean;
};

export function extractPromptCalendarHints(
  prompt: string | null,
): PromptCalendarHints {
  const p = (prompt ?? "").toLowerCase();
  return {
    mentionsWorkCalendar: /\bwork\s+calendar\b/i.test(prompt ?? ""),
    mentionsDefaultCalendar: /\bdefault\s+calendar\b/i.test(p),
    mentionsTeamCalendar: /\bteam\s+calendar\b/i.test(p),
    mentionsPersonalCalendar: /\bpersonal\s+calendar\b/i.test(p),
  };
}

export type VerifierCalendarMismatch = {
  expectedCalendarId: string;
  actualCalendarId: string;
  sourceLines: string[];
};

function collectStdoutFromVerifierRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const ex = (raw as { executions?: unknown }).executions;
  if (!Array.isArray(ex)) return [];
  const out: string[] = [];
  for (const item of ex) {
    if (!item || typeof item !== "object") continue;
    const e = item as {
      stdout?: string;
      result?: { stdout?: string };
    };
    const nested =
      e.result &&
      typeof e.result === "object" &&
      typeof e.result.stdout === "string"
        ? e.result.stdout
        : "";
    const top = typeof e.stdout === "string" ? e.stdout : "";
    const combined = nested.length >= top.length ? nested : top;
    if (combined.length > 0) out.push(combined);
  }
  return out;
}

/**
 * Pull numeric calendar expected/got pairs from verifier stdout (Outlook grading).
 */
export function extractCalendarMismatchesFromVerifierStdout(
  stdout: string,
): VerifierCalendarMismatch[] {
  const patterns: RegExp[] = [
    /Event should be in calendar (\d+), got: (\d+)/gi,
    /field ['"]calendarId['"]:\s*expected (\d+), got (\d+)/gi,
    /calendarId['"]?\s*:\s*expected (\d+),\s*got (\d+)/gi,
  ];
  const seen = new Set<string>();
  const merged: VerifierCalendarMismatch[] = [];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
      const exp = m[1];
      const got = m[2];
      const key = `${exp}|${got}|${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        expectedCalendarId: exp,
        actualCalendarId: got,
        sourceLines: [m[0].trim()],
      });
    }
  }

  return merged;
}

function mergeVerifierMismatches(stdouts: string[]): VerifierCalendarMismatch[] {
  const all: VerifierCalendarMismatch[] = [];
  for (const s of stdouts) {
    all.push(...extractCalendarMismatchesFromVerifierStdout(s));
  }
  const byPair = new Map<string, VerifierCalendarMismatch>();
  for (const m of all) {
    const k = `${m.expectedCalendarId}->${m.actualCalendarId}`;
    const prev = byPair.get(k);
    if (!prev) {
      byPair.set(k, { ...m, sourceLines: [...m.sourceLines] });
    } else {
      const seen = new Set(prev.sourceLines);
      for (const sl of m.sourceLines) {
        if (!seen.has(sl)) {
          seen.add(sl);
          prev.sourceLines.push(sl);
        }
      }
    }
  }
  return [...byPair.values()];
}

export type CalendarAlignmentNote =
  | {
      kind: "no_create_call";
      summary: string;
    }
  | {
      kind: "no_verifier_mismatch";
      summary: string;
    }
  | {
      kind: "verifier_agent_numbers_agree";
      summary: string;
    }
  | {
      kind: "verifier_numbers_agree_transcript_differs";
      summary: string;
    }
  | {
      kind: "verifier_vs_transcript";
      summary: string;
      suggestedInterpretation: string;
    };

export function buildCalendarAlignmentNote(
  outlook: OutlookCalendarFacts,
  verifierMismatches: VerifierCalendarMismatch[],
  hints: PromptCalendarHints,
  taskPrompt: string | null,
): CalendarAlignmentNote {
  const lastCreate =
    outlook.createEventCalendarIds[outlook.createEventCalendarIds.length - 1] ??
    null;

  if (!lastCreate) {
    return {
      kind: "no_create_call",
      summary:
        "No `outlook__create_calendar_event` tool call found in this transcript.",
    };
  }

  const agentName =
    outlook.idToName[lastCreate] ??
    `(no list_calendars name for id ${lastCreate})`;

  if (verifierMismatches.length === 0) {
    return {
      kind: "no_verifier_mismatch",
      summary: `Agent created event on calendar id **${lastCreate}** (${agentName}). No calendar expected/got lines were parsed from verifier stdout (or no verifier file).`,
    };
  }

  const vm = verifierMismatches[0];
  const expName =
    outlook.idToName[vm.expectedCalendarId] ??
    `id ${vm.expectedCalendarId}`;
  const gotName =
    outlook.idToName[vm.actualCalendarId] ??
    `id ${vm.actualCalendarId}`;

  if (
    vm.expectedCalendarId === vm.actualCalendarId &&
    vm.actualCalendarId === lastCreate
  ) {
    return {
      kind: "verifier_agent_numbers_agree",
      summary: `Verifier and transcript both align on calendar id **${lastCreate}** (${gotName}).`,
    };
  }

  if (
    vm.expectedCalendarId !== vm.actualCalendarId &&
    vm.actualCalendarId === lastCreate
  ) {
    let interpretation =
      "Verifier expected a different calendar id than the one recorded in the agent’s create call; the **got** side matches the transcript’s `calendarId`.";
    if (
      hints.mentionsWorkCalendar &&
      agentName.toLowerCase().includes("work")
    ) {
      interpretation +=
        " The prompt mentions a **work calendar**, and the transcript maps this id to that name — **compare verifier expectations to the written scenario** (grading may assume default calendar id `1` while the scenario asks for Work Calendar).";
    } else if (
      hints.mentionsDefaultCalendar &&
      vm.expectedCalendarId === outlook.defaultCalendarId
    ) {
      interpretation +=
        " The prompt mentions a **default calendar** and the verifier expects the default id — if the agent chose another id, that may be an agent error; if the scenario names a non-default calendar, treat as **scenario vs verifier** tension.";
    }

    const promptEcho =
      taskPrompt && taskPrompt.length > 0
        ? `\n\n**Task prompt excerpt (first 400 chars):**\n\n\`\`\`\n${taskPrompt.slice(0, 400)}${taskPrompt.length > 400 ? "…" : ""}\n\`\`\``
        : "";

    return {
      kind: "verifier_vs_transcript",
      summary: `Verifier lines imply **expected ${vm.expectedCalendarId}** (${expName}) vs **got ${vm.actualCalendarId}** (${gotName}). Transcript’s last create uses **${lastCreate}** → **${agentName}**.`,
      suggestedInterpretation: `${interpretation}${promptEcho}`,
    };
  }

  if (
    lastCreate !== vm.actualCalendarId &&
    lastCreate !== vm.expectedCalendarId
  ) {
    return {
      kind: "verifier_numbers_agree_transcript_differs",
      summary:
        `Parsed verifier mismatch (${vm.expectedCalendarId} vs ${vm.actualCalendarId}) does not match the last create_calendar_event id **${lastCreate}** — re-check pairing or multiple events.`,
    };
  }

  return {
    kind: "verifier_vs_transcript",
    summary: `Verifier: expected **${vm.expectedCalendarId}** (${expName}), got **${vm.actualCalendarId}** (${gotName}). Agent last create: **${lastCreate}** (${agentName}).`,
    suggestedInterpretation:
      "Compare verifier rules to tool transcript and prompt; ambiguous multi-event runs may need manual review.",
  };
}

export type RunTranscriptFacts = {
  runName: string;
  outlook: OutlookCalendarFacts;
  hints: PromptCalendarHints;
  taskPrompt: string | null;
  verifierMismatches: VerifierCalendarMismatch[];
  alignment: CalendarAlignmentNote;
};

export async function analyzeTaskTranscriptFacts(
  taskId: string,
): Promise<{ ok: true; runs: RunTranscriptFacts[] } | { ok: false; error: string }> {
  if (!isSafeTaskDirName(taskId)) {
    return { ok: false, error: "Invalid task id." };
  }
  const root = getPmgptFailureAnalysisRoot();
  const taskDir = path.join(root, taskId);
  if (!existsSync(taskDir)) {
    return { ok: false, error: "Task folder not found." };
  }

  const files = await readdir(taskDir);
  const runFiles = files
    .filter((f) => /^run\d+\.json$/i.test(f))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const nb = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return na - nb;
    });

  const runs: RunTranscriptFacts[] = [];
  let sharedPrompt: string | null = null;
  if (runFiles[0]) {
    try {
      const raw = JSON.parse(
        await readFile(path.join(taskDir, runFiles[0]), "utf8"),
      ) as unknown;
      sharedPrompt = extractTaskPromptFromTranscript(raw);
    } catch {
      sharedPrompt = null;
    }
  }

  for (const rf of runFiles) {
    const runBase = rf.replace(/\.json$/i, "");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(taskDir, rf), "utf8"));
    } catch {
      continue;
    }
    const prompt = extractTaskPromptFromTranscript(raw) ?? sharedPrompt;
    const hints = extractPromptCalendarHints(prompt);
    const outlook = extractOutlookCalendarFactsFromTranscript(raw);

    let verifierRaw: unknown | null = null;
    const vp = path.join(taskDir, `${runBase}-verifier.json`);
    if (existsSync(vp)) {
      try {
        verifierRaw = JSON.parse(await readFile(vp, "utf8"));
      } catch {
        verifierRaw = null;
      }
    }
    const stdouts = verifierRaw
      ? collectStdoutFromVerifierRaw(verifierRaw)
      : [];
    const verifierMismatches = mergeVerifierMismatches(stdouts);

    const alignment = buildCalendarAlignmentNote(
      outlook,
      verifierMismatches,
      hints,
      prompt,
    );

    runs.push({
      runName: runBase,
      outlook,
      hints,
      taskPrompt: prompt,
      verifierMismatches,
      alignment,
    });
  }

  return { ok: true, runs };
}

function formatHints(h: PromptCalendarHints): string {
  const parts: string[] = [];
  if (h.mentionsWorkCalendar) parts.push("work calendar");
  if (h.mentionsDefaultCalendar) parts.push("default calendar");
  if (h.mentionsTeamCalendar) parts.push("team calendar");
  if (h.mentionsPersonalCalendar) parts.push("personal calendar");
  return parts.length > 0 ? parts.join(", ") : "(none detected)";
}

export function transcriptFactsToMarkdown(
  taskId: string,
  runs: RunTranscriptFacts[],
): string {
  const lines: string[] = [];
  lines.push(`# Transcript facts — \`${taskId}\``);
  lines.push("");
  lines.push(
    "Deterministic checks from **run JSON** (Outlook tool arguments + `list_calendars` results) and optional **`runN-verifier.json`** stdout. Use this to see whether the agent’s numeric `calendarId` matches named calendars from the simulator and how that compares to verifier expected/got lines — **without relying on an LLM summary**.",
  );
  lines.push("");

  if (runs.length === 0) {
    lines.push("_No run transcripts found._");
    return lines.join("\n");
  }

  for (const r of runs) {
    lines.push(`## ${r.runName}`);
    lines.push("");
    lines.push("### Prompt keywords (calendar)");
    lines.push("");
    lines.push(`- Detected: **${formatHints(r.hints)}**`);
    lines.push("");

    lines.push("### Outlook calendar ids from transcript");
    lines.push("");
    const ids = Object.keys(r.outlook.idToName).sort(
      (a, b) => Number(a) - Number(b),
    );
    if (ids.length === 0) {
      lines.push("- No `outlook__list_calendars` JSON parsed.");
    } else {
      lines.push("| id | name |");
      lines.push("| --- | --- |");
      for (const id of ids) {
        lines.push(`| ${id} | ${r.outlook.idToName[id]} |`);
      }
      if (r.outlook.defaultCalendarId) {
        lines.push("");
        lines.push(
          `- Default flag: **${r.outlook.defaultCalendarId}** → ${r.outlook.idToName[r.outlook.defaultCalendarId] ?? "?"}`,
        );
      }
    }
    lines.push("");
    lines.push(
      `- **create_calendar_event** \`calendarId\` sequence: ${r.outlook.createEventCalendarIds.length > 0 ? r.outlook.createEventCalendarIds.map((x) => `\`${x}\``).join(", ") : "—"}`,
    );
    lines.push(
      `- **list_calendar_events** \`calendarIds\`: ${r.outlook.listEventsCalendarIds.length > 0 ? [...new Set(r.outlook.listEventsCalendarIds)].map((x) => `\`${x}\``).join(", ") : "—"}`,
    );
    if (r.outlook.otherCalendarIdUses.length > 0) {
      lines.push(
        `- Other tools: ${r.outlook.otherCalendarIdUses.map((u) => `\`${u.tool}\` → ${u.calendarId}`).join("; ")}`,
      );
    }
    lines.push("");

    lines.push("### Verifier (parsed)");
    lines.push("");
    if (r.verifierMismatches.length === 0) {
      lines.push(
        "- No `expected … got …` calendar lines parsed (missing file or different wording).",
      );
    } else {
      for (const v of r.verifierMismatches) {
        lines.push(
          `- Expected **${v.expectedCalendarId}**, got **${v.actualCalendarId}**`,
        );
        for (const sl of v.sourceLines.slice(0, 3)) {
          lines.push(`  - \`${sl.replace(/`/g, "'")}\``);
        }
      }
    }
    lines.push("");

    lines.push("### Alignment note");
    lines.push("");
    lines.push(`_(${r.alignment.kind})_`);
    lines.push("");
    lines.push(r.alignment.summary);
    if (r.alignment.kind === "verifier_vs_transcript") {
      lines.push("");
      lines.push(r.alignment.suggestedInterpretation);
    }
    lines.push("");
  }

  return lines.join("\n");
}
