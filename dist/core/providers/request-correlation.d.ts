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
