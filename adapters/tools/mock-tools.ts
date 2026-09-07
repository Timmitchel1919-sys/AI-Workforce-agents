/**
 * Deterministic, offline tool implementations for tests and local wiring.
 *
 * No network, no filesystem, no shell, no credentials. A real deployment
 * supplies vetted handlers behind the same `Tool` contract and registers them
 * with the `ToolRegistry`.
 */
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
} from "../../contracts/index.js";

export type ToolHandlerFn = (
  input: unknown,
  context: ToolExecutionContext,
) => Promise<unknown> | unknown;

/** Wrap a definition + a plain handler into a `Tool`. */
export function makeInMemoryTool(
  definition: ToolDefinition,
  handler: ToolHandlerFn,
): Tool {
  return {
    ...definition,
    async execute(input, context) {
      return handler(input, context);
    },
  };
}

export interface MockDocument {
  reference: string;
  title: string;
  content: string;
  sourceType?: string;
  /** 0..1 reputation hint consumed by the research agent's reliability model. */
  reputation?: number;
  keywords?: readonly string[];
}

/**
 * Build the two research tools (`research.search` / `research.fetch`) over a
 * fixed corpus, using the supplied definitions for policy metadata.
 */
export function mockResearchTools(
  corpus: readonly MockDocument[],
  definitions: { search: ToolDefinition; fetch: ToolDefinition },
): { search: Tool; fetch: Tool } {
  const docs = corpus.map((doc) => ({ ...doc }));

  const search = makeInMemoryTool(definitions.search, (input) => {
    const query = String(
      (input as { query?: unknown })?.query ?? "",
    ).toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return { results: [] };

    const results = docs
      .map((doc) => {
        const title = doc.title.toLowerCase();
        const body = doc.content.toLowerCase();
        const keywords = (doc.keywords ?? []).map((k) => k.toLowerCase());
        const score = terms.reduce(
          (total, term) =>
            total +
            (title.includes(term) ? 2 : 0) +
            (body.includes(term) ? 1 : 0) +
            (keywords.some((k) => k.includes(term)) ? 2 : 0),
          0,
        );
        return { doc, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((row) => ({
        title: row.doc.title,
        reference: row.doc.reference,
        snippet: row.doc.content.slice(0, 160),
        sourceType: row.doc.sourceType,
      }));
    return { results };
  });

  const fetch = makeInMemoryTool(definitions.fetch, (input) => {
    const reference = String(
      (input as { reference?: unknown })?.reference ?? "",
    );
    const doc = docs.find((d) => d.reference === reference);
    if (!doc) return { reference, content: "", verified: false };
    return {
      reference,
      title: doc.title,
      content: doc.content,
      sourceType: doc.sourceType,
      reputation: doc.reputation,
    };
  });

  return { search, fetch };
}
