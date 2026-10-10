import { ExecutionDeniedError, } from "../../contracts/index.js";
/**
 * Fail-closed stand-ins for capabilities a deployment does not have (EO-6.1).
 *
 * The production Control Plane runs where there is no Git binary, no persistent workspace and no
 * deployment adapter. Composing the release services against these ports lets them read their
 * durable records and enforce their state machines, while every operation that would need the
 * missing capability is DENIED with an explicit, stable code — never simulated, never a no-op that
 * reports success. Replacing one with a real adapter is the only way that capability turns on.
 */
const denied = (what) => {
    throw new ExecutionDeniedError("ADAPTER_UNAVAILABLE", `${what} is not configured in this deployment`);
};
export class UnavailableGovernedGit {
    available = false;
    async head() {
        return denied("source control");
    }
    async commit() {
        return denied("source control");
    }
    async readCommit() {
        return denied("source control");
    }
    remoteId() {
        return denied("source control");
    }
    async remoteHead() {
        return denied("source control");
    }
    async push() {
        return denied("source control");
    }
}
/**
 * No workspace exists here, so there is no ChangeSet to read and no source to fingerprint. Reads
 * answer "nothing" (there is genuinely no workspace); anything that would act on one is denied.
 */
export class UnavailableWorkspaceControl {
    available = false;
    changeSet() {
        return undefined;
    }
    workspace() {
        return undefined;
    }
    async rollback() {
        return denied("a workspace");
    }
    async release() {
        return denied("a workspace");
    }
    async sourceFingerprint() {
        return denied("a workspace");
    }
    async digestFile() {
        return denied("a workspace");
    }
}
export class UnavailableArtifactSource {
    available = false;
    async digestFile() {
        return denied("an artifact workspace");
    }
}
