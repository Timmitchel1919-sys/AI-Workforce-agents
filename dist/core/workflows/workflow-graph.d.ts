/**
 * Pure(ish) helpers the `WorkflowEngine` uses to walk the task graph and
 * validate agent assignments. Kept separate from the engine so scheduling
 * logic and assignment validation are independently testable — mirrors the
 * `core/tools/tool-policy.ts` split from `ToolExecutionEngine`.
 */
import { type AgentAssignment, type RetryPolicy, type Workflow, type WorkflowTaskRecord, type WorkflowTaskSpec } from "../../contracts/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { ToolRegistry } from "../tools/tool-registry.js";
/** Spec ids whose dependencies have all completed and which have not started. */
export declare function computeReadySpecs(workflow: Workflow): WorkflowTaskSpec[];
/** True while any task could still run or is waiting on something. */
export declare function hasActionableWork(workflow: Workflow): boolean;
/**
 * Validate (never blindly trust) an agent assignment for a task spec: the
 * agent must exist, be declared in `workflow.participatingAgents`, be eligible
 * for the task's type + project, and — when a capability was requested —
 * actually hold it. Tool expectations are checked against the `ToolRegistry`
 * when supplied.
 */
export declare function assignAgent(spec: WorkflowTaskSpec, workflow: Workflow, registry: AgentRegistry, permissions: PermissionSystem, toolRegistry?: ToolRegistry): AgentAssignment;
/**
 * `AgentExecutionError` (and the orchestrator's own failures) format their
 * message as `[agentId:reason] message`. Retry policy reads the `reason` back
 * out of that convention rather than re-deriving it — documented coupling.
 */
export declare function extractFailureReason(message: string): string | undefined;
export declare function shouldRetry(policy: RetryPolicy, reason: string | undefined, retryCountSoFar: number): boolean;
/** Read `output.metadata.counters.toolCalls` when a General Agent provided it. */
export declare function extractToolCallCount(output: unknown): number;
export declare function initialTaskRecord(specId: string, now: string): WorkflowTaskRecord;
