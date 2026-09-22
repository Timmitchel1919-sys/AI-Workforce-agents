/**
 * Small text/JSON helpers shared by the model-facing General Agents
 * (Project Manager, Developer, QA). Pure, no dependencies. The Research Agent
 * keeps its own local copies (unchanged) to avoid touching working code.
 */
export declare function truncate(text: string, max: number): string;
export declare function dedupe(values: readonly string[]): string[];
export declare function toStringArray(value: unknown): string[];
/** Tolerant JSON-object extraction: try the whole text, then the first `{...}` span. */
export declare function extractJsonObject(text: string): Record<string, unknown> | null;
