/**
 * EO-4.4 — controlled build, test & verification contracts.
 *
 *   BUILD/TEST EXECUTION IS BOUNDED · NO GENERAL-PURPOSE TERMINAL ·
 *   VERIFIED ≠ COMMITTED · VERIFIED ≠ PUSHED · VERIFIED ≠ DEPLOYED
 *
 * A verification runs the stages an ExecutionPlan revision already contains
 * (build, tests, security) through REGISTERED operations mapped by a trusted
 * per-project VerificationProfile. It records what actually ran — never a
 * planned requirement dressed up as a result.
 */
import { ValidationError } from "./index.js";
import { requireExecutionId } from "./execution.js";
/* ------------------------------------------------------------------ */
/* Stage runs (planned ≠ executed)                                    */
/* ------------------------------------------------------------------ */
export const STAGE_RUN_STATUSES = [
    "not_run",
    "running",
    "passed",
    "failed",
    "blocked",
    "timed_out",
    "cancelled",
    "error",
];
/** Why a stage did not pass — kept distinct, never collapsed into "failed". */
export const STAGE_FAILURE_KINDS = [
    "BUILD_FAILED",
    "TEST_FAILED",
    "FINDINGS",
    "EXECUTION_ERROR",
    "ENVIRONMENT_UNAVAILABLE",
    "TOOLCHAIN_UNAVAILABLE",
    "DEPENDENCY_MISSING",
    "POLICY_DENIED",
    "SANDBOX_UNAVAILABLE",
    "TIMEOUT",
    "CANCELLED",
    "BLOCKED_BY_DEPENDENCY",
    "FAIL_FAST",
    "NO_PROFILE",
    "SOURCE_CHANGED",
];
/* ------------------------------------------------------------------ */
/* Verification                                                       */
/* ------------------------------------------------------------------ */
export const VERIFICATION_STATUSES = [
    "pending",
    "running",
    "passed",
    "failed",
    "blocked",
    "cancelled",
    "timed_out",
];
export const TERMINAL_VERIFICATION_STATUSES = [
    "passed",
    "failed",
    "blocked",
    "cancelled",
    "timed_out",
];
export function validateVerificationProfile(profile) {
    requireExecutionId(profile.projectId, "profile.projectId");
    if (!Number.isInteger(profile.maxParallel) ||
        profile.maxParallel < 1 ||
        profile.maxParallel > 4) {
        throw new ValidationError("profile.maxParallel must be 1-4");
    }
    for (const [stageId, stage] of Object.entries(profile.stages)) {
        requireExecutionId(stageId, "profile.stages key");
        requireExecutionId(stage.operationId, `profile.stages.${stageId}.operationId`);
        const attempts = stage.maxAttempts ?? 1;
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
            throw new ValidationError(`profile.stages.${stageId}.maxAttempts must be 1-3`);
        }
        for (const dep of stage.dependsOn ?? [])
            requireExecutionId(dep, "dependsOn");
    }
}
