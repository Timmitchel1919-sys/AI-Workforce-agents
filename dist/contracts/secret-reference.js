export const SECRET_REFERENCE_PROVIDERS = [
    "gcp_secret_manager",
    "azure_key_vault",
    "aws_secrets_manager",
    "external_vault",
    "in_memory_vault",
];
export const SECRET_REFERENCE_STATUSES = [
    "active",
    "rotation_due",
    "rotation_required",
    "rotating",
    "validating",
    "disabled",
    "revoked",
    "expired",
    "unavailable",
    "rotation_failed",
];
