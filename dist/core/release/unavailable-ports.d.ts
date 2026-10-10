import { type GovernedGitPort, type RollbackReport, type WorkspaceCleanupReport, type WorkspaceControl } from "../../contracts/index.js";
import type { ArtifactDigestSource } from "../execution/artifact-manager.js";
export declare class UnavailableGovernedGit implements GovernedGitPort {
    readonly available = false;
    head(): Promise<never>;
    commit(): Promise<never>;
    readCommit(): Promise<never>;
    remoteId(): never;
    remoteHead(): Promise<never>;
    push(): Promise<never>;
}
/**
 * No workspace exists here, so there is no ChangeSet to read and no source to fingerprint. Reads
 * answer "nothing" (there is genuinely no workspace); anything that would act on one is denied.
 */
export declare class UnavailableWorkspaceControl implements WorkspaceControl {
    readonly available = false;
    changeSet(): undefined;
    workspace(): undefined;
    rollback(): Promise<RollbackReport>;
    release(): Promise<WorkspaceCleanupReport>;
    sourceFingerprint(): Promise<never>;
    digestFile(): Promise<never>;
}
export declare class UnavailableArtifactSource implements ArtifactDigestSource {
    readonly available = false;
    digestFile(): Promise<never>;
}
