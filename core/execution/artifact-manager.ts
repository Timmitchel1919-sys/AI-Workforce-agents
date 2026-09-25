/**
 * EO-4.4 ArtifactManager — metadata + integrity for build/test outputs.
 *
 * A BUILD ARTIFACT IS NOT A DEPLOYED ARTIFACT. Artifacts stay inside the
 * authorized workspace; this manager records WHAT was produced (path, size,
 * SHA-256 digest, source fingerprint, ChangeSet) and can re-verify it later.
 * Records are immutable, never overwritten, and scoped to one project.
 * Secret and internal files are never recorded (the digest source refuses).
 */
import {
  ExecutionDeniedError,
  NotFoundError,
  requireExecutionId,
  resolveWorkspacePath,
  type ArtifactIntegrity,
  type ArtifactRecord,
} from "../../contracts/index.js";
import { createId, now } from "../shared.js";

export interface ArtifactDigestSource {
  digestFile(
    projectId: string,
    path: string,
  ): Promise<{ sha256: string; size: number }>;
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

export class ArtifactManager {
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly clock: () => string;
  private readonly newId: (prefix: string) => string;

  constructor(private readonly options: ArtifactManagerOptions) {
    if (
      !Number.isInteger(options.maxArtifactBytes) ||
      options.maxArtifactBytes <= 0
    ) {
      throw new Error("maxArtifactBytes must be a positive integer");
    }
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
  }

  /** Digest a workspace output and store an immutable record. */
  async record(input: RecordArtifactInput): Promise<ArtifactRecord> {
    requireExecutionId(input.projectId, "projectId");
    requireExecutionId(input.kind, "artifact.kind");
    const path = resolveWorkspacePath(input.path);
    const digest = await this.options.source.digestFile(input.projectId, path);
    if (digest.size > this.options.maxArtifactBytes) {
      throw new ExecutionDeniedError(
        "RESOURCE_LIMIT",
        `artifact ${path} exceeds ${this.options.maxArtifactBytes} bytes`,
      );
    }
    const record: ArtifactRecord = Object.freeze({
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
        algorithm: "sha256" as const,
        value: digest.sha256,
      }),
      createdAt: this.clock(),
    });
    this.records.set(record.artifactId, record);
    return record;
  }

  /** Project-scoped lookup: another project's artifact is "not found". */
  get(projectId: string, artifactId: string): ArtifactRecord | undefined {
    const record = this.records.get(artifactId);
    return record?.projectId === projectId ? record : undefined;
  }

  list(projectId: string, verificationId?: string): ArtifactRecord[] {
    return [...this.records.values()].filter(
      (r) =>
        r.projectId === projectId &&
        (verificationId === undefined || r.verificationId === verificationId),
    );
  }

  /** Re-digest the file and compare with the recorded SHA-256. */
  async verify(
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactIntegrity> {
    const record = this.get(projectId, artifactId);
    if (!record) throw new NotFoundError("resource not found");
    try {
      const current = await this.options.source.digestFile(
        projectId,
        record.path,
      );
      const intact =
        current.sha256 === record.digest.value &&
        current.size === record.sizeBytes;
      return {
        artifactId,
        intact,
        detail: intact ? "digest matches" : "digest mismatch",
      };
    } catch {
      return { artifactId, intact: false, detail: "artifact is missing" };
    }
  }
}
