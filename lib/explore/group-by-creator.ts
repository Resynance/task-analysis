import {
  getCreatorLabelFromExtra,
  UNKNOWN_CREATOR_LABEL,
} from "@/lib/explore/creator-from-extra";

export type ExplorePromptEntry = {
  id: string;
  sourceId: string | null;
  sourceKey: string | null;
  bodyPreview: string;
  createdAt: string;
};

export type ExploreGroup = {
  creatorLabel: string;
  prompts: ExplorePromptEntry[];
};

function previewBody(body: string, max = 200): string {
  const t = body.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function buildExploreGroups(
  prompts: Array<{
    id: string;
    sourceId: string | null;
    sourceKey: string | null;
    body: string;
    createdAt: Date | string;
    extra: unknown;
  }>,
  nameByUserId?: Map<string, string>,
): ExploreGroup[] {
  const map = new Map<string, ExplorePromptEntry[]>();

  for (const p of prompts) {
    const creatorLabel = getCreatorLabelFromExtra(p.extra, nameByUserId);
    const createdAt =
      typeof p.createdAt === "string"
        ? p.createdAt
        : p.createdAt.toISOString();
    const entry: ExplorePromptEntry = {
      id: p.id,
      sourceId: p.sourceId,
      sourceKey: p.sourceKey,
      bodyPreview: previewBody(p.body),
      createdAt,
    };
    const list = map.get(creatorLabel) ?? [];
    list.push(entry);
    map.set(creatorLabel, list);
  }

  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  const labels = [...map.keys()].sort((a, b) => {
    if (a === UNKNOWN_CREATOR_LABEL) return 1;
    if (b === UNKNOWN_CREATOR_LABEL) return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  return labels.map((creatorLabel) => ({
    creatorLabel,
    prompts: map.get(creatorLabel)!,
  }));
}
