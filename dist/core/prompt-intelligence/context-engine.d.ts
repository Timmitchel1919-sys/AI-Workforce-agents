/**
 * Context Engine (Phase 3).
 *
 * Resolves WHICH context is relevant to an analysed intent — not all of it.
 * For every fragment it answers: what, why (relevance reasons), which source,
 * is it authoritative, and is it safe to expose to this audience.
 *
 * Pipeline:  sources → safety filter → conflict resolution (precedence)
 *            → relevance scoring → budget → ResolvedContext
 *
 * Guarantees (all enforced here, server-side):
 *  - project isolation: a fragment belonging to another project is dropped;
 *  - no secrets: a fragment whose text looks like a credential is dropped whole;
 *  - clearance: `restricted` fragments reach only a `restricted` audience;
 *  - precedence: security policy outranks everything but is itself never
 *    overridden — an instruction that conflicts with it is recorded, not obeyed;
 *  - a failing source degrades to a report entry; it never fails resolution
 *    and never leaks the error text.
 */
import { type ContextRequest, type ContextSource, type RelevantFileResolver, type ResolvedContext } from "../../contracts/prompt-intelligence.js";
export interface ContextBudget {
    /** Maximum fragments of one category. */
    perCategory: number;
    /** Maximum total characters of fragment text. */
    maxChars: number;
    /** Maximum relevant files returned. */
    maxFiles: number;
}
export declare const DEFAULT_CONTEXT_BUDGET: ContextBudget;
export declare class ContextEngine {
    private readonly sources;
    private readonly options;
    private readonly budget;
    constructor(sources: readonly ContextSource[], options?: {
        fileResolver?: RelevantFileResolver;
        budget?: Partial<ContextBudget>;
        clock?: () => string;
    });
    /** Source ids, for traceability and capability reporting. */
    get sourceIds(): string[];
    resolve(request: ContextRequest): Promise<ResolvedContext>;
    private normalize;
    private reject;
    private resolveConflicts;
    /** An instruction that conflicts with a security fragment loses — visibly. */
    private securityConflicts;
    private score;
}
