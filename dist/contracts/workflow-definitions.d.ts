/** Node kinds that map onto a real backend capability in this platform. */
export declare const WORKFLOW_NODE_KINDS: readonly ["trigger", "agent_task", "approval", "terminal"];
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];
/**
 * Node kinds the Studio knows about but that have NO authorized backing
 * capability yet. They are listed (disabled) so the owner can see what is
 * missing — never accepted in a saved graph.
 */
export declare const UNAVAILABLE_WORKFLOW_NODE_KINDS: readonly ["model", "tool", "condition", "data", "review", "notification"];
export type UnavailableWorkflowNodeKind = (typeof UNAVAILABLE_WORKFLOW_NODE_KINDS)[number];
export interface WorkflowNodePosition {
    x: number;
    y: number;
}
export interface WorkflowNodeConfig {
    /** agent_task: task type matched against `Agent.supportedTaskTypes`. */
    taskType?: string;
    /** agent_task: explicit registered agent id… */
    agentId?: string;
    /** …or a capability resolved through the Agent Registry. */
    capability?: string;
    /** agent_task: registered tool ids the task is expected to use. */
    expectedTools?: readonly string[];
    acceptanceCriteria?: readonly string[];
    /** approval: what the human approves. */
    approvalAction?: string;
}
export interface WorkflowNode {
    id: string;
    kind: WorkflowNodeKind;
    label: string;
    description?: string;
    config: WorkflowNodeConfig;
    position: WorkflowNodePosition;
}
export interface WorkflowEdge {
    id: string;
    from: string;
    to: string;
}
export interface WorkflowGraph {
    nodes: readonly WorkflowNode[];
    edges: readonly WorkflowEdge[];
}
export declare const WORKFLOW_DEFINITION_STATUSES: readonly ["draft", "published", "archived"];
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];
export interface WorkflowValidationIssue {
    code: WorkflowValidationCode;
    severity: "error" | "warning";
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export interface WorkflowValidationResult {
    valid: boolean;
    issues: readonly WorkflowValidationIssue[];
}
export interface WorkflowDefinition {
    definitionId: string;
    projectId: string;
    name: string;
    description: string;
    status: WorkflowDefinitionStatus;
    /** The editable draft. Never executed directly. */
    draft: WorkflowGraph;
    /** Increments on every saved draft change (optimistic concurrency). */
    draftRevision: number;
    /** Server validation of `draft` at `draftRevision`. */
    lastValidation?: WorkflowValidationResult & {
        draftRevision: number;
        validatedAt: string;
    };
    latestPublishedVersion?: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
    archivedAt?: string;
}
/** An immutable published version. Executions reference exactly one. */
export interface WorkflowVersion {
    definitionId: string;
    projectId: string;
    version: number;
    name: string;
    graph: WorkflowGraph;
    /** Stable hash of the canonical graph — proves immutability. */
    graphHash: string;
    draftRevision: number;
    publishedAt: string;
    publishedBy: string;
}
/** Whether the draft currently reads as VALIDATED (valid at its current revision). */
export declare function isDraftValidated(def: WorkflowDefinition): boolean;
export type SimulationStepOutcome = "would_start" | "would_dispatch" | "would_wait_for_approval" | "would_complete" | "blocked";
export interface WorkflowSimulationStep {
    order: number;
    nodeId: string;
    kind: WorkflowNodeKind;
    outcome: SimulationStepOutcome;
    /** agent_task: the agent the registry would resolve, if any. */
    resolvedAgentId?: string;
    detail: string;
}
export interface WorkflowSimulation {
    mode: "simulation";
    /** Always true: a simulation never calls an agent, model, tool or approval. */
    sideEffectFree: true;
    definitionId: string;
    /** "draft" or a published version number. */
    source: "draft" | number;
    valid: boolean;
    steps: readonly WorkflowSimulationStep[];
    issues: readonly WorkflowValidationIssue[];
    simulatedAt: string;
}
export type WorkflowValidationCode = "INVALID_SHAPE" | "LIMIT_EXCEEDED" | "DUPLICATE_ID" | "UNSUPPORTED_NODE_KIND" | "MISSING_TRIGGER" | "MULTIPLE_TRIGGERS" | "MISSING_TERMINAL" | "TRIGGER_HAS_INPUT" | "TERMINAL_HAS_OUTPUT" | "DANGLING_EDGE" | "SELF_LOOP" | "DUPLICATE_EDGE" | "CYCLE" | "UNREACHABLE" | "NO_PATH_TO_TERMINAL" | "MISSING_TASK_TYPE" | "MISSING_AGENT_OR_CAPABILITY" | "UNKNOWN_AGENT" | "AGENT_UNQUALIFIED" | "NO_AGENT_FOR_CAPABILITY" | "UNKNOWN_TOOL" | "INVALID_APPROVAL" | "CREDENTIAL_IN_GRAPH";
export declare const WORKFLOW_GRAPH_LIMITS: {
    readonly maxNodes: 100;
    readonly maxEdges: 300;
    readonly maxLabel: 120;
    readonly maxDescription: 1000;
    readonly maxListItems: 20;
    readonly maxListItemLength: 200;
};
/** What the validator may consult. Supplied by the server from real registries. */
export interface WorkflowCapabilityContext {
    agents: ReadonlyMap<string, {
        capabilities: readonly string[];
        supportedTaskTypes: readonly string[];
        enabled: boolean;
    }>;
    tools: ReadonlySet<string>;
}
/**
 * Parse untrusted input into a canonical graph. Unknown keys are DROPPED (never
 * persisted), so arbitrary payloads cannot ride along inside a definition.
 * Returns issues for anything structurally invalid.
 */
export declare function normalizeWorkflowGraph(input: unknown): {
    graph: WorkflowGraph;
    issues: WorkflowValidationIssue[];
};
/** Agents that could take an agent_task node, from real registry data. */
export declare function candidateAgents(node: WorkflowNode, ctx: WorkflowCapabilityContext): string[];
/** Full structural + capability validation of an already-normalized graph. */
export declare function validateWorkflowGraph(graph: WorkflowGraph, ctx: WorkflowCapabilityContext): WorkflowValidationResult;
/** Deterministic topological order (ties broken by node id). Assumes acyclic. */
export declare function topologicalOrder(graph: WorkflowGraph): string[];
/** Canonical JSON (sorted keys) used for the immutable version hash. */
export declare function canonicalGraphJson(graph: WorkflowGraph): string;
