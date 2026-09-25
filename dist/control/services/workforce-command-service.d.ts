/**
 * WorkforceCommandService — the write side of the Control Plane.
 *
 * Every command runs the same pipeline:
 *   1. validate input             (shape)
 *   2. validate authorization     (role capability + project scope)
 *   3. validate current state     (resource exists & is in a valid state)
 *   4. execute through core       (ApprovalSystem / Orchestrator / TaskSystem /
 *                                  WorkflowSystem / WorkflowEngine / stores)
 *   5. create audit event         (`control_command`, ALWAYS — including denied)
 *   6. return a structured result
 *
 * The UI never mutates state directly; it calls these methods. Every call
 * carries a correlation id (supplied by the caller or minted here) that is
 * written to the audit event and returned on the result, so a control request
 * can be traced through the command, the core operation, and the audit log.
 */
import { type AccessCommandInput, type ExecutionCancelCommandInput, type AgentCommandInput, type ApprovalCommandInput, type CommandOptions, type ControlCommandResult, type CreateExecutionPlanCommandInput, type ExecutionPlanCommandInput, type OperatorPrincipal, type RejectCommandInput, type TaskCommandInput, type WorkflowCommandInput } from "../../contracts/index.js";
import { type ControlPlaneContext } from "../context.js";
export declare class WorkforceCommandService {
    private readonly ctx;
    private readonly maxRetries;
    constructor(ctx: ControlPlaneContext);
    approve(principal: OperatorPrincipal, input: ApprovalCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    reject(principal: OperatorPrincipal, input: RejectCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    private decideApproval;
    createProgram(principal: OperatorPrincipal, input: {
        projectId?: unknown;
        id?: unknown;
        name?: unknown;
        objective?: unknown;
    }, options?: CommandOptions): Promise<ControlCommandResult>;
    createWorkstream(principal: OperatorPrincipal, input: {
        projectId?: unknown;
        programId?: unknown;
        id?: unknown;
        name?: unknown;
        objective?: unknown;
    }, options?: CommandOptions): Promise<ControlCommandResult>;
    addTaskToWorkstream(principal: OperatorPrincipal, input: {
        projectId?: unknown;
        programId?: unknown;
        workstreamId?: unknown;
        task?: unknown;
    }, options?: CommandOptions): Promise<ControlCommandResult>;
    tickSoftwareFactory(principal: OperatorPrincipal, input?: {
        projectId?: unknown;
        programId?: unknown;
    }, options?: CommandOptions): Promise<ControlCommandResult>;
    /**
     * Create an execution plan from a planning request. The server derives
     * environments, agents, blockers and status; client-supplied values for
     * any of those are ignored.
     */
    createExecutionPlan(principal: OperatorPrincipal, input: CreateExecutionPlanCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    /** Re-evaluate the current revision; creates a new version when inputs changed. */
    replanExecutionPlan(principal: OperatorPrincipal, input: ExecutionPlanCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    /** Request human approval for a ready plan with protected stages. */
    submitExecutionPlan(principal: OperatorPrincipal, input: ExecutionPlanCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    private resolvePlan;
    /** Run a planning operation and map domain errors to control outcomes. */
    private runPlanning;
    approveAccess(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    rejectAccess(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    suspendAccess(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    reactivateAccess(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    revokeAccess(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    changeOperatorRole(principal: OperatorPrincipal, input: AccessCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    /**
     * The capability is checked here AND inside AccessService; domain errors map
     * onto the existing control outcomes (denied → 403, not_found → 404,
     * invalid_state → 409, invalid_request → 400).
     */
    private runAccess;
    /** Cancel one execution session (operators). Idempotent and audited. */
    cancelExecution(principal: OperatorPrincipal, input: ExecutionCancelCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    /**
     * Emergency kill switch for ONE session (administrators only). Not a shell
     * kill: it asks the governed session to terminate, and is audited.
     */
    killExecution(principal: OperatorPrincipal, input: ExecutionCancelCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    private runExecutionCancel;
    cancelTask(principal: OperatorPrincipal, input: TaskCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    retryTask(principal: OperatorPrincipal, input: TaskCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    pauseWorkflow(principal: OperatorPrincipal, input: WorkflowCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    resumeWorkflow(principal: OperatorPrincipal, input: WorkflowCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    cancelWorkflow(principal: OperatorPrincipal, input: WorkflowCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    disableAgent(principal: OperatorPrincipal, input: AgentCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    enableAgent(principal: OperatorPrincipal, input: AgentCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    private setAgentEnabled;
    private resolveTask;
    private resolveWorkflow;
    /**
     * Record a `control_command` audit event and return the structured result.
     * `errorKind` refines a non-`executed` outcome; when omitted it defaults to
     * `forbidden` for a denial and `invalid_request` for a rejection.
     */
    private audited;
    /** Best-effort real-time fan-out. A throwing publisher never breaks a command. */
    private publish;
}
