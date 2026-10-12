/** Wire types for the Knowledge Center HTTP contract (read endpoints + `knowledge_*` commands). */

export const MANAGE_CAPABILITY = "manage_knowledge";

export const MEMORY_STATUSES = ["DRAFT", "ACTIVE", "SUPERSEDED", "ARCHIVED", "REVOKED"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_TYPES = ["SYSTEM", "PROJECT", "ARCHITECTURAL", "USER_PREFERENCE", "EXECUTION", "AGENT", "DOCUMENT"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SOURCES = ["USER", "PROJECT_FILE", "GITHUB", "EXECUTION", "AGENT", "DOCUMENT", "SYSTEM", "EXTERNAL_RESEARCH"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const CONFIDENCES = ["VERIFIED", "USER_CONFIRMED", "SYSTEM_GENERATED", "AGENT_GENERATED", "INFERRED", "UNVERIFIED"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const IMPORTANCES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type Importance = (typeof IMPORTANCES)[number];

export type Freshness = "FRESH" | "POTENTIALLY_STALE";
export type Retention = "PERMANENT" | "TEMPORARY";

export const RELATION_TYPES = [
  "DEPENDS_ON", "USES", "BELONGS_TO", "RELATED_TO", "SUPERSEDES", "CONFLICTS_WITH", "DERIVED_FROM", "IMPLEMENTS", "AFFECTS", "REQUIRES",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const GRAPH_NODE_KINDS = ["PROJECT", "TECHNOLOGY", "COMPONENT", "AREA", "INTEGRATION", "MEMORY", "OTHER"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const CONTEXT_ROLES = ["developer", "qa", "reviewer", "security", "analyst"] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

export const CONTEXT_SECTIONS = [
  "currentTask", "projectContext", "architecture", "decisions", "files", "previousAttempts", "constraints", "security", "acceptance",
] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export interface KnowledgeHealth {
  projectId?: string;
  total: number;
  byStatus: Record<MemoryStatus, number>;
  byType: Record<MemoryType, number>;
  potentiallyStale: number;
  conflicts: number;
  unverified: number;
  drafts: number;
  expiringSoon: number;
  documents: number;
  edges: number;
  generatedAt: string;
}

export type FindingSeverity = "low" | "medium" | "high";
export interface Finding {
  findingId: string;
  ruleId: string;
  severity: FindingSeverity;
  subjectId: string;
  projectId?: string;
  detail: string;
}

export interface KnowledgeCapabilities {
  retrieval: string;
  embeddings: boolean;
  pdfExtraction: boolean;
  canWrite: boolean;
}

export interface KnowledgeOverview {
  health: KnowledgeHealth;
  findings: Finding[];
  conflicts: number;
  candidates: number;
  capabilities: KnowledgeCapabilities;
  generatedAt: string;
}

export interface MemorySummary {
  memoryId: string;
  type: MemoryType;
  title: string;
  summary: string;
  projectId: string | null;
  source: MemorySource;
  sourceRef: string | null;
  confidence: Confidence;
  importance: Importance;
  status: MemoryStatus;
  freshness: Freshness;
  version: number;
  tags: string[];
  retention: Retention;
  expiresAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface SearchHit extends MemorySummary {
  score: number;
  signals: Record<string, number>;
  reasons: string[];
  stale: boolean;
  conflictWith: string[];
}

export interface MemoryReference { kind: string; ref: string; note?: string }

export interface MemoryFull extends MemorySummary {
  content: string;
  references: MemoryReference[];
  facets: Record<string, string>;
  createdBy: string;
  statusReason: string | null;
  reinforced: number;
  agentId: string | null;
}

export interface Conflict {
  conflictId: string;
  projectId: string;
  facet: string;
  memoryIds: [string, string];
  values: [string, string];
  titles: [string, string];
  suggestion: string;
}

export interface MemoryLink { memoryId: string; title: string; status: MemoryStatus }
export interface MemoryVersion { version: number; at: string; by: string; change: string; status: MemoryStatus; title: string }
export interface MemoryRelated { relation: string; direction: "in" | "out"; node: string; label: string; memoryId: string | null }
export type UsageResult = "PENDING" | "TASK_SUCCEEDED" | "TASK_FAILED";
export interface MemoryUsage { taskId: string; agentId: string; reason: string; result: UsageResult; at: string }

export interface MemoryDetail {
  memory: MemoryFull;
  provenance: { source: MemorySource; sourceRef: string | null; createdBy: string; createdAt: string; answer: string };
  supersedes: MemoryLink | null;
  supersededBy: MemoryLink | null;
  versions: MemoryVersion[];
  related: MemoryRelated[];
  usage: MemoryUsage[];
  conflicts: Conflict[];
}

export interface GraphNode { id: string; label: string; kind: GraphNodeKind }
export interface GraphEdge { id: string; from: string; to: string; type: RelationType; source: string }
export interface GraphResponse { projectId: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }

export interface KnowledgeDocument {
  projectId: string;
  ref: string;
  ingestedAt: string;
  chunks: number;
  active: boolean;
  potentiallyStale: boolean;
  tags: string[];
}

export interface ContextItem {
  memoryId: string;
  section: string;
  title: string;
  text: string;
  citation: string;
  why: string;
  confidence: Confidence;
  importance: Importance;
  stale: boolean;
  conflict: boolean;
  score: number;
}

export interface ContextPackage {
  projectId: string;
  status: "OK" | "KNOWLEDGE_CONFLICT_DETECTED";
  sections: Record<ContextSection, string[]>;
  items: ContextItem[];
  conflicts: Conflict[];
  excluded: { memoryId: string; reason: "over_budget" | "not_relevant" | "not_authorized" }[];
  budget: { limitChars: number; usedChars: number };
  rendered: string;
  assembledAt: string;
}

export interface MemoryFilters {
  q: string;
  type: string;
  source: string;
  status: string;
  confidence: string;
  importance: string;
  since: string;
}

export const EMPTY_FILTERS: MemoryFilters = { q: "", type: "", source: "", status: "", confidence: "", importance: "", since: "" };

export type KnowledgeCommandName =
  | "knowledge_create_memory" | "knowledge_update_memory" | "knowledge_confirm_memory" | "knowledge_archive_memory"
  | "knowledge_restore_memory" | "knowledge_revoke_memory" | "knowledge_delete_memory" | "knowledge_supersede_memory"
  | "knowledge_link" | "knowledge_resolve_conflict" | "knowledge_ingest_document" | "knowledge_discover_project"
  | "knowledge_refresh_project" | "knowledge_apply_retention";

export interface CommandResult {
  command: string;
  outcome: "executed" | "denied" | "rejected";
  ok: boolean;
  errorKind?: "forbidden" | "not_found" | "invalid_state" | "invalid_request" | "command_failure";
  reason: string;
  resourceId?: string;
  correlationId: string;
  details: Record<string, unknown>;
  auditEventId: string;
  timestamp: string;
}

export interface IngestReport {
  ref: string;
  status: "ingested" | "unchanged" | "skipped";
  reason?: string;
  chunks: number;
  created: string[];
  reinforced: string[];
  archived: string[];
  staleMarked: string[];
  redacted: number;
  steps: string[];
}

export interface ProjectRunSummary {
  projectId: string;
  source: string;
  topics: number;
  documents: number;
  unchanged: number;
  staleMarked: number;
  conflicts: number;
  truncated: boolean;
  unavailable: string[];
}

export type ConflictResolution = "SUPERSEDED_OTHER" | "ARCHIVED_OTHER" | "KEPT_BOTH";

export const TABS = ["overview", "project", "memories", "documents", "decisions", "graph", "conflicts", "settings"] as const;
export type KnowledgeTab = (typeof TABS)[number];

export interface CommandInput { command: KnowledgeCommandName; body: Record<string, unknown> }
