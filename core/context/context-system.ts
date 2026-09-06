import {
  type AgentContext,
  type Context,
  type ProjectContext,
  type TaskContext,
  ValidationError,
} from "../../contracts/index.js";

/**
 * Project-isolated context store.
 *
 * Three scopes are supported: task, project, and agent. Every entry is bound
 * to a project. Reads require the caller to name the project and return
 * nothing unless it matches. There is no global, cross-project view and no
 * unrestricted shared memory.
 */
export class ContextSystem {
  private readonly taskContexts = new Map<string, TaskContext>();
  private readonly projectContexts = new Map<string, ProjectContext>();
  private readonly agentContexts = new Map<string, AgentContext>();

  setProjectContext(
    projectId: string,
    values: Record<string, unknown>,
  ): ProjectContext {
    const existing = this.projectContexts.get(projectId);
    const next: ProjectContext = {
      scope: "project",
      projectId,
      values: { ...(existing?.values ?? {}), ...values },
    };
    this.projectContexts.set(projectId, next);
    return this.clone(next);
  }

  getProjectContext(projectId: string): ProjectContext | undefined {
    const ctx = this.projectContexts.get(projectId);
    return ctx ? this.clone(ctx) : undefined;
  }

  setTaskContext(
    taskId: string,
    projectId: string,
    values: Record<string, unknown>,
  ): TaskContext {
    const existing = this.taskContexts.get(taskId);
    if (existing && existing.projectId !== projectId) {
      throw new ValidationError(
        `task ${taskId} is already bound to project ${existing.projectId}`,
      );
    }
    const next: TaskContext = {
      scope: "task",
      taskId,
      projectId,
      values: { ...(existing?.values ?? {}), ...values },
    };
    this.taskContexts.set(taskId, next);
    return this.clone(next);
  }

  getTaskContext(taskId: string, projectId: string): TaskContext | undefined {
    const ctx = this.taskContexts.get(taskId);
    return ctx && ctx.projectId === projectId ? this.clone(ctx) : undefined;
  }

  setAgentContext(
    agentId: string,
    projectId: string,
    values: Record<string, unknown>,
  ): AgentContext {
    const key = this.agentKey(agentId, projectId);
    const existing = this.agentContexts.get(key);
    const next: AgentContext = {
      scope: "agent",
      agentId,
      projectId,
      values: { ...(existing?.values ?? {}), ...values },
    };
    this.agentContexts.set(key, next);
    return this.clone(next);
  }

  getAgentContext(
    agentId: string,
    projectId: string,
  ): AgentContext | undefined {
    const ctx = this.agentContexts.get(this.agentKey(agentId, projectId));
    return ctx ? this.clone(ctx) : undefined;
  }

  /** Every context visible to a single project. Never spans projects. */
  viewForProject(projectId: string): Context[] {
    const out: Context[] = [];
    const project = this.getProjectContext(projectId);
    if (project) out.push(project);
    for (const ctx of this.taskContexts.values()) {
      if (ctx.projectId === projectId) out.push(this.clone(ctx));
    }
    for (const ctx of this.agentContexts.values()) {
      if (ctx.projectId === projectId) out.push(this.clone(ctx));
    }
    return out;
  }

  private agentKey(agentId: string, projectId: string): string {
    return `${projectId}::${agentId}`;
  }

  private clone<T extends Context>(ctx: T): T {
    return { ...ctx, values: { ...ctx.values } };
  }
}
