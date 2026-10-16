/** Small deterministic helpers shared across core modules. */
/** Identifier unique across processes; monotonic within one process. */
export declare function createId(prefix: string): string;
/** Current time as an ISO-8601 string. Wrapped so it can be stubbed later. */
export declare function now(): string;
