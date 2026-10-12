export declare function stem(token: string): string;
export declare function tokenize(text: string): string[];
/** Query terms with their synonym-group siblings at a lower weight. */
export declare function expandQuery(tokens: readonly string[]): Map<string, number>;
export declare function synonymGroupsOf(tokens: readonly string[]): Set<number>;
export declare function trigrams(text: string): Map<string, number>;
export declare function cosine(a: Map<string, number>, b: Map<string, number>): number;
export declare function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number;
export declare function normalizeForHash(text: string): string;
export declare function hashOf(text: string): string;
export declare function contentHashOf(text: string): string;
export declare function clip(text: string, max: number): string;
export declare function summarize(content: string, max?: number): string;
export declare function slug(text: string): string;
