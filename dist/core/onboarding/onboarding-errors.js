import { StateTransitionError } from "../../contracts/index.js";
/**
 * A precondition of an onboarding write failed (stale revision, or a
 * duplicate project id / code / repository binding). Nothing was written for
 * the failed step. Maps to HTTP 409 via `StateTransitionError`.
 */
export class OnboardingConflictError extends StateTransitionError {
    code;
    currentRevision;
    constructor(code, message, currentRevision) {
        super(message);
        this.name = "OnboardingConflictError";
        this.code = code;
        if (currentRevision !== undefined)
            this.currentRevision = currentRevision;
    }
}
