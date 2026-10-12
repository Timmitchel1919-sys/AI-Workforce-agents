import type {
  Conflict, ContextPackage, GraphResponse, KnowledgeOverview, MemoryDetail, MemorySummary, SearchHit,
} from "../types";

const NOW = "2026-05-01T10:00:00.000Z";

export function makeMemory(overrides: Partial<MemorySummary> = {}): MemorySummary {
  return {
    memoryId: "m1",
    type: "PROJECT",
    title: "Use PostgreSQL",
    summary: "The project stores data in PostgreSQL.",
    projectId: "p1",
    source: "USER",
    sourceRef: null,
    confidence: "USER_CONFIRMED",
    importance: "NORMAL",
    status: "ACTIVE",
    freshness: "FRESH",
    version: 1,
    tags: ["db"],
    retention: "PERMANENT",
    expiresAt: null,
    updatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

export function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    ...makeMemory(),
    score: 0.82,
    signals: { keyword: 0.7 },
    reasons: ["title matches the query", "recently reinforced"],
    stale: false,
    conflictWith: [],
    ...overrides,
  };
}

export function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    conflictId: "c1",
    projectId: "p1",
    facet: "database",
    memoryIds: ["m1", "m2"],
    values: ["PostgreSQL", "MySQL"],
    titles: ["Use PostgreSQL", "Use MySQL"],
    suggestion: "Keep the newer memory and supersede the older one.",
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<MemoryDetail> = {}, memory: Partial<MemorySummary> = {}): MemoryDetail {
  return {
    memory: {
      ...makeMemory(memory),
      content: "We use PostgreSQL 16 for all services. <script>alert(1)</script>",
      references: [{ kind: "file", ref: "docs/db.md", note: "design doc" }],
      facets: { database: "PostgreSQL" },
      createdBy: "user:alice",
      statusReason: null,
      reinforced: 2,
      agentId: null,
    },
    provenance: { source: "USER", sourceRef: null, createdBy: "user:alice", createdAt: NOW, answer: "Alice typed this in on 1 May." },
    supersedes: null,
    supersededBy: { memoryId: "m9", title: "Use PostgreSQL 17", status: "ACTIVE" },
    versions: [
      { version: 1, at: NOW, by: "user:alice", change: "created", status: "ACTIVE", title: "Use PostgreSQL" },
      { version: 2, at: NOW, by: "user:bob", change: "edited content", status: "ACTIVE", title: "Use PostgreSQL" },
    ],
    related: [{ relation: "USES", direction: "out", node: "tech:postgres", label: "PostgreSQL", memoryId: "m5" }],
    usage: [{ taskId: "task-7", agentId: "backend-agent", reason: "schema question", result: "TASK_SUCCEEDED", at: NOW }],
    conflicts: [],
    ...overrides,
  };
}

export function makeOverview(overrides: Partial<KnowledgeOverview> = {}): KnowledgeOverview {
  return {
    health: {
      total: 12,
      byStatus: { DRAFT: 2, ACTIVE: 8, SUPERSEDED: 1, ARCHIVED: 1, REVOKED: 0 },
      byType: { SYSTEM: 0, PROJECT: 6, ARCHITECTURAL: 3, USER_PREFERENCE: 0, EXECUTION: 1, AGENT: 1, DOCUMENT: 1 },
      potentiallyStale: 3,
      conflicts: 1,
      unverified: 4,
      drafts: 2,
      expiringSoon: 5,
      documents: 7,
      edges: 9,
      generatedAt: NOW,
    },
    findings: [
      { findingId: "f1", ruleId: "knowledge.conflicting_memory", severity: "high", subjectId: "m1", detail: "Two memories disagree about the database." },
    ],
    conflicts: 1,
    candidates: 2,
    capabilities: { retrieval: "keyword+similarity", embeddings: false, pdfExtraction: false, canWrite: true },
    generatedAt: NOW,
    ...overrides,
  };
}

export function makeGraph(overrides: Partial<GraphResponse> = {}): GraphResponse {
  return {
    projectId: "p1",
    nodes: [
      { id: "project:p1", label: "Money Mind", kind: "PROJECT" },
      { id: "tech:react", label: "React", kind: "TECHNOLOGY" },
      { id: "tech:postgres", label: "PostgreSQL", kind: "TECHNOLOGY" },
      { id: "comp:api", label: "Billing API", kind: "COMPONENT" },
      { id: "mem:m1", label: "Use PostgreSQL", kind: "MEMORY" },
    ],
    edges: [
      { id: "e1", from: "project:p1", to: "tech:react", type: "USES", source: "discovery" },
      { id: "e2", from: "project:p1", to: "comp:api", type: "BELONGS_TO", source: "discovery" },
      { id: "e3", from: "comp:api", to: "tech:postgres", type: "DEPENDS_ON", source: "discovery" },
      { id: "e4", from: "mem:m1", to: "tech:postgres", type: "USES", source: "memory" },
    ],
    truncated: false,
    ...overrides,
  };
}

export function makeContext(overrides: Partial<ContextPackage> = {}): ContextPackage {
  return {
    projectId: "p1",
    status: "OK",
    sections: {
      currentTask: [], projectContext: [], architecture: [], decisions: [], files: [], previousAttempts: [], constraints: [], security: [], acceptance: [],
    },
    items: [
      { memoryId: "m1", section: "architecture", title: "Use PostgreSQL", text: "All services use PostgreSQL.", citation: "mem:m1 v1", why: "matches billing", confidence: "VERIFIED", importance: "HIGH", stale: false, conflict: false, score: 0.9 },
    ],
    conflicts: [],
    excluded: [{ memoryId: "m7", reason: "over_budget" }, { memoryId: "m8", reason: "not_relevant" }],
    budget: { limitChars: 4000, usedChars: 1000 },
    rendered: "...",
    assembledAt: NOW,
    ...overrides,
  };
}
