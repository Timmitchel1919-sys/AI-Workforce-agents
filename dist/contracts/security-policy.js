export const SECURITY_RISK_LEVELS = [
    "low",
    "medium",
    "high",
    "critical",
];
export const SECURITY_POLICY_EFFECTS = [
    "allow",
    "deny",
    "require_approval",
];
/**
 * Risk ranking used by the engine to compare and accumulate decisions.
 * The ordering is strict: `critical` > `high` > `medium` > `low`.
 */
export const SECURITY_RISK_RANK = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};
/**
 * A category of actions that are ALWAYS denied, regardless of role,
 * project, approval or any policy. Enforced by the engine before any
 * policy lookup. These are deliberately narrow invariants that no
 * normal workflow — including the Destructive Action Approval Gate —
 * may override. Retention / archival is a separate future lifecycle.
 */
export const PROHIBITED_ACTIONS = [
    "audit.delete",
    "audit.purge",
    "audit.history.delete",
    "security_event.delete",
    "security_event.purge",
    "security_event.history.delete",
    "secret.export.raw",
    "secret.read.raw",
    "security_policy.bypass",
];
/**
 * Action patterns the engine recognizes as INHERENTLY destructive. The
 * engine escalates risk and requires approval even if no explicit
 * `SecurityPolicy` matched — this is the fail-closed path for unknown
 * sensitive actions. Not an exhaustive list.
 */
export const DESTRUCTIVE_ACTION_PREFIXES = [
    "delete.",
    "destroy.",
    "purge.",
    "revoke.",
    "terminate.",
    "drop.",
    "permanent.",
    "wipe.",
];
export function compareRisk(a, b) {
    return SECURITY_RISK_RANK[a] - SECURITY_RISK_RANK[b];
}
export function maxRisk(a, b) {
    return compareRisk(a, b) >= 0 ? a : b;
}
export function isProhibitedAction(action) {
    return PROHIBITED_ACTIONS.includes(action);
}
export function isInherentlyDestructive(action) {
    if (isProhibitedAction(action))
        return true;
    return DESTRUCTIVE_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}
