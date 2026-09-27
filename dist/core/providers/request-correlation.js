/**
 * Correlation ids a model-provider decorator can read from
 * `request.metadata`, when the caller supplied them. Never invented.
 */
export function extractCorrelation(request) {
    const meta = request.metadata ?? {};
    const out = {};
    if (typeof meta.taskId === "string")
        out.taskId = meta.taskId;
    if (typeof meta.agentId === "string")
        out.agentId = meta.agentId;
    if (typeof meta.projectId === "string")
        out.projectId = meta.projectId;
    return out;
}
