/**
 * QA Agent.
 *
 * One model call evaluates each acceptance criterion against the supplied
 * artifacts and returns findings + defects + a verdict. Deterministic
 * post-processing then enforces "QA must not automatically approve its own
 * work": any acceptance criterion the model didn't address becomes an
 * unsatisfied finding, and a `"pass"` verdict is downgraded to `"fail"`
 * whenever any finding is unsatisfied — on top of `validateQAResult`'s own
 * structural rejection of an unevidenced pass.
 */
import { type Agent, type AgentLimits, type Environment, type ModelProvider, type PermissionGuard, type QAResult, type QATask, type Task } from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
export interface QaAgentConfig {
    model?: ModelProvider;
    audit: AuditLog;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    environment?: Environment;
    logContent?: boolean;
}
export declare class QaAgent extends GeneralAgent<QATask, QAResult> {
    protected readonly agentId = "qa-agent";
    protected readonly role = "qa";
    protected readonly limits: AgentLimits;
    private readonly model;
    private readonly logContent;
    constructor(config: QaAgentConfig);
    protected validateInput(raw: unknown): QATask;
    protected validateOutput(output: unknown): asserts output is QAResult;
    protected run(input: QATask, task: Task, _agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<QAResult>;
    private callModel;
}
