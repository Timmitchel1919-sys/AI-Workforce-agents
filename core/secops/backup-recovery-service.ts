import type { BackupArtifact, BackupPolicy, RecoveryPoint, RestorePlan } from "../../contracts/secops.js";
import type { Repository } from "../../contracts/persistence.js";

export interface BackupStorage {
  put(input: { artifactId: string; manifestHash: string; contentHash: string; immutable: boolean }): Promise<string>;
  verify(locator: string, contentHash: string, manifestHash: string): Promise<boolean>;
}

export interface BackupRecoveryAuthorizer {
  requestRestore(plan: RestorePlan): Promise<string>;
}

/** Deterministic backup lifecycle. Restore is never implicit and is delegated to the approval gate. */
export class BackupRecoveryService {
  constructor(
    private readonly policies: Repository<BackupPolicy & { id: string }>,
    private readonly artifacts: Repository<BackupArtifact & { id: string }>,
    private readonly storage: BackupStorage,
    private readonly restoreAuthorizer: BackupRecoveryAuthorizer,
  ) {}

  async createArtifact(policyId: string, hashes: { contentHash: string; manifestHash: string }, now = new Date()): Promise<BackupArtifact> {
    const policy = await this.policies.findById(policyId);
    if (!policy || !policy.enabled) throw new Error("backup policy is not active");
    if (!policy.immutable || !policy.isolated) throw new Error("backup policy must be immutable and isolated");
    const artifactId = `backup_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const artifact: BackupArtifact = {
      artifactId, policyId, organizationId: policy.organizationId, createdAt: now,
      expiresAt: new Date(now.getTime() + policy.retentionDays * 86400000), status: "CREATED",
      ...hashes, storageLocator: "",
    };
    artifact.status = "UPLOADING";
    artifact.storageLocator = await this.storage.put({ artifactId, ...hashes, immutable: true });
    artifact.status = "VERIFYING";
    artifact.status = await this.storage.verify(artifact.storageLocator, artifact.contentHash, artifact.manifestHash) ? "VERIFIED" : "CORRUPT";
    await this.artifacts.upsert({ ...artifact, id: artifactId });
    return structuredClone(artifact);
  }

  async recoveryPoint(artifactId: string): Promise<RecoveryPoint> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new Error("backup artifact not found");
    return { artifactId, organizationId: artifact.organizationId, verifiedAt: artifact.createdAt, integrity: artifact.status === "VERIFIED" ? "VERIFIED" : artifact.status === "CORRUPT" ? "CORRUPT" : "DEGRADED", tested: false };
  }

  async requestRestore(plan: RestorePlan): Promise<string> {
    const artifact = await this.artifacts.findById(plan.artifactId);
    if (!artifact || artifact.organizationId !== plan.organizationId || artifact.status !== "VERIFIED") throw new Error("only verified recovery points can be restored");
    return await this.restoreAuthorizer.requestRestore(plan);
  }
}
