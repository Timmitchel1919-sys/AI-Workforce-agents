import { createHash } from "node:crypto";
export function computeSha256(content) {
    return createHash("sha256").update(content).digest("hex");
}
export function createBuildProvenance(options) {
    const artifactHashes = {};
    if (options.artifacts) {
        for (const [name, content] of Object.entries(options.artifacts)) {
            artifactHashes[name] = computeSha256(content);
        }
    }
    return {
        commitSha: options.commitSha,
        workflowRunId: options.workflowRunId,
        buildTimestamp: options.timestamp ?? new Date().toISOString(),
        nodeVersion: process.version,
        lockfileHash: computeSha256(options.lockfileContent),
        sbomReference: options.sbomReference,
        artifactHashes,
    };
}
