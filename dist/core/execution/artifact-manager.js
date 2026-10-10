/**
 * EO-4.4 ArtifactManager — metadata + integrity for build/test outputs.
 *
 * A BUILD ARTIFACT IS NOT A DEPLOYED ARTIFACT. Artifacts stay inside the
 * authorized workspace; this manager records WHAT was produced (path, size,
 * SHA-256 digest, source fingerprint, ChangeSet) and can re-verify it later.
 * Records are immutable, never overwritten, and scoped to one project.
 * Secret and internal files are never recorded (the digest source refuses).
 */
import { ExecutionDeniedError, NotFoundError, requireExecutionId, resolveWorkspacePath, } from "../../contracts/index.js";
import { createId, now } from "../shared.js";
export class ArtifactManager {
    options;
    records = new Map();
    clock;
    newId;
    constructor(options) {
        this.options = options;
        if (!Number.isInteger(options.maxArtifactBytes) ||
            options.maxArtifactBytes <= 0) {
            throw new Error("maxArtifactBytes must be a positive integer");
        }
        this.clock = options.clock ?? now;
        this.newId = options.idFactory ?? createId;
    }
    /** Digest a workspace output and store an immutable record. */
    async record(input) {
        requireExecutionId(input.projectId, "projectId");
        requireExecutionId(input.kind, "artifact.kind");
        const path = resolveWorkspacePath(input.path);
        const digest = await this.options.source.digestFile(input.projectId, path);
        if (digest.size > this.options.maxArtifactBytes) {
            throw new ExecutionDeniedError("RESOURCE_LIMIT", `artifact ${path} exceeds ${this.options.maxArtifactBytes} bytes`);
        }
        const record = Object.freeze({
            artifactId: this.newId("art"),
            projectId: input.projectId,
            verificationId: input.verificationId,
            stageId: input.stageId,
            ...(input.changeSetId ? { changeSetId: input.changeSetId } : {}),
            sourceFingerprint: input.sourceFingerprint,
            kind: input.kind,
            path,
            mediaType: input.mediaType ?? "application/octet-stream",
            sizeBytes: digest.size,
            digest: Object.freeze({
                algorithm: "sha256",
                value: digest.sha256,
            }),
            createdAt: this.clock(),
        });
        this.records.set(record.artifactId, record);
        return record;
    }
    /** Project-scoped lookup: another project's artifact is "not found". */
    get(projectId, artifactId) {
        const record = this.records.get(artifactId);
        return record?.projectId === projectId ? record : undefined;
    }
    list(projectId, verificationId) {
        return [...this.records.values()].filter((r) => r.projectId === projectId &&
            (verificationId === undefined || r.verificationId === verificationId));
    }
    /** Re-digest the file and compare with the recorded SHA-256. */
    async verify(projectId, artifactId) {
        const record = this.get(projectId, artifactId);
        if (!record)
            throw new NotFoundError("resource not found");
        try {
            const current = await this.options.source.digestFile(projectId, record.path);
            const intact = current.sha256 === record.digest.value &&
                current.size === record.sizeBytes;
            return {
                artifactId,
                intact,
                detail: intact ? "digest matches" : "digest mismatch",
            };
        }
        catch {
            return { artifactId, intact: false, detail: "artifact is missing" };
        }
    }
}
