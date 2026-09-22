import { ValidationError, } from "../../contracts/index.js";
/**
 * Project-isolated context store.
 *
 * Three scopes are supported: task, project, and agent. Every entry is bound
 * to a project. Reads require the caller to name the project and return
 * nothing unless it matches. There is no global, cross-project view and no
 * unrestricted shared memory.
 */
export class ContextSystem {
    taskContexts = new Map();
    projectContexts = new Map();
    agentContexts = new Map();
    setProjectContext(projectId, values) {
        const existing = this.projectContexts.get(projectId);
        const next = {
            scope: "project",
            projectId,
            values: { ...(existing?.values ?? {}), ...values },
        };
        this.projectContexts.set(projectId, next);
        return this.clone(next);
    }
    getProjectContext(projectId) {
        const ctx = this.projectContexts.get(projectId);
        return ctx ? this.clone(ctx) : undefined;
    }
    setTaskContext(taskId, projectId, values) {
        const existing = this.taskContexts.get(taskId);
        if (existing && existing.projectId !== projectId) {
            throw new ValidationError(`task ${taskId} is already bound to project ${existing.projectId}`);
        }
        const next = {
            scope: "task",
            taskId,
            projectId,
            values: { ...(existing?.values ?? {}), ...values },
        };
        this.taskContexts.set(taskId, next);
        return this.clone(next);
    }
    getTaskContext(taskId, projectId) {
        const ctx = this.taskContexts.get(taskId);
        return ctx && ctx.projectId === projectId ? this.clone(ctx) : undefined;
    }
    setAgentContext(agentId, projectId, values) {
        const key = this.agentKey(agentId, projectId);
        const existing = this.agentContexts.get(key);
        const next = {
            scope: "agent",
            agentId,
            projectId,
            values: { ...(existing?.values ?? {}), ...values },
        };
        this.agentContexts.set(key, next);
        return this.clone(next);
    }
    getAgentContext(agentId, projectId) {
        const ctx = this.agentContexts.get(this.agentKey(agentId, projectId));
        return ctx ? this.clone(ctx) : undefined;
    }
    /** Every context visible to a single project. Never spans projects. */
    viewForProject(projectId) {
        const out = [];
        const project = this.getProjectContext(projectId);
        if (project)
            out.push(project);
        for (const ctx of this.taskContexts.values()) {
            if (ctx.projectId === projectId)
                out.push(this.clone(ctx));
        }
        for (const ctx of this.agentContexts.values()) {
            if (ctx.projectId === projectId)
                out.push(this.clone(ctx));
        }
        return out;
    }
    agentKey(agentId, projectId) {
        return `${projectId}::${agentId}`;
    }
    clone(ctx) {
        return { ...ctx, values: { ...ctx.values } };
    }
}
