/**
 * AI Workforce OS — Layer 14: Knowledge Learning & Organizational Memory Contracts
 *
 * Extends the knowledge module to distinguish between:
 * - facts, decisions, lessons, patterns, procedures, solutions, incidents, ADRs
 * - explicit provenance tracking (where information came from)
 * - confidence levels (verified, high, medium, low, unverified, conflicting)
 * - scoped retrieval & project isolation (global, project, workflow, agent, task)
 * - knowledge lifecycle (created -> validated -> active -> updated -> superseded -> archived)
 * - conflict detection and resolution
 * - quality analysis (stale, low-confidence, duplicate, unverified)
 */
export const KNOWLEDGE_ITEM_TYPES = [
    "fact",
    "decision",
    "lesson",
    "pattern",
    "procedure",
    "solution",
    "incident",
    "architecture_decision",
    "prompt_pattern",
    "workflow_pattern",
    "agent_pattern",
    "tool_pattern",
    "project_knowledge",
    "technical_documentation",
    "architecture",
    "requirement",
    "note",
];
export const KNOWLEDGE_CATEGORIES = KNOWLEDGE_ITEM_TYPES;
export const KNOWLEDGE_CONFIDENCE_LEVELS = [
    "verified",
    "high_confidence",
    "medium_confidence",
    "low_confidence",
    "unverified",
    "conflicting",
];
export const KNOWLEDGE_PROVENANCE_SOURCES = [
    "user_input",
    "project_document",
    "github",
    "workflow_result",
    "agent_output",
    "tool_result",
    "meeting_transcript",
    "approved_decision",
    "external_research",
    "system_observation",
];
export const KNOWLEDGE_SCOPES = [
    "global",
    "project",
    "workflow",
    "agent",
    "task",
    "domain",
];
export const KNOWLEDGE_LIFECYCLE_STATES = [
    "created",
    "validated",
    "active",
    "updated",
    "superseded",
    "archived",
];
export const ADR_STATUSES = [
    "proposed",
    "accepted",
    "superseded",
    "rejected",
];
