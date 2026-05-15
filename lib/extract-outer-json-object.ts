/**
 * Extract the first complete top-level `{ ... }` from arbitrary model text.
 *
 * Tracks double-quoted strings and escapes so a `}` inside a JSON string value (e.g. a long
 * rationale) does not close the object early. If the stream ends before depth returns to zero,
 * throws — callers often pair this with `finish_reason === "length"` to suggest raising `max_tokens`.
 */
export function extractOuterJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Model did not return a JSON object");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
    } else {
      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  throw new Error(
    "Incomplete JSON object (truncated model output or missing closing brace)",
  );
}
