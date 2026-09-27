/**
 * Typed normalisation of each execution-lifecycle domain's status enum into
 * the graph's operational vocabulary (EO-5.6). Every table is an exhaustive
 * `Record` over the source union, so a new source status is a compile error
 * here instead of a silently-wrong colour. Source-domain semantics are never
 * changed: the raw status stays on the node, only `state` is derived.
 *
 * The shared `toGraphState` map cannot serve these domains because the same
 * word means different things (`pending` is "awaiting review" for a review but
 * "awaiting approval" for an approval and merely "queued" for a release).
 */
export const SESSION_STATE = {
    created: "queued",
    validating: "queued",
    ready: "queued",
    running: "running",
    // Still running until the sandbox confirms termination.
    cancelling: "running",
    cancelled: "cancelled",
    succeeded: "completed",
    failed: "failed",
    timed_out: "failed",
    // A policy refusal: the work never ran. Not an execution failure.
    denied: "blocked",
};
export const CHANGESET_STATE = {
    open: "active",
    ready_for_review: "awaiting_review",
    verifying: "running",
    // Verified is not committed: the lifecycle continues, so it is not "completed".
    verified: "active",
    verification_failed: "failed",
    rolled_back: "rolled_back",
    abandoned: "cancelled",
};
export const VERIFICATION_STATE = {
    pending: "queued",
    running: "running",
    passed: "completed",
    failed: "failed",
    blocked: "blocked",
    cancelled: "cancelled",
    timed_out: "failed",
};
export const REVIEW_STATE = {
    pending: "awaiting_review",
    approved: "completed",
    changes_requested: "blocked",
    rejected: "failed",
};
export const APPROVAL_STATE = {
    requested: "awaiting_approval",
    approved: "completed",
    rejected: "failed",
    // An expired approval cannot be used: whatever needed it is blocked until re-requested.
    expired: "blocked",
};
export const RELEASE_STATE = {
    pending: "queued",
    deploying: "deploying",
    // COMMIT != DEPLOYMENT and DEPLOYED != VERIFIED: only post-deploy
    // verification (`healthy`) counts as completed.
    deployed: "deployed",
    verifying: "deploying",
    healthy: "completed",
    degraded: "degraded",
    failed: "failed",
    // A completed rollback is a recovery, not a failure.
    rolled_back: "rolled_back",
};
/**
 * Lookup that never invents a state for a status the table does not know.
 * `hasOwn` keeps inherited keys ("constructor", "__proto__") from resolving.
 */
export function normalise(table, status) {
    return Object.hasOwn(table, status) ? table[status] : "unavailable";
}
