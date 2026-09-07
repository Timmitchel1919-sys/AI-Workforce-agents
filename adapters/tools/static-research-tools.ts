/**
 * Offline `ToolProvider` exposing `research.search` and `research.fetch` over a
 * fixed in-memory corpus — no network, no filesystem.
 *
 * This is a reference implementation and a deterministic test double. A real
 * deployment supplies a vetted search/fetch provider (still behind the same
 * `ToolProvider` contract) and gates it through the permission system.
 */
import type {
  ToolProvider,
  ToolRequest,
  ToolResponse,
} from "../../contracts/index.js";

export interface StaticDocument {
  reference: string;
  title: string;
  content: string;
  sourceType?: string;
  /** 0..1 reputation hint used by the agent's reliability model. */
  reputation?: number;
  keywords?: readonly string[];
}

export class StaticResearchToolProvider implements ToolProvider {
  readonly id: string;
  private readonly corpus: StaticDocument[];

  constructor(corpus: readonly StaticDocument[], id = "static-research") {
    this.id = id;
    this.corpus = corpus.map((doc) => ({ ...doc }));
  }

  get tools(): readonly string[] {
    return ["research.search", "research.fetch"];
  }

  async execute(request: ToolRequest): Promise<ToolResponse> {
    if (request.tool === "research.search") {
      return { output: { results: this.search(request.input) } };
    }
    if (request.tool === "research.fetch") {
      return { output: this.fetch(request.input) };
    }
    throw new Error(`unknown research tool: ${request.tool}`);
  }

  private search(input: unknown): Array<Record<string, unknown>> {
    const query = String(
      (input as { query?: unknown })?.query ?? "",
    ).toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    return this.corpus
      .map((doc) => {
        const haystackTitle = doc.title.toLowerCase();
        const haystackBody = doc.content.toLowerCase();
        const keywords = (doc.keywords ?? []).map((k) => k.toLowerCase());
        const score = terms.reduce(
          (total, term) =>
            total +
            (haystackTitle.includes(term) ? 2 : 0) +
            (haystackBody.includes(term) ? 1 : 0) +
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
  }

  private fetch(input: unknown): Record<string, unknown> {
    const reference = String(
      (input as { reference?: unknown })?.reference ?? "",
    );
    const doc = this.corpus.find((d) => d.reference === reference);
    if (!doc) {
      return { reference, content: "", verified: false };
    }
    return {
      reference,
      title: doc.title,
      content: doc.content,
      sourceType: doc.sourceType,
      reputation: doc.reputation,
    };
  }
}
