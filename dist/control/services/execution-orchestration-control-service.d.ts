/**
 * ExecutionOrchestrationControlService — the governed command/query surface
 * for Execution Orchestration (Layer 4).
 *
 * Every command is authorized by the orchestrator, audited as a
 * `control_command` (denied and rejected included) and returned as a
 * structured `ControlCommandResult`. The UI never mutates run state itself.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import type { RunSummary, RunView } from "../../contracts/execution-orchestration.js";
import type { AuditLog, ExecutionOrchestrator, PromptIntelligenceService } from "../../core/index.js";
type Body = Record<string, unknown>;
export declare class ExecutionOrchestrationControlService {
    private readonly orchestrator;
    private readonly prompts;
    private readonly audit;
    constructor(orchestrator: ExecutionOrchestrator, prompts: Pick<PromptIntelligenceService, "get">, audit: AuditLog);
    list(principal: OperatorPrincipal, filter?: {
        projectId?: string;
        limit?: number;
    }): RunSummary[];
    get(principal: OperatorPrincipal, runId: string): Promise<RunView>;
    orchestrationCreate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    /** Start = mark the run started (asking for destructive approvals) and advance once. */
    orchestrationStart(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    orchestrationAdvance(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    orchestrationPause(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    orchestrationResume(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    orchestrationCancel(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    orchestrationRetryTask(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    private run;
    private result;
}
export {};
