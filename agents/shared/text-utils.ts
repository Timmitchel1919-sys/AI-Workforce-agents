/**
 * Small text/JSON helpers shared by the model-facing General Agents
 * (Project Manager, Developer, QA). Pure, no dependencies. The Research Agent
 * keeps its own local copies (unchanged) to avoid touching working code.
 */

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === "string" && v.trim()))];
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

/** Tolerant JSON-object extraction: try the whole text, then the first `{...}` span. */
export function extractJsonObject(
  text: string,
): Record<string, unknown> | null {
  const parse = (candidate: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(candidate);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = parse(text.trim());
  if (direct) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parse(text.slice(start, end + 1)) : null;
}
