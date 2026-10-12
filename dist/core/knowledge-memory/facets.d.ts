/**
 * Facet extraction: a small, closed vocabulary of project facts (hosting,
 * theme, database, framework, auth …) read out of memory text. Two ACTIVE
 * decision memories of one project that state DIFFERENT values for the same
 * facet are a knowledge conflict. This is a heuristic, deliberately narrow: it
 * flags likely contradictions for a human, it does not understand arbitrary prose.
 */
export declare function extractFacets(text: string, projectWords?: readonly string[]): Record<string, string>;
/** Facets in which two memories disagree. */
export declare function disagreements(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): {
    facet: string;
    a: string;
    b: string;
}[];
