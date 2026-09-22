/**
 * Multi-agent workflow contracts.
 *
 * A `Workflow` is a declarative task graph: named nodes (`WorkflowTaskSpec`)
 * with explicit `dependsOn` edges, scoped to one project, executed by the
 * `WorkflowEngine` (core/workflows/) through the existing `Orchestrator` —
 * never bypassing permissions, approval, or the tool execution engine.
 *
 * Nothing here is specific to research/development/QA; those are just task
 * `type`s a workflow author chooses. The graph, limits, and retry policy are
 * fully reusable for any future General Agent combination.
 */
import { type Priority, type RequiredPermission } from "./index.js";
/** Hard ceilings a workflow run enforces, independent of any single agent's own limits. */
export interface WorkflowLimits {
    maxTasks: number;
    maxAgentExecutions: number;
    maxRetries: number;
    maxHandoffs: number;
    maxToolCalls: number;
    maxDurationMs: number;
    /** How many levels of "plan a workflow from an objective" may nest. */
    maxDelegationDepth: number;
}
export declare const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits;
/**
 * Which task failures may be retried, and how many times. Security and
 * validation failures are deliberately never retryable by default.
 */
export interface RetryPolicy {
    maxRetries: number;
    retryableReasons: readonly string[];
}
export declare const DEFAULT_RETRY_POLICY: RetryPolicy;
export interface WorkflowTaskSpecDraft {
    /** Unique within the workflow. */
    id: string;
    /** Task type — matched against `Agent.supportedTaskTypes`. */
    type: string;
    description: string;
    /** Explicit agent id. Provide this or `capability`, not neither. */
    agentId?: string;
    /** Resolve an agent by capability when `agentId` is not given. */
    capability?: string;
    /** Spec ids that must complete successfully before this one may start. */
    dependsOn?: readonly string[];
    acceptanceCriteria?: readonly string[];
    input?: unknown;
    requiredPermissions?: readonly RequiredPermission[];
    /** Tool ids this task is expected to use, for assignment pre-checks. */
    expectedTools?: readonly string[];
    priority?: Priority;
    metadata?: Record<string, unknown>;
}
export interface WorkflowTaskSpec {
    id: string;
    type: string;
    description: string;
    agentId?: string;
    capability?: string;
    dependsOn: readonly string[];
    acceptanceCriteria: readonly string[];
    input: unknown;
    requiredPermissions: readonly RequiredPermission[];
    expectedTools: readonly string[];
    priority?: Priority;
    metadata: Record<string, unknown>;
}
export type WorkflowFailureBehavior = "abort" | "continue";
export interface WorkflowDraft {
    name: string;
    description: string;
    projectId: string;
    /** Agent ids this workflow may use. A task cannot be assigned outside this set. */
    participatingAgents: readonly string[];
    tasks: readonly WorkflowTaskSpecDraft[];
    successCriteria?: readonly string[];
    /** `"abort"` (default): a failed task blocks its dependents and fails the workflow. `"continue"`: independent branches keep going. */
    failureBehavior?: WorkflowFailureBehavior;
    limits?: Partial<WorkflowLimits>;
    retryPolicy?: Partial<RetryPolicy>;
    metadata?: Record<string, unknown>;
}
export declare const WORKFLOW_STATUSES: readonly ["created", "planned", "running", "awaiting_approval", "blocked", "completed", "failed", "cancelled"];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export declare const WORKFLOW_TASK_STATUSES: readonly ["pending", "ready", "dispatched", "awaiting_approval", "completed", "failed", "blocked", "skipped", "cancelled"];
export type WorkflowTaskStatus = (typeof WORKFLOW_TASK_STATUSES)[number];
export interface WorkflowTaskRecord {
    specId: string;
    status: WorkflowTaskStatus;
    /** The real `Task` id, once the spec has been dispatched at least once. */
    taskId?: string;
    assignedAgentId?: string;
    retryCount: number;
    error?: string;
    /** The real task's output, once it has completed. */
    output?: unknown;
    /** Set once a handoff has been accepted feeding this task. */
    handoffId?: string;
    updatedAt: string;
}
export interface WorkflowCounters {
    tasksCreated: number;
    agentExecutions: number;
    retries: number;
    handoffs: number;
    toolCalls: number;
}
export interface WorkflowTaskResultSummary {
    specId: string;
    status: WorkflowTaskStatus;
    agentId?: string;
    output?: unknown;
    error?: string;
}
export interface WorkflowResult {
    workflowId: string;
    status: WorkflowStatus;
    summary: string;
    taskResults: readonly WorkflowTaskResultSummary[];
    completedAt: string;
    metadata: Record<string, unknown>;
}
export interface Workflow {
    id: string;
    name: string;
    description: string;
    projectId: string;
    participatingAgents: readonly string[];
    tasks: readonly WorkflowTaskSpec[];
    successCriteria: readonly string[];
    failureBehavior: WorkflowFailureBehavior;
    limits: WorkflowLimits;
    retryPolicy: RetryPolicy;
    status: WorkflowStatus;
    taskRecords: readonly WorkflowTaskRecord[];
    counters: WorkflowCounters;
    result?: WorkflowResult;
    error?: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    metadata: Record<string, unknown>;
}
/** Outcome of validating a Project-Manager-recommended (or authored) assignment. */
export interface AgentAssignment {
    specId: string;
    agentId?: string;
    validated: boolean;
    reason: string;
}
export interface DependencyNode {
    id: string;
    dependsOn: readonly string[];
}
/** Returns the cycle path (e.g. `["a","b","c","a"]`) if one exists, else `null`. */
export declare function findCycle(nodes: readonly DependencyNode[]): string[] | null;
/** Validate a whole workflow draft: shape, unique ids, known deps, no cycles. */
export declare function validateWorkflowDraft(draft: WorkflowDraft): void;
