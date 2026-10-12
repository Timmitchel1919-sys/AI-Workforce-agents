export const ACTION_CLASSES = [
    "READ",
    "ANALYZE",
    "CREATE",
    "UPDATE",
    "EXECUTE",
    "PUBLISH",
    "DEPLOY",
    "DELETE",
    "EXPORT",
    "SHARE",
    "ADMINISTRATIVE",
];
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const POLICY_EFFECTS = [
    "ALLOW",
    "REQUIRE_REVIEW",
    "REQUIRE_SECURITY_REVIEW",
    "REQUIRE_APPROVAL",
    "DENY",
];
export const GOV_ENVIRONMENTS = [
    "DEVELOPMENT",
    "TEST",
    "STAGING",
    "PRODUCTION",
];
export const DATA_CLASSES = [
    "PUBLIC",
    "INTERNAL",
    "CONFIDENTIAL",
    "RESTRICTED",
    "SECRET",
];
export const RESOURCE_KINDS = [
    "SOURCE",
    "UI_SOURCE",
    "TEST",
    "DOCUMENT",
    "CONFIG",
    "AUTH_CODE",
    "SECURITY_RULES",
    "CI_CONFIG",
    "DEPLOY_CONFIG",
    "ENV_FILE",
    "SECRET",
    "DATABASE",
    "BRANCH",
    "REPOSITORY",
    "FIREBASE_PROJECT",
    "INFRASTRUCTURE",
    "DEPLOY_TARGET",
    "PROJECT",
    "AGENT",
    "WORKFLOW",
    "INTEGRATION",
    "ENVIRONMENT",
    "POLICY",
    "NETWORK",
    "UNKNOWN",
];
export const POLICY_LAYERS = [
    "SYSTEM_SECURITY",
    "PROJECT_SECURITY",
    "PROJECT_ARCHITECTURE",
    "WORKFLOW",
    "TASK",
    "AGENT",
    "USER_REQUEST",
];
export const TRUST_STATES = [
    "TRUSTED",
    "LIMITED",
    "REVIEW_REQUIRED",
    "SUSPENDED",
    "DISABLED",
];
export const ALERT_SEVERITIES = [
    "INFO",
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
];
export const ALERT_STATUSES = [
    "OPEN",
    "ACKNOWLEDGED",
    "INVESTIGATING",
    "RESOLVED",
    "FALSE_POSITIVE",
];
export const EMERGENCY_STATES = [
    "NORMAL",
    "PAUSED",
    "INVESTIGATING",
    "RECOVERY_REQUIRED",
];
/* ------------------------------------------------------------------ */
/* Control surface                                                     */
/* ------------------------------------------------------------------ */
export const SECURITY_COMMANDS = [
    "security_set_agent_trust",
    "security_set_model_trust",
    "security_set_tool_trust",
    "security_create_policy",
    "security_update_policy",
    "security_set_policy_status",
    "security_decide_approval",
    "security_cancel_approval",
    "security_alert_transition",
    "security_emergency_stop",
    "security_emergency_advance",
    "security_emergency_resume",
    "security_scan_config",
    "security_accept_config",
    "security_scan_dependencies",
];
