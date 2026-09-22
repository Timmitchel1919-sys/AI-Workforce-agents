import { type AgentContext, type Context, type ProjectContext, type TaskContext } from "../../contracts/index.js";
/**
 * Project-isolated context store.
 *
 * Three scopes are supported: task, project, and agent. Every entry is bound
 * to a project. Reads require the caller to name the project and return
 * nothing unless it matches. There is no global, cross-project view and no
 * unrestricted shared memory.
 */
export declare class ContextSystem {
    private readonly taskContexts;
    private readonly projectContexts;
    private readonly agentContexts;
    setProjectContext(projectId: string, values: Record<string, unknown>): ProjectContext;
    getProjectContext(projectId: string): ProjectContext | undefined;
    setTaskContext(taskId: string, projectId: string, values: Record<string, unknown>): TaskContext;
    getTaskContext(taskId: string, projectId: string): TaskContext | undefined;
    setAgentContext(agentId: string, projectId: string, values: Record<string, unknown>): AgentContext;
    getAgentContext(agentId: string, projectId: string): AgentContext | undefined;
    /** Every context visible to a single project. Never spans projects. */
    viewForProject(projectId: string): Context[];
    private agentKey;
    private clone;
}
