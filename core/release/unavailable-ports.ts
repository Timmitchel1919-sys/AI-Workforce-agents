import {
  ExecutionDeniedError,
  type GovernedGitPort,
  type RollbackReport,
  type WorkspaceCleanupReport,
  type WorkspaceControl,
} from "../../contracts/index.js";
import type { ArtifactDigestSource } from "../execution/artifact-manager.js";

/**
 * Fail-closed stand-ins for capabilities a deployment does not have (EO-6.1).
 *
 * The production Control Plane runs where there is no Git binary, no persistent workspace and no
 * deployment adapter. Composing the release services against these ports lets them read their
 * durable records and enforce their state machines, while every operation that would need the
 * missing capability is DENIED with an explicit, stable code — never simulated, never a no-op that
 * reports success. Replacing one with a real adapter is the only way that capability turns on.
 */
const denied = (what: string): never => {
  throw new ExecutionDeniedError(
    "ADAPTER_UNAVAILABLE",
    `${what} is not configured in this deployment`,
  );
};

export class UnavailableGovernedGit implements GovernedGitPort {
  readonly available = false;
  async head(): Promise<never> {
    return denied("source control");
  }
  async commit(): Promise<never> {
    return denied("source control");
  }
  async readCommit(): Promise<never> {
    return denied("source control");
  }
  remoteId(): never {
    return denied("source control");
  }
  async remoteHead(): Promise<never> {
    return denied("source control");
  }
  async push(): Promise<never> {
    return denied("source control");
  }
}

/**
 * No workspace exists here, so there is no ChangeSet to read and no source to fingerprint. Reads
 * answer "nothing" (there is genuinely no workspace); anything that would act on one is denied.
 */
export class UnavailableWorkspaceControl implements WorkspaceControl {
  readonly available = false;
  changeSet(): undefined {
    return undefined;
  }
  workspace(): undefined {
    return undefined;
  }
  async rollback(): Promise<RollbackReport> {
    return denied("a workspace");
  }
  async release(): Promise<WorkspaceCleanupReport> {
    return denied("a workspace");
  }
  async sourceFingerprint(): Promise<never> {
    return denied("a workspace");
  }
  async digestFile(): Promise<never> {
    return denied("a workspace");
  }
}

export class UnavailableArtifactSource implements ArtifactDigestSource {
  readonly available = false;
  async digestFile(): Promise<never> {
    return denied("an artifact workspace");
  }
}
