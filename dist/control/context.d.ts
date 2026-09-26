/**
 * The bundle of core services + control-plane stores that the query and command
 * services read from and act through. Everything is injected — the Control
 * Plane owns none of it and constructs none of it.
 */
import { AgentRegistry, ApprovalSystem, AuditLog, AccessService, EnvironmentRegistry, TechnologyCatalog, ExecutionPlanningService, ExecutionManager, Orchestrator, PermissionSystem, ProjectRegistry, TaskSystem, ToolRegistry, WorkflowEngine, WorkflowSystem, type DeploymentOrchestrator, type EnvironmentAdapterRegistry, type InMemoryExecutionReceiptStore, type SourceControlOrchestrator, type VerificationService } from "../core/index.js";
import type { ExecutionRecordStore, WorkspaceControl } from "../contracts/index.js";
import { type HealthProbe } from "./health.js";
import { type ControlEventPublisher } from "./ports.js";
import { AgentOperationalStore, WorkflowControlStore } from "./stores.js";
export interface ControlPlaneContext {
    agents: AgentRegistry;
    tasks: TaskSystem;
    workflows: WorkflowSystem;
    approvals: ApprovalSystem;
    permissions: PermissionSystem;
    tools: ToolRegistry;
    projects: ProjectRegistry;
    audit: AuditLog;
    agentOps: AgentOperationalStore;
    workflowControl: WorkflowControlStore;
    /**
     * Environment orchestration state (descriptors, hosts, detected instances).
     * Optional so existing contexts without environment support keep working;
     * when absent every environment query returns an empty result.
     */
    environments?: EnvironmentRegistry;
    /** Registered knowledge sources for the Spatial Graph KNOWLEDGE mode. */
    knowledge?: import("../contracts/graph.js").KnowledgeSourceProvider;
    /**
     * Execution planning (EO-3.1). Optional: when absent every plan query
     * returns "not found" and plan commands are rejected as invalid state.
     * Planning never executes anything.
     */
    planning?: ExecutionPlanningService;
    /**
     * EO-4.1 execution control boundary: pre-flight, session metadata,
     * cancel/kill. Optional; absent → execution routes 404. Never executes.
     */
    execution?: ExecutionManager;
    /** Execution receipts (evidence per invocation). */
    executionReceipts?: Pick<InMemoryExecutionReceiptStore, "forSession">;
    /** EO-4.4 verification history. */
    verification?: Pick<VerificationService, "listHistory">;
    /** EO-4.8 durable execution records (receipts, verifications, releases). */
    executionRecords?: ExecutionRecordStore;
    /** Current source fingerprints (source-consistency display). */
    workspaceControl?: Pick<WorkspaceControl, "sourceFingerprint">;
    /** EO-4.6 governed source control (reviews, stage sets, commits, pushes). */
    sourceControl?: Pick<SourceControlOrchestrator, "activity">;
    /** EO-4.6 deployments (release receipts, registered targets). */
    deployments?: Pick<DeploymentOrchestrator, "listReleases" | "listTargets">;
    /** EO-4.5 environment execution adapter/runner status. */
    environmentAdapters?: Pick<EnvironmentAdapterRegistry, "status">;
    /**
     * Operator access lifecycle (AUTHZ-1): pending → approve/reject →
     * suspend/reactivate/revoke. Optional; absent → access routes 404.
     */
    access?: AccessService;
    /** The planner's technology catalog; defaults to the built-in catalog. */
    technologyCatalog?: TechnologyCatalog;
    /**
     * Needed by command enactment (approve → resume). Structural: only these
     * methods are used, so a test can pass a stub.
     */
    orchestrator?: Pick<Orchestrator, "recordApprovalDecision" | "resume">;
    softwareFactory?: import("../core/orchestrator/software-factory-orchestrator.js").SoftwareFactoryOrchestrator;
    workflowEngine?: Pick<WorkflowEngine, "resume">;
    /** Health probes. Anything not listed is reported as `unknown` (unmeasured). */
    healthProbes?: readonly HealthProbe[];
    /**
     * Optional real-time fan-out. When present, a successful command publishes a
     * `command_result` event. A publisher that throws never breaks the command.
     */
    events?: ControlEventPublisher;
    clock?: () => number;
    /** Max task retries an operator may trigger from the Control Plane. Default 3. */
    maxOperatorRetries?: number;
}
