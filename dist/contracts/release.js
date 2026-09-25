/**
 * EO-4.6 — governed source control & deployment orchestration.
 *
 *   WRITE ≠ STAGE ≠ COMMIT ≠ PUSH ≠ DEPLOY · DEPLOYED ≠ HEALTHY ·
 *   REVIEW ≠ APPROVAL · BUILD ≠ SIGN ≠ PUBLISH
 *
 * Every transition is its own, separately authorized operation. Repository
 * identity, remotes, branches and deployment targets come from trusted
 * configuration only — never from a request, an agent or a model.
 */
import { ValidationError } from "./index.js";
import { requireExecutionId } from "./execution.js";
/* ------------------------------------------------------------------ */
/* Review (≠ approval)                                                */
/* ------------------------------------------------------------------ */
export const REVIEW_STATUSES = [
    "pending",
    "approved",
    "changes_requested",
    "rejected",
];
const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** Bounded, safe branch names (no `..`, `@{`, control chars, locks, HEAD). */
export function validateBranchName(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 120) {
        throw new ValidationError("branch name must be 1-120 characters");
    }
    const parts = value.split("/");
    if (parts.length > 4 ||
        !parts.every((p) => REF_SEGMENT.test(p) && !p.endsWith(".lock")) ||
        value.includes("..") ||
        value === "HEAD" ||
        value.startsWith("-")) {
        throw new ValidationError(`branch name ${value.slice(0, 40)} is not allowed`);
    }
    return value;
}
export function validateRepositoryPolicy(policy) {
    requireExecutionId(policy.projectId, "policy.projectId");
    requireExecutionId(policy.repositoryId, "policy.repositoryId");
    validateBranchName(policy.branch.defaultBranch);
    policy.branch.protectedBranches.forEach(validateBranchName);
    policy.branch.directPushBranches.forEach(validateBranchName);
    for (const b of policy.branch.directPushBranches) {
        if (policy.branch.protectedBranches.includes(b)) {
            throw new ValidationError(`branch ${b} cannot be both protected and direct-push`);
        }
    }
    if (!/^[a-z0-9][a-z0-9-]{0,30}\/$/.test(policy.branch.workingBranchPrefix)) {
        throw new ValidationError("workingBranchPrefix must look like `aiw/`");
    }
    if (!/^[^<>\n]{1,80}$/.test(policy.commitIdentity.name) ||
        !/^[^<>\s@]+@[^<>\s@]+$/.test(policy.commitIdentity.email)) {
        throw new ValidationError("commitIdentity is not valid");
    }
}
/* ------------------------------------------------------------------ */
/* Deployment                                                         */
/* ------------------------------------------------------------------ */
export const DEPLOYMENT_TARGET_CLASSES = [
    "development",
    "preview",
    "staging",
    "production",
];
export const RELEASE_STATUSES = [
    "pending",
    "deploying",
    "deployed",
    "verifying",
    "healthy",
    "degraded",
    "failed",
    "rolled_back",
];
