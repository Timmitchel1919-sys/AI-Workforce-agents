import type { BackupArtifact, BackupLifecycle } from "../../contracts/secops.js";
export interface RetentionDecision { artifactId: string; state: BackupLifecycle; classification: "HOT" | "WARM" | "ARCHIVE" | "PROTECTED"; eligible: boolean; }
export class BackupRetentionService {
  evaluate(artifact: BackupArtifact & { lifecycle?: BackupLifecycle }, now = new Date()): RetentionDecision {
    if (artifact.lifecycle === "RETENTION_LOCKED") return { artifactId: artifact.artifactId, state: "RETENTION_LOCKED", classification: "PROTECTED", eligible: false };
    if (artifact.expiresAt > now) return { artifactId: artifact.artifactId, state: "ACTIVE", classification: "WARM", eligible: false };
    return { artifactId: artifact.artifactId, state: "ELIGIBLE_FOR_DELETION", classification: "ARCHIVE", eligible: true };
  }
}
