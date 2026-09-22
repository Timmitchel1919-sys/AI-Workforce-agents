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
    /** Unknown agents are enabled by default. */
    isEnabled(agentId: string): boolean;
    get(agentId: string): AgentOperationalRecord | undefined;
    list(): AgentOperationalRecord[];
    disable(agentId: string, by: string, reason: string): AgentOperationalRecord;
    enable(agentId: string, by: string): AgentOperationalRecord;
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
