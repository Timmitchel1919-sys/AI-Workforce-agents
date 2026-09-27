import { StateTransitionError } from "../../contracts/index.js";

export type OnboardingConflictCode = "revision_conflict" | "duplicate_project";

/**
 * A precondition of an onboarding write failed (stale revision, or a
 * duplicate project id / code / repository binding). Nothing was written for
 * the failed step. Maps to HTTP 409 via `StateTransitionError`.
 */
export class OnboardingConflictError extends StateTransitionError {
  readonly code: OnboardingConflictCode;
  readonly currentRevision?: number;
  constructor(
    code: OnboardingConflictCode,
    message: string,
    currentRevision?: number,
  ) {
    super(message);
    this.name = "OnboardingConflictError";
    this.code = code;
    if (currentRevision !== undefined) this.currentRevision = currentRevision;
  }
}
