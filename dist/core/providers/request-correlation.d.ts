import type { ModelRequest } from "../../contracts/index.js";
/**
 * Correlation ids a model-provider decorator can read from
 * `request.metadata`, when the caller supplied them. Never invented.
 */
export declare function extractCorrelation(request: ModelRequest): {
    taskId?: string;
    agentId?: string;
    projectId?: string;
};
/**
 * A caller-supplied idempotency key from `request.metadata`, read separately
 * from `extractCorrelation` so that helper's return shape — and every
 * existing caller relying on it — is untouched. `undefined` when the caller
 * gave none: no key means no dedupe is possible, which is reported honestly
 * by whatever records usage, never assumed safe.
 */
export declare function extractIdempotencyKey(request: ModelRequest): string | undefined;
