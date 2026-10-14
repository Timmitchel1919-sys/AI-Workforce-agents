export interface BuildProvenanceMetadata {
    commitSha: string;
    workflowRunId?: string;
    buildTimestamp: string;
    nodeVersion: string;
    lockfileHash: string;
    sbomReference?: string;
    artifactHashes: Record<string, string>;
}
export declare function computeSha256(content: string | Buffer | Uint8Array): string;
export declare function createBuildProvenance(options: {
    commitSha: string;
    workflowRunId?: string;
    lockfileContent: string | Buffer;
    artifacts?: Record<string, string | Buffer>;
    sbomReference?: string;
    timestamp?: string;
}): BuildProvenanceMetadata;
