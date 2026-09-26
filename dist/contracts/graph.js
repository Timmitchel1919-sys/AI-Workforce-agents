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
];
export const DEFAULT_GRAPH_MODE = "WORKFORCE";
/** Hard server-side bounds. Query options can only tighten these. */
export const GRAPH_LIMITS = {
    defaultDepth: 3,
    maxDepth: 5,
    defaultMaxNodes: 250,
    maxNodes: 500,
    maxEdges: 1500,
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
