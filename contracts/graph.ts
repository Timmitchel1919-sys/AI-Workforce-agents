/**
 * One projection architecture, multiple logical views (EO-5.6).
 * Future modes (COST, SECURITY, DEPLOYMENT, AUDIT) are added to this list and
 * to the mode registry in core/orchestrator/graph-modes.ts — no new engine.
 */
export const GRAPH_MODES = [
  "WORKFORCE",
  "PROJECT",
  "AGENT",
  "WORKFLOW",
  "DEPENDENCY",
  "ENVIRONMENT",
  "KNOWLEDGE",
  "EXECUTION",
] as const;
export type GraphMode = (typeof GRAPH_MODES)[number];
export const DEFAULT_GRAPH_MODE: GraphMode = "WORKFORCE";

/** Hard server-side bounds. Query options can only tighten these. */
export const GRAPH_LIMITS = {
  defaultDepth: 3,
  maxDepth: 5,
  defaultMaxNodes: 250,
  maxNodes: 500,
  maxEdges: 1500,
  /** Per-family cap on execution-lifecycle records projected (newest first). */
  maxExecutionRecords: 50,
} as const;

/**
 * Normalised operational vocabulary the UI colours from. The raw `status`
 * string stays on the node; `state` is derived server-side from authoritative
 * state only (never invented). `unavailable` = authoritative state exposes none.
 */
export const GRAPH_OPERATIONAL_STATES = [
  "active",
  "running",
  "queued",
  "blocked",
  "failed",
  "completed",
  /** Execution lifecycle (EO-5.6): only where the source domain supports them. */
  "awaiting_review",
  "awaiting_approval",
  "deploying",
  "deployed",
  /** Known terminal/abnormal outcomes. `unavailable` is reserved for "no authoritative state". */
  "cancelled",
  "rolled_back",
  "degraded",
  "offline",
  "unavailable",
] as const;
export type GraphOperationalState = (typeof GRAPH_OPERATIONAL_STATES)[number];

export interface WorkforceGraphProjection {
  projectId: string;
  mode: GraphMode;
  revision: number;
  generatedAt: string;
  nodes: WorkforceGraphNode[];
  edges: WorkforceGraphEdge[];
  /** True when node/edge/depth bounds cut the projection short. */
  truncated: boolean;
  /** The bounds actually applied after server-side clamping. */
  appliedLimits: { depth: number; maxNodes: number; maxEdges: number };
  /** Root the projection was scoped to, when one was requested and valid. */
  rootNodeId?: string;
  metadata?: Record<string, string>;
}

/**
 * Reply to a conditional graph poll (`?since=<revision>`) when the caller's
 * revision is still current. Carries no graph content, only proof of currency.
 */
export interface WorkforceGraphUnchanged {
  projectId: string;
  mode: GraphMode;
  revision: number;
  generatedAt: string;
  unchanged: true;
}

export type WorkforceGraphNodeType =
  | "PROJECT"
  | "PROGRAM"
  | "WORKSTREAM"
  | "TASK"
  | "AGENT"
  | "CAPABILITY"
  | "MODEL"
  | "ENVIRONMENT"
  | "RUNNER"
  | "EXECUTION_PLAN"
  | "EXECUTION_SESSION"
  | "WORKSPACE"
  | "WRITE_SCOPE"
  | "CHANGESET"
  | "VERIFICATION"
  | "REVIEW"
  | "APPROVAL"
  | "REPOSITORY"
  | "COMMIT"
  | "ARTIFACT"
  | "DEPLOYMENT"
  | "CONTROL_PLANE"
  | "WORKFLOW"
  | "WORKFLOW_STEP"
  | "ENVIRONMENT_ROUTER"
  | "KNOWLEDGE_SOURCE";

export interface WorkforceGraphNode {
  id: string;
  type: WorkforceGraphNodeType;
  label: string;
  /** Raw authoritative status string (e.g. a TaskStatus). */
  status: string;
  /** Normalised operational state for visual encoding. */
  state: GraphOperationalState;
  projectId: string;
  referenceId: string;
  /**
   * Whitelisted, non-secret, display-safe fields. Never credentials, hostnames,
   * filesystem paths, tokens or free-form agent/task metadata blobs.
   */
  metadata?: Record<string, string | number | boolean | undefined>;
}

export type WorkforceGraphEdgeType =
  | "CONTAINS"
  | "HAS_TASK"
  | "DEPENDS_ON"
  | "ASSIGNED_TO"
  | "REQUIRES"
  | "QUALIFIED_FOR"
  | "ROUTED_TO"
  | "RUNS_ON"
  | "HOLDS_LEASE"
  | "OWNS_SCOPE"
  | "USES_MODEL"
  | "EXECUTES"
  | "PRODUCES"
  | "VERIFIED_BY"
  | "REVIEWED_BY"
  | "REQUIRES_APPROVAL"
  | "COMMITTED_AS"
  | "PUSHED_TO"
  | "DEPLOYED_TO"
  | "PRODUCES_ARTIFACT"
  | "BELONGS_TO"
  | "PART_OF"
  | "EXECUTES_IN"
  | "PARTICIPATES_IN"
  | "REVIEWS"
  | "REFERENCES"
  | "DOCUMENTS"
  | "DESCRIBES"
  | "USED_BY";

export interface WorkforceGraphEdge {
  id: string;
  type: WorkforceGraphEdgeType;
  source: string;
  target: string;
  status?: string;
  metadata?: Record<string, string>;
}

export interface GraphQueryOptions {
  projectId: string;
  /** Defaults to WORKFORCE. */
  mode?: GraphMode;
  depth?: number;
  nodeTypes?: WorkforceGraphNodeType[];
  maxNodes?: number;
  maxEdges?: number;
  rootNodeId?: string;
}

/**
 * A registered, authoritative knowledge source (documentation, architecture
 * doc, codebase, policy, lessons learned). Provided by a
 * {@link KnowledgeSourceProvider}; the graph never scrapes repository content.
 */
export const KNOWLEDGE_SOURCE_KINDS = [
  "documentation",
  "architecture",
  "codebase",
  "project_knowledge",
  "lessons_learned",
  "policy",
] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

export interface KnowledgeSource {
  id: string;
  kind: KnowledgeSourceKind;
  title: string;
  /** Projects allowed to see this source. `"*"` = every project. */
  projectIds: readonly string[];
  /** Agent ids that use this source (drives USED_BY). */
  usedByAgentIds?: readonly string[];
  /** Other registered source ids this one references (drives REFERENCES). */
  referencesSourceIds?: readonly string[];
  /** Source ids this one documents/describes; kind decides DOCUMENTS vs DESCRIBES. */
  describesTaskIds?: readonly string[];
}

export interface KnowledgeSourceProvider {
  list(): readonly KnowledgeSource[];
}

/** A composable slice of the projection; fragments are merged by node/edge id. */
export interface GraphFragment {
  nodes: WorkforceGraphNode[];
  edges: WorkforceGraphEdge[];
}

/* ------------------------------------------------------------------ */
/* Spatial intelligence (EO-5.8)                                       */
/* ------------------------------------------------------------------ */

/**
 * Findings derived ONLY from the authorised graph's observed state. They are observations with
 * evidence — not predictions, not scores, and never commands. SUGGESTION != COMMAND.
 */
export const INSIGHT_KINDS = [
  "BLOCKED_TASK",
  "FAILED_EXECUTION",
  "WAITING_APPROVAL",
  "ENVIRONMENT_UNAVAILABLE",
  "REVIEW_WAITING",
  "DEPLOYMENT_PROBLEM",
  "DEPENDENCY_BOTTLENECK",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_SEVERITIES = ["info", "warning", "critical"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

/** What exactly was observed (a finer cut of the kind; drives the explanation wording). */
export const INSIGHT_VARIANTS = [
  "dependency",
  "approval",
  "waiting",
  "unspecified",
  "queue",
  "failed",
  "degraded",
  "rolled_back",
  "unverified",
] as const;
export type InsightVariant = (typeof INSIGHT_VARIANTS)[number];

/** The state of a node at the revision the finding was derived from. */
export interface InsightEvidence {
  nodeId: string;
  nodeType: WorkforceGraphNodeType;
  label: string;
  state: GraphOperationalState;
  status: string;
}

/**
 * Things the finding does NOT establish. Shown to the operator so a finding is never read as more
 * certain than the recorded state allows.
 */
export const INSIGHT_LIMITATIONS = [
  /** The graph records THAT it failed/blocked, not WHY. */
  "cause_not_recorded",
  /** True only as of the graph revision it was derived from. */
  "as_of_revision",
] as const;
export type InsightLimitation = (typeof INSIGHT_LIMITATIONS)[number];

export const INSIGHT_RECOMMENDATIONS = [
  "inspect",
  "decide_approval",
  "consider_retry",
  "check_environment",
  "review_dependency",
  "review_changeset",
] as const;
export type InsightRecommendationKind =
  (typeof INSIGHT_RECOMMENDATIONS)[number];

/**
 * A suggestion. It carries no command payload and nothing executes it: acting on it is a separate,
 * explicit, confirmed operator action through the Control Plane (ADR-0024).
 */
export interface InsightRecommendation {
  kind: InsightRecommendationKind;
  targetNodeId: string;
  /** An existing Control Plane command this suggestion relates to — a label, never invoked. */
  relatedCommand?:
    "retry-task" | "cancel-task" | "cancel-execution" | "approve" | "reject";
}

export interface SpatialInsight {
  /** Stable for the same subject and observation. */
  id: string;
  kind: InsightKind;
  variant: InsightVariant;
  severity: InsightSeverity;
  subjectNodeId: string;
  /** Values for the explanation template (labels, statuses, counts) — all taken from the graph. */
  params: Record<string, string | number>;
  evidence: InsightEvidence[];
  recommendations: InsightRecommendation[];
  limitations: InsightLimitation[];
}

export interface SpatialInsightsReport {
  projectId: string;
  /** Revision of the (unfiltered, authorised) graph the findings were derived from. */
  graphRevision: number;
  generatedAt: string;
  findings: SpatialInsight[];
  /** More findings existed than the bound allows. */
  truncated: boolean;
  /** Execution sources that could not be read: findings about them are UNKNOWN, not absent. */
  unavailableSources?: string[];
  /**
   * Sources this deployment does not have at all (e.g. the release pipeline is not wired in
   * production). Nothing about them can be shown, and that is not the same as "nothing happened".
   */
  notConfiguredSources?: string[];
  /**
   * Release capabilities this deployment does not have (verification / sourceControl /
   * deployment) although the record sources ARE connected. INERT != IDLE: an empty release
   * history here does not mean a pipeline ran and found nothing — nothing of that kind can run.
   */
  inertCapabilities?: string[];
  basis: "observed_state";
}

export const MAX_INSIGHTS = 100;
