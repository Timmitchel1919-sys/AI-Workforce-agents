/**
 * Project Manager Agent.
 *
 * Two modes on the same `GeneralAgent` pipeline:
 *
 *  - `"decompose"`: turn a high-level objective into a dependency-ordered
 *    subtask plan (`ProjectManagerDecision.subtasks`).
 *  - `"summarize"`: turn a set of prior task results into a workflow-level
 *    summary + `finalStatus`.
 *
 * It makes exactly one model call and never touches a tool, a task, or the
 * agent registry — the `WorkflowEngine` is the only thing authorized to turn
 * a decision into real tasks, and it re-validates every recommendation.
 */
import { type Agent, type AgentLimits, type Environment, type ModelProvider, type PermissionGuard, type ProjectManagerDecision, type ProjectManagerTask, type Task } from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
export interface ProjectManagerAgentConfig {
    model?: ModelProvider;
    audit: AuditLog;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    environment?: Environment;
    logContent?: boolean;
}
export declare class ProjectManagerAgent extends GeneralAgent<ProjectManagerTask, ProjectManagerDecision> {
    protected readonly agentId = "project-manager-agent";
    protected readonly role = "project-manager";
    protected readonly limits: AgentLimits;
    private readonly model;
    private readonly logContent;
    constructor(config: ProjectManagerAgentConfig);
    protected validateInput(raw: unknown): ProjectManagerTask;
    protected validateOutput(output: unknown): asserts output is ProjectManagerDecision;
    protected run(input: ProjectManagerTask, task: Task, _agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<ProjectManagerDecision>;
    private callModel;
}
