export const OPERATION_CLASSES = [
    "READ",
    "DRAFT",
    "WRITE",
    "PUBLISH",
    "SEND",
    "DEPLOY",
    "DELETE",
];
export const CONNECTOR_STATES = [
    "DISCOVERED",
    "CONFIGURED",
    "CONNECTED",
    "HEALTHY",
    "DEGRADED",
    "DISCONNECTED",
    "DISABLED",
    "ERROR",
];
export const FAILURE_KINDS = [
    "TRANSIENT",
    "AUTHENTICATION",
    "AUTHORIZATION",
    "RATE_LIMIT",
    "VALIDATION",
    "PROVIDER_ERROR",
    "NETWORK",
    "PERMANENT",
];
/* ------------------------------------------------------------------ */
/* Control surface                                                     */
/* ------------------------------------------------------------------ */
export const INTEGRATION_COMMANDS = [
    "integration_register_connector",
    "integration_configure",
    "integration_store_credential",
    "integration_revoke_credential",
    "integration_oauth_begin",
    "integration_oauth_complete",
    "integration_test_connection",
    "integration_validate_security",
    "integration_enable",
    "integration_disable",
    "integration_disconnect",
    "integration_set_mode",
    "integration_set_trust",
    "integration_upgrade",
    "integration_map_project",
    "integration_unmap_project",
    "integration_register_mcp",
    "integration_set_mcp_status",
    "integration_discover_mcp",
    "integration_create_subscription",
    "integration_set_subscription",
    "integration_drain_queue",
    "integration_simulate",
];
export const HUB_LIMITS = Object.freeze({
    maxParamBytes: 64_000,
    maxResponseBytes: 1_000_000,
    timeoutMs: 15_000,
    maxAttempts: 3,
    circuitFailures: 5,
    circuitOpenMs: 30_000,
    rateWindowMs: 60_000,
    defaultRatePerMinute: 60,
    oauthStateTtlMs: 10 * 60_000,
    webhookReplayMs: 5 * 60_000,
});
