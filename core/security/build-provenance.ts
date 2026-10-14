import { createHash } from "node:crypto";

export interface BuildProvenanceMetadata {
  commitSha: string;
  workflowRunId?: string;
  buildTimestamp: string;
  nodeVersion: string;
  lockfileHash: string;
  sbomReference?: string;
  artifactHashes: Record<string, string>;
}

export function computeSha256(content: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createBuildProvenance(options: {
  commitSha: string;
  workflowRunId?: string;
  lockfileContent: string | Buffer;
  artifacts?: Record<string, string | Buffer>;
  sbomReference?: string;
  timestamp?: string;
}): BuildProvenanceMetadata {
  const artifactHashes: Record<string, string> = {};
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
