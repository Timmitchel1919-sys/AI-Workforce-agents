export const MEMORY_TYPES = [
    "SYSTEM",
    "PROJECT",
    "ARCHITECTURAL",
    "USER_PREFERENCE",
    "EXECUTION",
    "AGENT",
    "DOCUMENT",
];
export const MEMORY_STATUSES = [
    "DRAFT",
    "ACTIVE",
    "SUPERSEDED",
    "ARCHIVED",
    "REVOKED",
];
export const MEMORY_CONFIDENCE = [
    "VERIFIED",
    "USER_CONFIRMED",
    "SYSTEM_GENERATED",
    "AGENT_GENERATED",
    "INFERRED",
    "UNVERIFIED",
];
export const MEMORY_IMPORTANCE = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
export const MEMORY_SOURCES = [
    "USER",
    "PROJECT_FILE",
    "GITHUB",
    "EXECUTION",
    "AGENT",
    "DOCUMENT",
    "SYSTEM",
    "EXTERNAL_RESEARCH",
];
export const RELATION_TYPES = [
    "DEPENDS_ON",
    "USES",
    "BELONGS_TO",
    "RELATED_TO",
    "SUPERSEDES",
    "CONFLICTS_WITH",
    "DERIVED_FROM",
    "IMPLEMENTS",
    "AFFECTS",
    "REQUIRES",
];
export const CONTEXT_SECTIONS = [
    "currentTask",
    "projectContext",
    "architecture",
    "decisions",
    "files",
    "previousAttempts",
    "constraints",
    "security",
    "acceptance",
];
/* ------------------------------------------------------------------ */
/* Control surface                                                     */
/* ------------------------------------------------------------------ */
export const KNOWLEDGE_COMMANDS = [
    "knowledge_create_memory",
    "knowledge_update_memory",
    "knowledge_confirm_memory",
    "knowledge_archive_memory",
    "knowledge_restore_memory",
    "knowledge_supersede_memory",
    "knowledge_revoke_memory",
    "knowledge_delete_memory",
    "knowledge_link",
    "knowledge_resolve_conflict",
    "knowledge_ingest_document",
    "knowledge_discover_project",
    "knowledge_refresh_project",
    "knowledge_apply_retention",
];
export const KNOWLEDGE_LIMITS = Object.freeze({
    maxContent: 8_000,
    maxTitle: 160,
    maxTags: 12,
    maxSearchResults: 50,
    maxDocumentBytes: 200_000,
    chunkChars: 1_200,
    defaultBudgetChars: 6_000,
    maxItemChars: 700,
});
