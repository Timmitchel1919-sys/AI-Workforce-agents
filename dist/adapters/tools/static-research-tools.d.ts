/**
 * Offline `ToolProvider` exposing `research.search` and `research.fetch` over a
 * fixed in-memory corpus — no network, no filesystem.
 *
 * This is a reference implementation and a deterministic test double. A real
 * deployment supplies a vetted search/fetch provider (still behind the same
 * `ToolProvider` contract) and gates it through the permission system.
 */
import type { ToolProvider, ToolRequest, ToolResponse } from "../../contracts/index.js";
export interface StaticDocument {
    reference: string;
    title: string;
    content: string;
    sourceType?: string;
    /** 0..1 reputation hint used by the agent's reliability model. */
    reputation?: number;
    keywords?: readonly string[];
}
export declare class StaticResearchToolProvider implements ToolProvider {
    readonly id: string;
    private readonly corpus;
    constructor(corpus: readonly StaticDocument[], id?: string);
    get tools(): readonly string[];
    execute(request: ToolRequest): Promise<ToolResponse>;
    private search;
    private fetch;
}
