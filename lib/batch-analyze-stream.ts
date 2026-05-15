/**
 * NDJSON event types streamed from batch analyze routes (`/api/prompts/analyze-pending`,
 * `/api/feedback/analyze-pending`): start → per-item progress → complete or error.
 */

export type BatchStreamStart = {
  type: "start";
  total: number;
};

export type BatchStreamProgress = {
  type: "progress";
  index: number;
  total: number;
  id: string;
  ok: boolean;
  sourceKey: string | null;
  error?: string;
};

export type BatchStreamComplete = {
  type: "complete";
  processed: number;
  okCount: number;
  failCount: number;
};

export type BatchStreamError = {
  type: "error";
  message: string;
};

/** Client disconnected or batch was aborted via AbortSignal. */
export type BatchStreamCancelled = {
  type: "cancelled";
  processedSoFar: number;
  okCount: number;
  failCount: number;
};

export type BatchStreamEvent =
  | BatchStreamStart
  | BatchStreamProgress
  | BatchStreamComplete
  | BatchStreamCancelled
  | BatchStreamError;
