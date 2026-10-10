/**
 * Control-plane-owned operational state. These are the "smallest necessary"
 * state models the audit called for: an enabled/disabled flag per agent, and a
 * paused flag per workflow. Core definitions (the `AgentRegistry` entry, the
 * `Workflow`) are never mutated by the Control Plane.
 */
import { type AgentOperationalRecord, type Repository, type WorkflowControlRecord } from "../contracts/index.js";
export declare class AgentOperationalStore {
    private readonly repo;
    constructor(repo?: Repository<AgentOperationalRecord>);
    /**
     * Unknown agents are enabled by default. Most-specific-wins: when
     * `projectId` is given and a project-scoped record exists for it, THAT
     * record decides `enabled` on its own, regardless of the global record.
     * Falls back to the global record (or the default `true`) otherwise.
     */
    isEnabled(agentId: string, projectId?: string): boolean;
    /**
     * With `projectId`: the project-scoped record if one exists, else the
     * global record (or `undefined` if neither exists). Without it: the
     * global record only — unchanged from before this layer.
     */
    get(agentId: string, projectId?: string): AgentOperationalRecord | undefined;
    /** Every record — global and project-scoped alike. Optionally narrowed to one project's scoped records. */
    list(projectId?: string): AgentOperationalRecord[];
    disable(agentId: string, by: string, reason: string, projectId?: string): AgentOperationalRecord;
    enable(agentId: string, by: string, projectId?: string): AgentOperationalRecord;
    private write;
}
export declare class WorkflowControlStore {
    private readonly repo;
    constructor(repo?: Repository<WorkflowControlRecord>);
    isPaused(workflowId: string): boolean;
    get(workflowId: string): WorkflowControlRecord | undefined;
    list(): WorkflowControlRecord[];
    pause(workflowId: string, by: string, reason: string | undefined): WorkflowControlRecord;
    resume(workflowId: string, by: string): WorkflowControlRecord;
}
