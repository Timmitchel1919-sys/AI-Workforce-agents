import { type Agent, type AgentLimits, type Environment, type ModelProvider, type PermissionGuard, type Task } from "../../contracts/index.js";
import { type AgentDescriptor, type SpecialistResult, type SpecialistTask } from "../../contracts/workforce.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
export interface SpecialistAgentConfig {
    descriptor: AgentDescriptor;
    model?: ModelProvider;
    audit: AuditLog;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    environment?: Environment;
    logContent?: boolean;
}
export declare class SpecialistAgent extends GeneralAgent<SpecialistTask, SpecialistResult> {
    protected readonly agentId: string;
    protected readonly role: string;
    protected readonly limits: AgentLimits;
    private readonly descriptor;
    private readonly model;
    private readonly logContent;
    constructor(config: SpecialistAgentConfig);
    protected validateInput(raw: unknown): SpecialistTask;
    protected validateOutput(output: unknown): asserts output is SpecialistResult;
    protected run(input: SpecialistTask, task: Task, _agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<SpecialistResult>;
    private callModel;
}
