import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { PromptScore } from "@/generated/prisma/enums";
import { getDatasetImportedTasksGuidelineId } from "@/lib/guideline-scope";
import { filterRowsByEnv } from "@/lib/filter-prompts-by-env";
import { filterRowsByProject } from "@/lib/filter-prompts-by-project";
import { chatCompletionCreateAudited, getChatModel } from "@/lib/llm";
import type { ResolvedLlmConfig } from "@/lib/llm-config";
import {
  type EnvFilter,
  getEnvFilterShortLabel,
  getEnvironmentLabel,
} from "@/lib/task-environment";
import {
  getProjectFilterShortLabel,
  type ProjectFilter,
  UNASSIGNED_PROJECT_QUERY,
} from "@/lib/task-project";
import { taskLifecycleEligibleForLlmAnalysis } from "@/lib/task-lifecycle";

/**
 * Dataset QA: pick stratified prompt samples (by score tier and filters), call the LLM with a
 * human-authored question, and persist answers for reporting. Caps body length per tier to control
 * cost and context size.
 */
export const MAX_DATASET_QA_QUESTION_CHARS = 4000;
export const MAX_DATASET_QA_OPERATOR_NOTES_CHARS = 6000;

const MAX_BODY_SCORED = 1200;
const MAX_BODY_UNSCORED = 900;
const PER_TIER = 6;
const MAX_UNSCORED = 6;

const QUALITY_SCORES: PromptScore[] = ["EXCELLENT", "AVERAGE", "POOR"];

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncated]`;
}

function filterByGuidelineIds<T extends { guidelineId: string }>(
  rows: T[],
  ids: string[],
  datasetImportedGuidelineId: string | null,
): T[] {
  if (ids.length === 0) return rows;
  const set = new Set(ids);
  return rows.filter(
    (r) =>
      set.has(r.guidelineId) ||
      (datasetImportedGuidelineId != null &&
        r.guidelineId === datasetImportedGuidelineId),
  );
}

function projectWhere(projectFilter: ProjectFilter): Prisma.PromptWhereInput {
  if (projectFilter === "all") return {};
  if (projectFilter === UNASSIGNED_PROJECT_QUERY) {
    return { projectKey: "" };
  }
  return { projectKey: projectFilter };
}

type Light = {
  id: string;
  projectKey: string;
  envKey: string | null;
  guidelineId: string;
  score: PromptScore | null;
  analyzedAt: Date | null;
  createdAt: Date;
  extra: unknown;
};

function rubricSummary(
  guidelineIds: string[],
  namesById: Map<string, string>,
): string {
  if (guidelineIds.length === 0) {
    return "All rubrics (dataset-imported tasks follow app guideline-scope rules).";
  }
  return guidelineIds
    .map((id) => namesById.get(id) ?? id)
    .join("; ");
}

async function buildEvidenceContext(
  prisma: PrismaClient,
  projectFilter: ProjectFilter,
  envFilter: EnvFilter,
  guidelineIds: string[],
): Promise<{ text: string; promptCount: number }> {
  const [datasetImportedGuidelineId, guidelines, light] = await Promise.all([
    getDatasetImportedTasksGuidelineId(prisma),
    prisma.guideline.findMany({ select: { id: true, name: true } }),
    prisma.prompt.findMany({
      where: projectWhere(projectFilter),
      select: {
        id: true,
        projectKey: true,
        envKey: true,
        guidelineId: true,
        score: true,
        analyzedAt: true,
        createdAt: true,
        extra: true,
      },
    }),
  ]);

  const namesById = new Map(guidelines.map((g) => [g.id, g.name] as const));

  let scoped: Light[] = filterRowsByProject(light, projectFilter);
  scoped = filterRowsByEnv(scoped, envFilter);
  scoped = filterByGuidelineIds(
    scoped,
    guidelineIds,
    datasetImportedGuidelineId,
  );
  scoped = scoped.filter((p) => taskLifecycleEligibleForLlmAnalysis(p.extra));

  if (scoped.length === 0) {
    return { text: "", promptCount: 0 };
  }

  let nNull = 0;
  let nPruned = 0;
  const nTier = { EXCELLENT: 0, AVERAGE: 0, POOR: 0 } as Record<
    "EXCELLENT" | "AVERAGE" | "POOR",
    number
  >;
  const envLabels = new Set<string>();
  for (const p of scoped) {
    envLabels.add(getEnvironmentLabel(p.envKey));
    if (p.score == null) nNull += 1;
    else if (p.score === "PRUNED") nPruned += 1;
    else if (p.score in nTier) nTier[p.score as keyof typeof nTier] += 1;
  }

  const sortedEnv = [...envLabels].sort((a, b) => a.localeCompare(b));

  const unscored = scoped
    .filter((p) => p.score == null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_UNSCORED);

  const sampleIds: string[] = [];
  const used = new Set<string>();
  for (const tier of QUALITY_SCORES) {
    const bucket = scoped
      .filter((p) => p.score === tier)
      .sort(
        (a, b) =>
          (b.analyzedAt?.getTime() ?? b.createdAt.getTime()) -
          (a.analyzedAt?.getTime() ?? a.createdAt.getTime()),
      );
    let n = 0;
    for (const p of bucket) {
      if (n >= PER_TIER) break;
      sampleIds.push(p.id);
      used.add(p.id);
      n += 1;
    }
  }
  for (const p of unscored) {
    if (!used.has(p.id)) {
      sampleIds.push(p.id);
      used.add(p.id);
    }
  }

  const bodies =
    sampleIds.length === 0
      ? []
      : await prisma.prompt.findMany({
          where: { id: { in: sampleIds } },
          select: {
            id: true,
            body: true,
            score: true,
            envKey: true,
            guideline: { select: { name: true } },
          },
        });
  const byId = new Map(bodies.map((r) => [r.id, r] as const));

  const lines: string[] = [
    "## Dataset scope",
    `- Project: ${getProjectFilterShortLabel(projectFilter)}`,
    `- Environment: ${getEnvFilterShortLabel(envFilter)}`,
    `- Rubrics: ${rubricSummary(guidelineIds, namesById)}`,
    `- Tasks in scope (production lifecycle only): ${scoped.length}`,
    `- Scored — excellent: ${nTier.EXCELLENT}, average: ${nTier.AVERAGE}, poor: ${nTier.POOR}`,
    `- Unscored (null): ${nNull}`,
    `- Pruned: ${nPruned}`,
    `- Distinct env labels in scope: ${sortedEnv.join(", ") || "(none)"}`,
    "",
    "## Evidence excerpts",
    "Below are truncated task prompts only (not full rubrics). Synthetic or placeholder data is expected.",
    "",
  ];

  for (const tier of QUALITY_SCORES) {
    const ids = sampleIds.filter((id) => byId.get(id)?.score === tier);
    if (ids.length === 0) continue;
    lines.push(`### ${tier} samples (${ids.length})`);
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      lines.push(
        `- Rubric: ${row.guideline.name} · env: ${getEnvironmentLabel(row.envKey)}`,
      );
      lines.push(`  """${truncate(row.body, MAX_BODY_SCORED)}"""`);
      lines.push("");
    }
  }

  if (unscored.length > 0) {
    lines.push(`### Unscored samples (up to ${MAX_UNSCORED}, newest first)`);
    for (const p of unscored) {
      const row = byId.get(p.id);
      if (!row) continue;
      lines.push(
        `- Rubric: ${row.guideline.name} · env: ${getEnvironmentLabel(row.envKey)}`,
      );
      lines.push(`  """${truncate(row.body, MAX_BODY_UNSCORED)}"""`);
      lines.push("");
    }
  }

  if (sampleIds.length === 0) {
    lines.push(
      "(No stratified samples selected — counts above still reflect the full scope.)",
    );
  }

  return { text: lines.join("\n"), promptCount: scoped.length };
}

const SYSTEM = `You help operators analyze **evaluation-task prompt datasets** used for training and benchmarking.

Rules:
- Ground answers in the **DATASET CONTEXT** block. If the context is insufficient, say what is missing instead of inventing statistics or examples.
- These prompts are **test / evaluation data**; synthetic identifiers and scenarios are normal and not a safety issue by themselves.
- Respond in **clear Markdown** (headings, bullet lists, bold for emphasis). Do not wrap the entire answer in a single code fence.
- Stay focused on the operator's question; avoid generic lecture about prompt engineering unless they asked for it.`;

export async function runDatasetQa(
  prisma: PrismaClient,
  llmConfig: ResolvedLlmConfig,
  params: {
    projectFilter: ProjectFilter;
    envFilter: EnvFilter;
    guidelineIds: string[];
    question: string;
    operatorNotes?: string | null;
  },
): Promise<{ answer: string }> {
  const question = params.question.trim();
  if (!question) {
    throw new Error("Enter a question.");
  }
  if (question.length > MAX_DATASET_QA_QUESTION_CHARS) {
    throw new Error(
      `Question is too long (max ${MAX_DATASET_QA_QUESTION_CHARS} characters).`,
    );
  }

  if (params.projectFilter === "all") {
    throw new Error("Select a project before asking a question.");
  }

  const notes =
    typeof params.operatorNotes === "string"
      ? params.operatorNotes
          .trim()
          .slice(0, MAX_DATASET_QA_OPERATOR_NOTES_CHARS)
      : "";

  const { text: evidence, promptCount } = await buildEvidenceContext(
    prisma,
    params.projectFilter,
    params.envFilter,
    params.guidelineIds,
  );

  if (promptCount === 0) {
    throw new Error(
      "No tasks match this project, environment, and rubric scope (or none are in production lifecycle). Widen filters or ingest data.",
    );
  }

  const userParts = [
    "# DATASET CONTEXT",
    evidence,
    "",
    "# OPERATOR QUESTION",
    question,
  ];
  if (notes.length > 0) {
    userParts.push("", "# ADDITIONAL OPERATOR NOTES", notes);
  }

  const model = getChatModel(llmConfig);
  const completion = await chatCompletionCreateAudited(
    llmConfig,
    "dataset-qa",
    {
      model,
      temperature: 0.25,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userParts.join("\n") },
      ],
    },
  );

  const answer =
    completion.choices[0]?.message?.content?.trim() ?? "";
  if (!answer) {
    throw new Error("Empty response from language model.");
  }

  return { answer };
}
