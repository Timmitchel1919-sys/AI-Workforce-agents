/** Small deterministic helpers shared across core modules. */
/** Monotonic, process-local identifier. Deterministic within a single run. */
export declare function createId(prefix: string): string;
/** Current time as an ISO-8601 string. Wrapped so it can be stubbed later. */
export declare function now(): string;
