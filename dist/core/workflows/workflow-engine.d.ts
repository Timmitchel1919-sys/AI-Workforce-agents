/**
 * WorkflowEngine — coordinates a multi-agent task graph.
 *
 * It is a thin scheduler: it decides *which* ready spec to dispatch next and
 * *what happens* to the graph when a task completes, fails, or needs approval.
 * It never talks to a model, a tool, or a credential itself — every task goes
 * through the existing `Orchestrator` (permission gate → approval gate →
 * `RoutingAgentExecutor`), so a workflow inherits all of Phase 2A–4's
 * enforcement for free. Agent assignment is independently re-validated
 * (`assignAgent`) — a Project-Manager-recommended assignment is never trusted
 * blindly.
 */
import { type Workflow, type WorkflowDraft } from "../../contracts/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { AuditLog } from "../audit/audit-log.js";
import { HandoffSystem } from "../handoffs/handoff-system.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { WorkflowSystem } from "./workflow-system.js";
export interface WorkflowEngineDeps {
    registry: AgentRegistry;
    workflows: WorkflowSystem;
    orchestrator: Orchestrator;
    handoffs: HandoffSystem;
    audit: AuditLog;
    permissions: PermissionSystem;
    /** Used only for the assignment pre-check when a spec declares `expectedTools`. */
    toolRegistry?: ToolRegistry;
    clock?: () => number;
    /** Agent id that runs `planFromObjective`. Defaults to `"project-manager-agent"`. */
    projectManagerAgentId?: string;
}
export interface PlanFromObjectiveInput {
    name: string;
    description: string;
    projectId: string;
    participatingAgents: readonly string[];
    objective: string;
    constraints?: readonly string[];
    availableAgents?: readonly string[];
    successCriteria?: readonly string[];
    failureBehavior?: WorkflowDraft["failureBehavior"];
    limits?: WorkflowDraft["limits"];
    retryPolicy?: WorkflowDraft["retryPolicy"];
    metadata?: Record<string, unknown>;
}
export declare class WorkflowEngine {
    private readonly registry;
    private readonly workflows;
    private readonly orchestrator;
    private readonly handoffs;
    private readonly audit;
    private readonly permissions;
    private readonly toolRegistry;
    private readonly clock;
    private readonly projectManagerAgentId;
    constructor(deps: WorkflowEngineDeps);
    /** Validate, create, and run a fully-authored workflow. */
    submit(draft: WorkflowDraft): Promise<Workflow>;
    /** Start (or continue) scheduling a previously created workflow. */
    run(workflowId: string): Promise<Workflow>;
    /** Re-enter a workflow parked in `awaiting_approval` once decisions exist. */
    resume(workflowId: string): Promise<Workflow>;
    /**
     * Run the Project Manager once to decompose a high-level objective, validate
     * every recommendation, and build + run the resulting workflow. `depth` (for
     * nested calls) is checked against `limits.maxDelegationDepth`.
     */
    planFromObjective(input: PlanFromObjectiveInput, depth?: number): Promise<Workflow>;
    private schedule;
    private dispatch;
    private applyTaskOutcome;
    private ensureHandoffs;
    private propagateSkip;
    private fail;
    private finalize;
    private emit;
}
