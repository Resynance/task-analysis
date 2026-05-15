import { existsSync, readFileSync } from "node:fs";
import type OpenAI from "openai";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  getUserTaskAuthenticityJsonAbsolute,
  getUserTaskAuthenticityJsonRelative,
} from "@/lib/repo-paths";
import { extractOuterJsonObject } from "@/lib/extract-outer-json-object";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";
import {
  resolveLlmConfig,
  supportsChatJsonObjectResponseFormat,
  type ResolvedLlmConfig,
} from "@/lib/llm-config";

const LLM_TASK_LIMIT = 60;
const LLM_TASK_BATCH_SIZE = 3;
const LLM_TASK_EXCERPT_CHARS = 1200;
const LLM_REVIEW_MAX_TOKENS = 5000;
const LLM_REVIEW_EMPTY_RESPONSE_RETRY_MAX_TOKENS = 8000;
const SHINGLE_SIZE = 5;
const AHT_LLM_NOTE =
  "Optional average handle time. Consider whether a human could write this prompt " +
  "and record the implied actions within this average time.";
const LLM_REVIEW_SYSTEM_PROMPT =
  "You audit task prompts only for risk that they were AI generated before submission. " +
  "Be concise and evidence-first. Do not treat high quality alone as suspicious. " +
  "If AHT is provided, consider whether a human could plausibly write the prompt " +
  "and record the implied actions within that average handle time.";
const LLM_REVIEW_RESPONSE_SHAPE = {
  summary: {
    overall_risk: "low|medium|high",
    rationale: "one sentence about AI-generation likelihood",
    recommendations: ["..."],
  },
  tasks: [
    {
      id: "same id",
      risk: "low|medium|high",
      ai_generated: 0,
      aht_feasibility: "yes|borderline|no|unknown",
      aht_rationale:
        "short note on whether AHT is enough for a human to write/record the prompt actions, or unknown when AHT is absent",
      rationale: "one short sentence",
      ai_generated_rationale:
        "specific short explanation for the AI-generated score, including why it is or is not suspicious",
      ai_generated_evidence: ["short quote or pattern"],
      evidence: ["short item"],
    },
  ],
};
const LLM_REVIEW_USER_INSTRUCTIONS = [
  "Return compact valid JSON only:",
  `${JSON.stringify(LLM_REVIEW_RESPONSE_SHAPE)}.`,
  "Do not use trailing commas.",
  "The ai_generated score must be a number from 0-100.",
  "Keep every rationale under 240 characters.",
].join(" ");
const LLM_REVIEW_RETRY_SUFFIX =
  "Your previous response was empty. Respond with only the compact JSON object. Do not include markdown, prose, hidden reasoning, or an empty message.";

const taskRiskLevelSchema = z.enum(["low", "medium", "high"]);

const llmTaskSchema = z.object({
  id: z.string(),
  risk: taskRiskLevelSchema,
  ai_generated: z.number().min(0).max(100),
  templated: z.number().min(0).max(100),
  similar: z.number().min(0).max(100),
  translated: z.number().min(0).max(100),
  aht_feasibility: z.enum(["yes", "borderline", "no", "unknown"]).default("unknown"),
  aht_rationale: z.string().default(""),
  rationale: z.string(),
  ai_generated_rationale: z.string().default(""),
  ai_generated_evidence: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

const llmReportSchema = z.object({
  summary: z.object({
    overall_risk: taskRiskLevelSchema,
    rationale: z.string(),
    recommendations: z.array(z.string()).default([]),
  }),
  tasks: z.array(llmTaskSchema).default([]),
});

type LlmTask = z.infer<typeof llmTaskSchema>;
type LlmReport = z.infer<typeof llmReportSchema>;
type ModelReport = { model: string; report: LlmReport };

class EmptyLlmResponseError extends Error {
  finishReason: string;

  constructor(finishReason: string) {
    super(
      `No message content from language model after empty-response retry (finish_reason: ${finishReason})`,
    );
    this.name = "EmptyLlmResponseError";
    this.finishReason = finishReason;
  }
}

export type UserTaskAuthenticityLlmReview = LlmTask & {
  model: string;
  modelIndex: number;
};

export type UserTaskAuthenticityInputTask = {
  id: string;
  sourceIndex: number;
  text: string;
  title: string | null;
};

export type UserTaskAuthenticityAht = {
  raw: string;
  seconds: number | null;
};

export type UserTaskAuthenticitySignal = {
  kind: "ai_generated" | "templated" | "similar" | "translated";
  score: number;
  label: string;
  evidence: string[];
};

export type UserTaskAuthenticityTaskResult = {
  id: string;
  sourceIndex: number;
  title: string | null;
  aht: UserTaskAuthenticityAht | null;
  text: string;
  textPreview: string;
  deterministicScore: number;
  risk: "low" | "medium" | "high";
  signals: UserTaskAuthenticitySignal[];
  nearestNeighbor: {
    id: string;
    score: number;
  } | null;
  templateGroupSize: number;
  llm: LlmTask | null;
  llmReviews: UserTaskAuthenticityLlmReview[];
};

export type UserTaskAuthenticityAnalysis = {
  jsonRelativePath: string;
  jsonAbsolutePath: string;
  jsonExists: boolean;
  parseError: string | null;
  runLlm: boolean;
  llmError: string | null;
  llmModel: string | null;
  llmModels: string[];
  llmTaskLimit: number;
  llmSkippedTaskCount: number;
  tasks: UserTaskAuthenticityTaskResult[];
  summary: {
    total: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    withLlm: number;
    averageDeterministicScore: number | null;
    topSignals: Array<{ kind: UserTaskAuthenticitySignal["kind"]; count: number }>;
    llmSummary: LlmReport["summary"] | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function taskTextFromRow(row: Record<string, unknown>): string {
  const primary = stringField(row, [
    "prompt",
    "body",
    "text",
    "task",
    "content",
    "instruction",
    "user_prompt",
    "description",
  ]);
  if (primary) return normalizeText(primary);

  const evalVersion = asRecord(row.eval_task_versions);
  const evalVersionPrompt = evalVersion
    ? stringField(evalVersion, ["prompt", "body", "text", "content"])
    : null;
  if (evalVersionPrompt) return normalizeText(evalVersionPrompt);

  const title = stringField(row, ["title", "name"]);
  const description = stringField(row, ["details", "notes"]);
  return normalizeText([title, description].filter(Boolean).join("\n\n"));
}

function taskIdFromRow(row: Record<string, unknown>, index: number): string {
  return (
    stringField(row, ["id", "key", "task_id", "taskKey", "sourceId", "sourceKey"]) ??
    `row-${index + 1}`
  );
}

function parseAhtSeconds(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  const clock = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const first = Number.parseInt(clock[1]!, 10);
    const second = Number.parseInt(clock[2]!, 10);
    const third = clock[3] ? Number.parseInt(clock[3], 10) : null;
    return third == null ? first * 60 + second : first * 3600 + second * 60 + third;
  }

  const unitMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
  if (unitMatches.length > 0) {
    const seconds = unitMatches.reduce((sum, match) => {
      const value = Number.parseFloat(match[1]!);
      const unit = match[2]!;
      if (unit.startsWith("h")) return sum + value * 3600;
      if (unit.startsWith("m")) return sum + value * 60;
      return sum + value;
    }, 0);
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  }

  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

export function parseUserTaskAuthenticityAht(
  raw: string | null | undefined,
): UserTaskAuthenticityAht | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return {
    raw: trimmed,
    seconds: parseAhtSeconds(trimmed),
  };
}

function parseInputTasks(raw: unknown): UserTaskAuthenticityInputTask[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else {
    const root = asRecord(raw);
    if (Array.isArray(root?.tasks)) {
      rows = root.tasks;
    } else if (Array.isArray(root?.data)) {
      rows = root.data;
    } else if (Array.isArray(root?.rows)) {
      rows = root.rows;
    } else if (Array.isArray(root?.items)) {
      rows = root.items;
    } else if (Array.isArray(root?.records)) {
      rows = root.records;
    }
  }

  return rows
    .map((row, index) => {
      const obj = asRecord(row);
      if (!obj) return null;
      const text = taskTextFromRow(obj);
      if (!text) return null;
      return {
        id: taskIdFromRow(obj, index),
        sourceIndex: index,
        title: stringField(obj, ["title", "name"]),
        text,
      };
    })
    .filter((row): row is UserTaskAuthenticityInputTask => row != null);
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g)
      ?.filter((token) => token.length > 1) ?? []
  );
}

function shingles(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
    out.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function riskFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function clampScore(raw: unknown): number {
  let n = 0;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    n = Number.parseFloat(raw);
  }

  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function riskFromRaw(raw: unknown, fallbackScore: number): LlmTask["risk"] {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (t === "low" || t === "medium" || t === "high") return t;
  return riskFromScore(fallbackScore);
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function textPreview(text: string): string {
  return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
}

function addSignal(
  signals: UserTaskAuthenticitySignal[],
  signal: UserTaskAuthenticitySignal,
): void {
  if (signal.score > 0 || signal.evidence.length > 0) signals.push(signal);
}

const AI_STYLE_PHRASES = [
  "comprehensive",
  "ensure that",
  "make sure to",
  "clear and concise",
  "professional tone",
  "step-by-step",
  "actionable",
  "high quality",
  "robust",
  "polished",
  "detailed analysis",
  "best practices",
];

const TRANSLATION_PHRASES = [
  "kindly",
  "do the needful",
  "as per",
  "revert back",
  "discuss about",
  "make a photo",
  "take a decision",
  "actualize",
];

function scoreAiStyle(text: string): UserTaskAuthenticitySignal {
  const lower = text.toLowerCase();
  const hits = AI_STYLE_PHRASES.filter((phrase) => lower.includes(phrase));
  const semicolonCount = (text.match(/;/g) ?? []).length;
  const listy = (text.match(/\b(first|second|third|finally|additionally)\b/gi) ?? [])
    .length;
  const score = Math.min(100, hits.length * 14 + semicolonCount * 3 + listy * 5);
  return {
    kind: "ai_generated",
    score,
    label: "AI-style phrasing",
    evidence: hits.slice(0, 6).map((hit) => `Contains "${hit}"`),
  };
}

function scoreTranslated(text: string): UserTaskAuthenticitySignal {
  const lower = text.toLowerCase();
  const hits = TRANSLATION_PHRASES.filter((phrase) => lower.includes(phrase));
  const nonAscii = [...text].filter((ch) => ch.charCodeAt(0) > 127).length;
  const ratio = text.length > 0 ? nonAscii / text.length : 0;
  const oddSpacing = (text.match(/\s+[,.!?;:]/g) ?? []).length;
  const score = Math.min(100, hits.length * 22 + (ratio > 0.03 ? 20 : 0) + oddSpacing * 8);
  return {
    kind: "translated",
    score,
    label: "Translation or non-native-English signals",
    evidence: [
      ...hits.slice(0, 5).map((hit) => `Contains "${hit}"`),
      ...(ratio > 0.03 ? [`Non-ASCII character ratio ${(ratio * 100).toFixed(1)}%`] : []),
      ...(oddSpacing > 0 ? [`${oddSpacing} punctuation spacing artifact(s)`] : []),
    ],
  };
}

function templateKey(tokens: string[]): string {
  return tokens
    .slice(0, 18)
    .map((token) => (/^\d+$/.test(token) ? "<n>" : token))
    .join(" ");
}

type SimilarityContext = {
  nearestNeighbor: {
    id: string;
    score: number;
  } | null;
  templateGroupSize: number;
};

function buildSimilarityContext(
  tasks: UserTaskAuthenticityInputTask[],
): SimilarityContext[] {
  const tokenLists = tasks.map((task) => tokenize(task.text));
  const shingleSets = tokenLists.map((tokens) => shingles(tokens));
  const templateGroups = new Map<string, number>();
  for (const tokens of tokenLists) {
    const key = templateKey(tokens);
    if (!key) continue;
    templateGroups.set(key, (templateGroups.get(key) ?? 0) + 1);
  }

  return tasks.map((task, i) => {
    let best: { id: string; score: number } | null = null;
    for (let j = 0; j < tasks.length; j++) {
      if (i === j) continue;
      const score = jaccard(shingleSets[i]!, shingleSets[j]!);
      if (!best || score > best.score) {
        best = { id: tasks[j]!.id, score };
      }
    }
    const groupSize = templateGroups.get(templateKey(tokenLists[i]!)) ?? 1;
    return { nearestNeighbor: best, templateGroupSize: groupSize };
  });
}

function deterministicResults(
  tasks: UserTaskAuthenticityInputTask[],
): UserTaskAuthenticityTaskResult[] {
  const similarity = buildSimilarityContext(tasks);

  return tasks.map((task, index) => {
    const signals: UserTaskAuthenticitySignal[] = [];
    const ai = scoreAiStyle(task.text);
    const translated = scoreTranslated(task.text);
    const near = similarity[index]!.nearestNeighbor;
    const templateGroupSize = similarity[index]!.templateGroupSize;

    addSignal(signals, ai);
    addSignal(signals, translated);
    addSignal(signals, {
      kind: "similar",
      score: near ? Math.round(near.score * 100) : 0,
      label: "Nearest-neighbor similarity",
      evidence:
        near && near.score >= 0.25
          ? [`Most similar to ${near.id} (${Math.round(near.score * 100)}% shingle overlap)`]
          : [],
    });
    addSignal(signals, {
      kind: "templated",
      score: templateGroupSize > 1 ? Math.min(100, 30 + templateGroupSize * 15) : 0,
      label: "Shared opening/template structure",
      evidence:
        templateGroupSize > 1
          ? [`Shares opening structure with ${templateGroupSize - 1} other task(s)`]
          : [],
    });

    const score = Math.min(
      100,
      Math.round(
        signals.reduce((sum, signal) => sum + signal.score, 0) / Math.max(1, signals.length),
      ),
    );

    return {
      id: task.id,
      sourceIndex: task.sourceIndex,
      title: task.title,
      aht: null,
      text: task.text,
      textPreview: textPreview(task.text),
      deterministicScore: score,
      risk: riskFromScore(score),
      signals,
      nearestNeighbor: near ? { id: near.id, score: Math.round(near.score * 100) } : null,
      templateGroupSize,
      llm: null,
      llmReviews: [],
    };
  });
}

function summarize(tasks: UserTaskAuthenticityTaskResult[]): UserTaskAuthenticityAnalysis["summary"] {
  const total = tasks.length;
  const highRisk = tasks.filter((task) => task.risk === "high").length;
  const mediumRisk = tasks.filter((task) => task.risk === "medium").length;
  const lowRisk = tasks.filter((task) => task.risk === "low").length;
  const avg =
    total > 0
      ? Math.round(
          (tasks.reduce((sum, task) => sum + task.deterministicScore, 0) / total) * 10,
        ) / 10
      : null;
  const signalCounts = new Map<UserTaskAuthenticitySignal["kind"], number>();
  for (const task of tasks) {
    for (const signal of task.signals) {
      if (signal.score >= 40) {
        signalCounts.set(signal.kind, (signalCounts.get(signal.kind) ?? 0) + 1);
      }
    }
  }
  return {
    total,
    highRisk,
    mediumRisk,
    lowRisk,
    withLlm: tasks.filter((task) => task.llm != null).length,
    averageDeterministicScore: avg,
    topSignals: [...signalCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    llmSummary: null,
  };
}

async function runLlmReview(
  prisma: PrismaClient,
  tasks: UserTaskAuthenticityTaskResult[],
  models: string[] | undefined,
  aht: UserTaskAuthenticityAht | null,
): Promise<{
  report: LlmReport;
  modelReports: ModelReport[];
  models: string[];
}> {
  const cfg = await resolveLlmConfig(prisma);
  const modelIds = normalizeReviewModels(models, getChatModel(cfg));
  const modelReports: ModelReport[] = [];

  for (const [modelIndex, model] of modelIds.entries()) {
    const label = `Model ${String.fromCharCode(65 + modelIndex)}`;
    let report: LlmReport;
    try {
      report = await runSingleModelReview(cfg, model, tasks, aht);
    } catch (error) {
      throw new Error(
        `${label} (${model}) failed: ${formatLlmError(error)}`,
      );
    }
    modelReports.push({
      model,
      report,
    });
  }

  const reviewsByTaskId = buildReviewsByTaskId(modelReports);

  const consensusTasks = tasks
    .map((task) => buildConsensusTask(task.id, reviewsByTaskId.get(task.id) ?? []))
    .filter((task): task is LlmTask => task != null);

  return {
    report: {
      summary: mergeLlmSummaries(
        consensusTasks,
        modelReports.map(({ report }) => report.summary),
      ),
      tasks: consensusTasks,
    },
    modelReports,
    models: modelIds,
  };
}

function normalizeReviewModels(
  models: string[] | undefined,
  fallbackModel: string,
): string[] {
  const normalized = (models ?? [])
    .map((model) => model.trim())
    .filter(Boolean)
    .slice(0, 3);
  const reviewModels =
    normalized.length > 0 ? [...normalized] : [fallbackModel, fallbackModel, fallbackModel];
  while (reviewModels.length < 3) reviewModels.push(fallbackModel);
  return reviewModels;
}

async function runSingleModelReview(
  cfg: ResolvedLlmConfig,
  model: string,
  tasks: UserTaskAuthenticityTaskResult[],
  aht: UserTaskAuthenticityAht | null,
): Promise<LlmReport> {
  const selectedTasks = tasks.slice(0, LLM_TASK_LIMIT);
  const reports: LlmReport[] = [];

  for (let i = 0; i < selectedTasks.length; i += LLM_TASK_BATCH_SIZE) {
    const batch = selectedTasks.slice(i, i + LLM_TASK_BATCH_SIZE);
    try {
      reports.push(await runLlmReviewBatch(cfg, model, batch, aht));
    } catch (error) {
      if (
        error instanceof EmptyLlmResponseError &&
        error.finishReason !== "length"
      ) {
        throw error;
      }
      if (batch.length === 1) throw error;
      for (const task of batch) {
        reports.push(await runLlmReviewBatch(cfg, model, [task], aht));
      }
    }
  }

  const llmTasks = reports.flatMap((report) => report.tasks);
  return {
    summary: mergeLlmSummaries(
      llmTasks,
      reports.map((report) => report.summary),
    ),
    tasks: llmTasks,
  };
}

async function runLlmReviewBatch(
  cfg: ResolvedLlmConfig,
  model: string,
  tasks: UserTaskAuthenticityTaskResult[],
  aht: UserTaskAuthenticityAht | null,
): Promise<LlmReport> {
  const reviewTasks = tasks.map((task) => ({
    id: task.id,
    aht: aht
      ? {
          raw: aht.raw,
          seconds: aht.seconds,
          note: AHT_LLM_NOTE,
        }
      : null,
    deterministicScore: task.deterministicScore,
    deterministicSignals: task.signals
      .filter((signal) => signal.kind === "ai_generated")
      .map((signal) => ({
        kind: signal.kind,
        score: signal.score,
        evidence: signal.evidence,
      })),
    text: task.text.slice(0, LLM_TASK_EXCERPT_CHARS),
  }));

  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: 0.1,
    max_tokens: LLM_REVIEW_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: LLM_REVIEW_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions: LLM_REVIEW_USER_INSTRUCTIONS,
          tasks: reviewTasks,
        }),
      },
    ],
  };
  let completion = await createAuthReviewCompletion(cfg, params);
  let raw = completionText(completion);
  if (!raw) {
    completion = await createAuthReviewCompletion(
      cfg,
      retryParamsForEmptyResponse(params),
    );
    raw = completionText(completion);
  }
  if (!raw) {
    const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
    throw new EmptyLlmResponseError(finishReason);
  }
  const parsed = parseModelJsonObject(raw);
  return llmReportSchema.parse(normalizeLlmReport(parsed));
}

function completionText(completion: OpenAI.Chat.ChatCompletion): string {
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

function retryParamsForEmptyResponse(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  return {
    ...params,
    max_tokens: LLM_REVIEW_EMPTY_RESPONSE_RETRY_MAX_TOKENS,
    messages: [
      ...params.messages,
      {
        role: "user",
        content: LLM_REVIEW_RETRY_SUFFIX,
      },
    ],
  };
}

function parseModelJsonObject(raw: string): unknown {
  const json = extractOuterJsonObject(raw);
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    try {
      return JSON.parse(stripTrailingJsonCommas(json)) as unknown;
    } catch {
      throw error;
    }
  }
}

function stripTrailingJsonCommas(json: string): string {
  let repaired = "";
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < json.length; index++) {
    const char = json[index]!;
    if (inString) {
      repaired += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      repaired += char;
      continue;
    }

    if (char === "," && isTrailingJsonComma(json, index)) {
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function isTrailingJsonComma(json: string, commaIndex: number): boolean {
  let nextIndex = commaIndex + 1;
  while (/\s/.test(json[nextIndex] ?? "")) nextIndex++;
  return json[nextIndex] === "]" || json[nextIndex] === "}";
}

async function createAuthReviewCompletion(
  cfg: ResolvedLlmConfig,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const supportsJsonMode = supportsChatJsonObjectResponseFormat(cfg);
  if (!supportsJsonMode) {
    return chatCompletionCreateAudited(
      cfg,
      "user-task-authenticity-analysis",
      params,
    );
  }

  try {
    return await chatCompletionCreateAudited(
      cfg,
      "user-task-authenticity-analysis",
      {
        ...params,
        response_format: { type: "json_object" },
      },
    );
  } catch (error) {
    if (!shouldRetryWithoutResponseFormat(error)) throw error;
    return chatCompletionCreateAudited(
      cfg,
      "user-task-authenticity-analysis",
      params,
    );
  }
}

function shouldRetryWithoutResponseFormat(error: unknown): boolean {
  return getErrorStatus(error) === 400;
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, statusCode } = error as {
    status?: unknown;
    statusCode?: unknown;
  };
  if (typeof status === "number") return status;
  if (typeof statusCode === "number") return statusCode;
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatLlmError(error: unknown): string {
  if (!(error instanceof Error)) return "LLM review failed";

  const maybeError = error as Error & {
    error?: { message?: unknown };
    response?: { data?: { error?: { message?: unknown }; message?: unknown } };
  };
  const details =
    nonEmptyString(maybeError.error?.message) ??
    nonEmptyString(maybeError.response?.data?.error?.message) ??
    nonEmptyString(maybeError.response?.data?.message) ??
    error.message;
  const status = getErrorStatus(error);
  return status ? `${status} ${details}` : details;
}

function mergeLlmSummaries(
  tasks: LlmTask[],
  summaries: LlmReport["summary"][],
): LlmReport["summary"] {
  const maxScore = tasks.reduce(
    (max, task) => Math.max(max, task.ai_generated),
    0,
  );
  const recommendations = [
    ...new Set(summaries.flatMap((summary) => summary.recommendations)),
  ];
  const rationales = summaries
    .map((summary) => summary.rationale.trim())
    .filter(Boolean);

  return {
    overall_risk: riskFromScore(maxScore),
    rationale:
      rationales.length > 0
        ? rationales.join(" ")
        : `LLM review completed for ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
    recommendations,
  };
}

function medianScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = scores.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function buildConsensusTask(
  id: string,
  reviews: UserTaskAuthenticityLlmReview[],
): LlmTask | null {
  if (reviews.length === 0) return null;

  const scores = reviews.map((review) => review.ai_generated);
  const score = medianScore(scores);
  const highVotes = scores.filter((n) => n >= 70).length;
  const scoreList = scores.map((n) => Math.round(n)).join(", ");

  return {
    id,
    risk: riskFromScore(score),
    ai_generated: score,
    templated: 0,
    similar: 0,
    translated: 0,
    aht_feasibility: consensusAhtFeasibility(reviews),
    aht_rationale: consensusAhtRationale(reviews),
    rationale: `Consensus median score ${score} from ${reviews.length} model${reviews.length === 1 ? "" : "s"} (${scoreList}).`,
    ai_generated_rationale: `${highVotes}/${reviews.length} model${reviews.length === 1 ? "" : "s"} rated this task as high-probability AI-generated.`,
    ai_generated_evidence: [],
    evidence: [],
  };
}

function consensusAhtFeasibility(
  reviews: UserTaskAuthenticityLlmReview[],
): LlmTask["aht_feasibility"] {
  const votes = reviews
    .map((review) => review.aht_feasibility)
    .filter((vote) => vote !== "unknown");
  if (votes.length === 0) return "unknown";
  const counts = new Map<LlmTask["aht_feasibility"], number>();
  for (const vote of votes) {
    counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function consensusAhtRationale(reviews: UserTaskAuthenticityLlmReview[]): string {
  const notes = reviews
    .map((review) => review.aht_rationale.trim())
    .filter(Boolean);
  return notes.length > 0 ? notes.join(" ") : "";
}

function buildReviewsByTaskId(
  modelReports: ModelReport[],
): Map<string, UserTaskAuthenticityLlmReview[]> {
  const reviewsByTaskId = new Map<string, UserTaskAuthenticityLlmReview[]>();

  modelReports.forEach(({ model, report }, modelIndex) => {
    for (const task of report.tasks) {
      const reviews = reviewsByTaskId.get(task.id) ?? [];
      reviews.push({ ...task, model, modelIndex });
      reviewsByTaskId.set(task.id, reviews);
    }
  });

  return reviewsByTaskId;
}

function pickScore(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (row[key] != null) {
      const nested = asRecord(row[key]);
      return nested ? clampScore(nested.score) : clampScore(row[key]);
    }
  }
  const nested = asRecord(row.scores) ?? asRecord(row.categories);
  if (nested) {
    for (const key of keys) {
      if (nested[key] != null) return clampScore(nested[key]);
    }
  }
  return 0;
}

function pickCategoryObject(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const direct = asRecord(row[key]);
    if (direct) return direct;
  }
  const nested = asRecord(row.scores) ?? asRecord(row.categories);
  if (nested) {
    for (const key of keys) {
      const direct = asRecord(nested[key]);
      if (direct) return direct;
    }
  }
  return null;
}

function pickAiGeneratedEvidence(
  row: Record<string, unknown>,
  aiObj: Record<string, unknown> | null,
): string[] {
  const explicitEvidence = stringList(row.ai_generated_evidence);
  if (explicitEvidence.length > 0) return explicitEvidence;

  const legacyEvidence = stringList(row.ai_evidence);
  if (legacyEvidence.length > 0) return legacyEvidence;

  return aiObj ? stringList(aiObj.evidence) : [];
}

function normalizeLlmTask(raw: unknown, index: number): LlmTask | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = stringField(row, ["id", "task_id", "taskId", "key"]) ?? `row-${index + 1}`;
  const aiKeys = ["ai_generated", "ai_generated_score", "ai", "aiGenerated"];
  const aiObj = pickCategoryObject(row, aiKeys);
  const ai = pickScore(row, aiKeys);
  const templated = pickScore(row, ["templated", "template", "template_score"]);
  const similar = pickScore(row, ["similar", "similarity", "similarity_score", "copied"]);
  const translated = pickScore(row, [
    "translated",
    "translation",
    "translated_score",
    "non_english_translation",
  ]);
  const maxScore = Math.max(ai, templated, similar, translated);
  return {
    id,
    risk: riskFromRaw(row.risk ?? row.overall_risk, maxScore),
    ai_generated: ai,
    templated,
    similar,
    translated,
    aht_feasibility: riskFromAhtRaw(row.aht_feasibility),
    aht_rationale:
      stringField(row, ["aht_rationale", "aht_reasoning", "aht_explanation"]) ?? "",
    rationale:
      stringField(row, ["rationale", "reasoning", "summary", "explanation"]) ??
      "No rationale returned.",
    ai_generated_rationale:
      stringField(row, [
        "ai_generated_rationale",
        "ai_rationale",
        "ai_generated_reasoning",
        "ai_reasoning",
      ]) ??
      (aiObj
        ? stringField(aiObj, ["rationale", "reasoning", "summary", "explanation"])
        : null) ??
      "",
    ai_generated_evidence: pickAiGeneratedEvidence(row, aiObj),
    evidence: stringList(row.evidence),
  };
}

function riskFromAhtRaw(raw: unknown): LlmTask["aht_feasibility"] {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (t === "yes" || t === "borderline" || t === "no" || t === "unknown") return t;
  return "unknown";
}

function normalizeLlmReport(raw: unknown): LlmReport {
  const root = asRecord(raw) ?? {};
  const summaryRaw = root.summary;
  const summaryObj = asRecord(summaryRaw);
  const tasks = Array.isArray(root.tasks)
    ? root.tasks
        .map((task, index) => normalizeLlmTask(task, index))
        .filter((task): task is LlmTask => task != null)
    : [];
  const maxScore = tasks.reduce(
    (max, task) =>
      Math.max(max, task.ai_generated, task.templated, task.similar, task.translated),
    0,
  );

  return {
    summary: {
      overall_risk: riskFromRaw(
        summaryObj?.overall_risk ?? summaryObj?.risk ?? root.overall_risk ?? root.risk,
        maxScore,
      ),
      rationale:
        (typeof summaryRaw === "string" && summaryRaw.trim()) ||
        (summaryObj
          ? stringField(summaryObj, ["rationale", "summary", "reasoning", "explanation"])
          : null) ||
        "LLM review completed.",
      recommendations: summaryObj ? stringList(summaryObj.recommendations) : [],
    },
    tasks,
  };
}

export async function analyzeUserTaskAuthenticity(
  prisma: PrismaClient,
  opts: { runLlm: boolean; models?: string[]; aht?: string | null },
): Promise<UserTaskAuthenticityAnalysis> {
  const jsonRelativePath = getUserTaskAuthenticityJsonRelative();
  const jsonAbsolutePath = getUserTaskAuthenticityJsonAbsolute();
  const jsonExists = existsSync(jsonAbsolutePath);
  let parseError: string | null = null;
  let inputTasks: UserTaskAuthenticityInputTask[] = [];

  if (jsonExists) {
    try {
      const raw = JSON.parse(readFileSync(jsonAbsolutePath, "utf8")) as unknown;
      inputTasks = parseInputTasks(raw);
    } catch (e) {
      parseError = e instanceof Error ? e.message : "Failed to parse JSON";
    }
  }

  let tasks = deterministicResults(inputTasks);
  let llmError: string | null = null;
  let llmModel: string | null = null;
  let llmModels: string[] = [];
  let llmSummary: UserTaskAuthenticityAnalysis["summary"]["llmSummary"] = null;
  const reviewAht = parseUserTaskAuthenticityAht(opts.aht);

  if (opts.runLlm && tasks.length > 0 && !parseError) {
    try {
      const { report, models, modelReports } = await runLlmReview(
        prisma,
        tasks,
        opts.models,
        reviewAht,
      );
      llmModels = models;
      llmModel = models.join(", ");
      llmSummary = report.summary;
      const byId = new Map(report.tasks.map((task) => [task.id, task] as const));
      const reviewsById = buildReviewsByTaskId(modelReports);
      tasks = tasks.map((task) => {
        const llm = byId.get(task.id) ?? null;
        return {
          ...task,
          aht: reviewAht,
          llm,
          llmReviews: reviewsById.get(task.id) ?? [],
          risk: llm?.risk ?? task.risk,
        };
      });
    } catch (e) {
      llmError = e instanceof Error ? e.message : "LLM review failed";
    }
  }

  return {
    jsonRelativePath,
    jsonAbsolutePath,
    jsonExists,
    parseError,
    runLlm: opts.runLlm,
    llmError,
    llmModel,
    llmModels,
    llmTaskLimit: LLM_TASK_LIMIT,
    llmSkippedTaskCount: Math.max(0, tasks.length - LLM_TASK_LIMIT),
    tasks,
    summary: {
      ...summarize(tasks),
      llmSummary,
    },
  };
}
