/**
 * Developer Agent.
 *
 * Planning/review-oriented: one model call produces a `DeveloperResult` —
 * a plan, a list of *proposed* changes (description + rationale + risk
 * level), risks, open questions, and a recommendation. It never writes a
 * file, runs a command, or touches a repository — no such dependency is
 * injected, so none is reachable.
 */
import { type Agent, type AgentLimits, type DeveloperResult, type DeveloperTask, type Environment, type ModelProvider, type PermissionGuard, type Task } from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
export interface DeveloperAgentConfig {
    model?: ModelProvider;
    audit: AuditLog;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    environment?: Environment;
    logContent?: boolean;
}
export declare class DeveloperAgent extends GeneralAgent<DeveloperTask, DeveloperResult> {
    protected readonly agentId = "developer-agent";
    protected readonly role = "developer";
    protected readonly limits: AgentLimits;
    private readonly model;
    private readonly logContent;
    constructor(config: DeveloperAgentConfig);
    protected validateInput(raw: unknown): DeveloperTask;
    protected validateOutput(output: unknown): asserts output is DeveloperResult;
    protected run(input: DeveloperTask, task: Task, _agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<DeveloperResult>;
    private callModel;
}
