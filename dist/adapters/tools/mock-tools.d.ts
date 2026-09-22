/**
 * Deterministic, offline tool implementations for tests and local wiring.
 *
 * No network, no filesystem, no shell, no credentials. A real deployment
 * supplies vetted handlers behind the same `Tool` contract and registers them
 * with the `ToolRegistry`.
 */
import type { Tool, ToolDefinition, ToolExecutionContext } from "../../contracts/index.js";
export type ToolHandlerFn = (input: unknown, context: ToolExecutionContext) => Promise<unknown> | unknown;
/** Wrap a definition + a plain handler into a `Tool`. */
export declare function makeInMemoryTool(definition: ToolDefinition, handler: ToolHandlerFn): Tool;
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
export declare function mockResearchTools(corpus: readonly MockDocument[], definitions: {
    search: ToolDefinition;
    fetch: ToolDefinition;
}): {
    search: Tool;
    fetch: Tool;
};
