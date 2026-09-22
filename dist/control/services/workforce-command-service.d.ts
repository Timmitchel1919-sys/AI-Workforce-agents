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
import { type AgentCommandInput, type ApprovalCommandInput, type CommandOptions, type ControlCommandResult, type OperatorPrincipal, type RejectCommandInput, type TaskCommandInput, type WorkflowCommandInput } from "../../contracts/index.js";
import { type ControlPlaneContext } from "../context.js";
export declare class WorkforceCommandService {
    private readonly ctx;
    private readonly maxRetries;
    constructor(ctx: ControlPlaneContext);
    approve(principal: OperatorPrincipal, input: ApprovalCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    reject(principal: OperatorPrincipal, input: RejectCommandInput, options?: CommandOptions): Promise<ControlCommandResult>;
    private decideApproval;
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
