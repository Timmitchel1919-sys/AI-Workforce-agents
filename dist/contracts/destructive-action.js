export const DESTRUCTIVE_ACTION_TYPES = [
    "delete_data",
    "delete_record",
    "delete_module",
    "delete_agent",
    "delete_workflow",
    "delete_integration",
    "delete_repository",
    "delete_project",
    "delete_environment",
    "delete_configuration",
    "delete_secret",
    "revoke_identity",
    "remove_access",
    "permanent_purge",
    "other_destructive",
];
export const DESTRUCTIVE_ACTION_STATUSES = [
    "requested",
    "under_review",
    "awaiting_approval",
    "approved",
    "rejected",
    "changes_requested",
    "cancelled",
    "executing",
    "executed",
    "failed",
    "expired",
];
export const DESTRUCTIVE_SAFER_ALTERNATIVES = [
    "archive",
    "disable",
    "quarantine",
    "deprecate",
    "unlink",
    "migrate",
    "rollback",
    "soft_delete",
    "retain",
    "none",
];
/**
 * Terminal statuses — any further transition is a state-machine error.
 */
export const DESTRUCTIVE_TERMINAL_STATUSES = ["executed", "failed", "rejected", "cancelled", "expired"];
export function isDestructiveTerminal(status) {
    return DESTRUCTIVE_TERMINAL_STATUSES.includes(status);
}
/**
 * Deterministic validation. Rejects an incomplete justification with a
 * list of missing fields. The service wraps this in a ValidationError.
 */
export function validateDestructiveJustification(justification) {
    const problems = [];
    const requireString = (value, name) => {
        if (typeof value !== "string" || value.trim().length === 0)
            problems.push(`justification.${name} is required`);
    };
    requireString(justification.summary, "summary");
    requireString(justification.reason, "reason");
    requireString(justification.blockerOrHindrance, "blockerOrHindrance");
    requireString(justification.expectedImpact, "expectedImpact");
    requireString(justification.selectedAlternativeReason, "selectedAlternativeReason");
    requireString(justification.recoveryPlan, "recoveryPlan");
    requireString(justification.dataRetentionImpact, "dataRetentionImpact");
    requireString(justification.complianceImpact, "complianceImpact");
    if (!Array.isArray(justification.saferAlternatives))
        problems.push("justification.saferAlternatives must be an array");
    else if (justification.saferAlternatives.length === 0)
        problems.push("justification.saferAlternatives must enumerate at least one alternative");
    if (typeof justification.reversible !== "boolean")
        problems.push("justification.reversible must be boolean");
    if (typeof justification.backupAvailable !== "boolean")
        problems.push("justification.backupAvailable must be boolean");
    if (typeof justification.rollbackAvailable !== "boolean")
        problems.push("justification.rollbackAvailable must be boolean");
    return problems;
}
