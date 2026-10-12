/**
 * Context Assembler — a compact, budgeted, cited context package for one task,
 * built from authorized retrieval. Never a dump of the memory store.
 *
 * Priority under the budget: mandatory security requirements → active
 * architectural decisions → directly relevant knowledge → recent execution
 * history → supporting documentation. Conflicting memories are BOTH shown and
 * flagged; the assembler never silently picks one.
 *
 * `MemoryContextSource` plugs the same retrieval into the Layer 3 Context
 * Engine so the Prompt Engineer receives memory through the existing seam.
 */
import { type ContextPackage, type MemoryRecord } from "../../contracts/knowledge-memory.js";
import type { ContextCategory, ContextFragment, ContextRequest, ContextSource } from "../../contracts/prompt-intelligence.js";
import type { MemoryService } from "./memory-service.js";
import type { RetrievalEngine, RetrievalScope } from "./retrieval.js";
export interface AssembleRequest {
    projectId: string;
    query: string;
    taskId?: string;
    task?: {
        title: string;
        description?: string;
    };
    agent: {
        id: string;
        role: string;
    };
    scope: RetrievalScope;
    executionId?: string;
    budgetChars?: number;
    acceptanceCriteria?: readonly string[];
    relevantFiles?: readonly string[];
    constraints?: readonly string[];
}
export declare function citationOf(m: MemoryRecord): string;
export declare class ContextAssembler {
    private readonly memory;
    private readonly retrieval;
    private readonly clock;
    constructor(memory: MemoryService, retrieval: RetrievalEngine, clock?: () => number);
    assemble(req: AssembleRequest): ContextPackage;
    private render;
}
export declare class MemoryContextSource implements ContextSource {
    private readonly memory;
    private readonly retrieval;
    readonly id = "memory";
    readonly categories: readonly ContextCategory[];
    constructor(memory: MemoryService, retrieval: RetrievalEngine);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
