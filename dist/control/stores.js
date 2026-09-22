import { InMemoryRepository, now } from "../core/index.js";
export class AgentOperationalStore {
    repo;
    constructor(repo = new InMemoryRepository()) {
        this.repo = repo;
    }
    /** Unknown agents are enabled by default. */
    isEnabled(agentId) {
        const record = this.repo.findById(agentId);
        return record ? record.enabled : true;
    }
    get(agentId) {
        return this.repo.findById(agentId);
    }
    list() {
        return this.repo.list();
    }
    disable(agentId, by, reason) {
        const timestamp = now();
        const previous = this.repo.findById(agentId);
        const record = {
            id: agentId,
            agentId,
            enabled: false,
            disabledBy: by,
            disabledReason: reason,
            disabledAt: timestamp,
            enabledBy: previous?.enabledBy,
            enabledAt: previous?.enabledAt,
            updatedAt: timestamp,
        };
        this.repo.upsert(record);
        return record;
    }
    enable(agentId, by) {
        const timestamp = now();
        const previous = this.repo.findById(agentId);
        const record = {
            id: agentId,
            agentId,
            enabled: true,
            disabledBy: previous?.disabledBy,
            disabledReason: previous?.disabledReason,
            disabledAt: previous?.disabledAt,
            enabledBy: by,
            enabledAt: timestamp,
            updatedAt: timestamp,
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
