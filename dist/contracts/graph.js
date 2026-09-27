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
];
export const DEFAULT_GRAPH_MODE = "WORKFORCE";
/** Hard server-side bounds. Query options can only tighten these. */
export const GRAPH_LIMITS = {
    defaultDepth: 3,
    maxDepth: 5,
    defaultMaxNodes: 250,
    maxNodes: 500,
    maxEdges: 1500,
    /** Per-family cap on execution-lifecycle records projected (newest first). */
    maxExecutionRecords: 50,
};
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
];
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
];
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
];
export const INSIGHT_SEVERITIES = ["info", "warning", "critical"];
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
];
/**
 * Things the finding does NOT establish. Shown to the operator so a finding is never read as more
 * certain than the recorded state allows.
 */
export const INSIGHT_LIMITATIONS = [
    /** The graph records THAT it failed/blocked, not WHY. */
    "cause_not_recorded",
    /** True only as of the graph revision it was derived from. */
    "as_of_revision",
];
export const INSIGHT_RECOMMENDATIONS = [
    "inspect",
    "decide_approval",
    "consider_retry",
    "check_environment",
    "review_dependency",
    "review_changeset",
];
export const MAX_INSIGHTS = 100;
