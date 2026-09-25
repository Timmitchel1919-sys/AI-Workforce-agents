/**
 * EO-4.4 ArtifactManager — metadata + integrity for build/test outputs.
 *
 * A BUILD ARTIFACT IS NOT A DEPLOYED ARTIFACT. Artifacts stay inside the
 * authorized workspace; this manager records WHAT was produced (path, size,
 * SHA-256 digest, source fingerprint, ChangeSet) and can re-verify it later.
 * Records are immutable, never overwritten, and scoped to one project.
 * Secret and internal files are never recorded (the digest source refuses).
 */
import { type ArtifactIntegrity, type ArtifactRecord } from "../../contracts/index.js";
export interface ArtifactDigestSource {
    digestFile(projectId: string, path: string): Promise<{
        sha256: string;
        size: number;
    }>;
}
export interface ArtifactManagerOptions {
    source: ArtifactDigestSource;
    /** Upper bound for one artifact (bytes). */
    maxArtifactBytes: number;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
}
export interface RecordArtifactInput {
    projectId: string;
    verificationId: string;
    stageId: string;
    changeSetId?: string;
    sourceFingerprint: string;
    kind: string;
    path: string;
    mediaType?: string;
}
export declare class ArtifactManager {
    private readonly options;
    private readonly records;
    private readonly clock;
    private readonly newId;
    constructor(options: ArtifactManagerOptions);
    /** Digest a workspace output and store an immutable record. */
    record(input: RecordArtifactInput): Promise<ArtifactRecord>;
    /** Project-scoped lookup: another project's artifact is "not found". */
    get(projectId: string, artifactId: string): ArtifactRecord | undefined;
    list(projectId: string, verificationId?: string): ArtifactRecord[];
    /** Re-digest the file and compare with the recorded SHA-256. */
    verify(projectId: string, artifactId: string): Promise<ArtifactIntegrity>;
}
