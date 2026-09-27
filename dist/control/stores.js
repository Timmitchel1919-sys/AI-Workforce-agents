/**
 * Control-plane-owned operational state. These are the "smallest necessary"
 * state models the audit called for: an enabled/disabled flag per agent, and a
 * paused flag per workflow. Core definitions (the `AgentRegistry` entry, the
 * `Workflow`) are never mutated by the Control Plane.
 */
import { requireExecutionId, } from "../contracts/index.js";
import { InMemoryRepository, now } from "../core/index.js";
/** `AgentOperationalRecord.id` for a project-scoped override. Global record id is `agentId` alone. */
function scopedId(agentId, projectId) {
    return `${agentId}\u0000${requireExecutionId(projectId, "projectId")}`;
}
export class AgentOperationalStore {
    repo;
    constructor(repo = new InMemoryRepository()) {
        this.repo = repo;
    }
    /**
     * Unknown agents are enabled by default. Most-specific-wins: when
     * `projectId` is given and a project-scoped record exists for it, THAT
     * record decides `enabled` on its own, regardless of the global record.
     * Falls back to the global record (or the default `true`) otherwise.
     */
    isEnabled(agentId, projectId) {
        const record = this.get(agentId, projectId);
        return record ? record.enabled : true;
    }
    /**
     * With `projectId`: the project-scoped record if one exists, else the
     * global record (or `undefined` if neither exists). Without it: the
     * global record only — unchanged from before this layer.
     */
    get(agentId, projectId) {
        if (projectId !== undefined) {
            const scoped = this.repo.findById(scopedId(agentId, projectId));
            if (scoped)
                return scoped;
        }
        return this.repo.findById(agentId);
    }
    /** Every record — global and project-scoped alike. Optionally narrowed to one project's scoped records. */
    list(projectId) {
        const all = this.repo.list();
        return projectId === undefined ? all : all.filter((r) => r.projectId === projectId);
    }
    disable(agentId, by, reason, projectId) {
        return this.write(agentId, projectId, (previous) => ({
            enabled: false,
            disabledBy: by,
            disabledReason: reason,
            disabledAt: now(),
            enabledBy: previous?.enabledBy,
            enabledAt: previous?.enabledAt,
        }));
    }
    enable(agentId, by, projectId) {
        return this.write(agentId, projectId, (previous) => ({
            enabled: true,
            disabledBy: previous?.disabledBy,
            disabledReason: previous?.disabledReason,
            disabledAt: previous?.disabledAt,
            enabledBy: by,
            enabledAt: now(),
        }));
    }
    write(agentId, projectId, fields) {
        const id = projectId === undefined ? agentId : scopedId(agentId, projectId);
        // The PREVIOUS state of THIS SAME record (global or this exact project scope) carries forward
        // its own disabledBy/enabledBy history — never borrowed from a different scope's record.
        const previous = this.repo.findById(id);
        const record = {
            id,
            agentId,
            ...(projectId !== undefined ? { projectId } : {}),
            ...fields(previous),
            updatedAt: now(),
        };
        this.repo.upsert(record);
        return record;
    }
}
export class WorkflowControlStore {
    repo;
    constructor(repo = new InMemoryRepository()) {
        this.repo = repo;
    }
    isPaused(workflowId) {
        return this.repo.findById(workflowId)?.paused ?? false;
    }
    get(workflowId) {
        return this.repo.findById(workflowId);
    }
    list() {
        return this.repo.list();
    }
    pause(workflowId, by, reason) {
        const timestamp = now();
        const record = {
            id: workflowId,
            workflowId,
            paused: true,
            pausedBy: by,
            pauseReason: reason,
            pausedAt: timestamp,
            updatedAt: timestamp,
        };
        this.repo.upsert(record);
        return record;
    }
    resume(workflowId, by) {
        const timestamp = now();
        const previous = this.repo.findById(workflowId);
        const record = {
            id: workflowId,
            workflowId,
            paused: false,
            pausedBy: previous?.pausedBy,
            pauseReason: previous?.pauseReason,
            pausedAt: previous?.pausedAt,
            resumedBy: by,
            resumedAt: timestamp,
            updatedAt: timestamp,
        };
        this.repo.upsert(record);
        return record;
    }
}
