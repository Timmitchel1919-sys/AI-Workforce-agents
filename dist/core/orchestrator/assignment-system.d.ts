/**
 * SpecialistAssignmentService — the ONE place an assignment is created,
 * transitioned, or reassigned.
 *
 * The invariants it enforces, in the order they are enforced:
 *
 *  1. NO QUALIFIED AGENT  -> the task is BLOCKED with `NO_QUALIFIED_AGENT`.
 *     A blocked task is a real, visible outcome. It is never downgraded into
 *     "assigned to the closest available agent".
 *
 *  2. An assignment may only be created from a QUALIFIED agent, and it carries
 *     the qualification evidence verbatim. The evidence is the assignment's
 *     provenance: later you can always answer "why did this agent get this?".
 *
 *  3. Write scope is owned, not shared. Acquiring overlapping scope in the same
 *     workspace is denied while another live lease holds it.
 *
 *  4. Reassignment never erases history. The failed assignment transitions to
 *     `reassigned` (terminal) and the replacement records `replacesAssignmentId`.
 *
 *  5. Review independence. An implementer can never be the reviewer of its own
 *     change set, whatever the request says.
 */
import { type AgentDescriptor, type AgentCandidateEvidence, type Assignment, type AssignmentStatus, type TaskRequirements } from "../../contracts/index.js";
import { NO_QUALIFIED_AGENT } from "../environments/agent-qualification-router.js";
import { EnvironmentRegistry } from "../environments/environment-registry.js";
import { WriteScopeLeaseManager, type LeaseRepository } from "./lease-manager.js";
import { AuditLog } from "../audit/audit-log.js";
import type { WriteScopeLease } from "../../contracts/index.js";
export declare class InMemoryAssignmentRepository {
    private readonly items;
    list(): Assignment[];
    findById(id: string): Assignment | undefined;
    upsert(item: Assignment): void;
    /** The most recent assignment for a task — the one currently in force. */
    currentForTask(taskId: string): Assignment | undefined;
    historyForTask(taskId: string): Assignment[];
}
export declare class InMemoryLeaseRepository implements LeaseRepository<WriteScopeLease> {
    private readonly items;
    list(): WriteScopeLease[];
    findById(id: string): WriteScopeLease | undefined;
    upsert(item: WriteScopeLease): void;
}
export type AssignmentOutcome = {
    readonly status: "assigned";
    readonly assignment: Assignment;
} | {
    readonly status: "blocked";
    readonly reason: typeof NO_QUALIFIED_AGENT;
    readonly evidence: readonly AgentCandidateEvidence[];
};
export interface AssignOptions {
    readonly taskId: string;
    readonly assignedBy: string;
    readonly correlationId?: string;
    readonly workspaceId?: string;
    /** Workspace to take the write lease in, when the task will write files. */
    readonly writeScope?: readonly string[];
    readonly leaseTtlMs?: number;
    readonly now?: string;
    readonly isEnabled?: (agentId: string, projectId: string) => boolean;
    /** Agents that may not receive this task (e.g. the agent that just failed). */
    readonly excludeAgentIds?: readonly string[];
}
export declare class SpecialistAssignmentService {
    private readonly assignments;
    private readonly descriptors;
    private readonly clock;
    private readonly qualification;
    readonly leases: WriteScopeLeaseManager;
    private readonly audit;
    constructor(assignments: InMemoryAssignmentRepository, descriptors: () => readonly AgentDescriptor[], leaseRepository?: LeaseRepository<WriteScopeLease>, clock?: () => string, audit?: AuditLog, environmentRegistry?: EnvironmentRegistry);
    /**
     * The one qualification router, exposed so planning reads the SAME rules
     * that assignment enforces. A second copy of the qualification logic is how
     * a plan starts disagreeing with what actually happened.
     */
    qualify(requirements: TaskRequirements, descriptors: readonly AgentDescriptor[], context?: {
        isEnabled?: (agentId: string, projectId: string) => boolean;
    }): import("../environments/agent-qualification-router.js").QualificationOutcome;
    assign(requirements: TaskRequirements, options: AssignOptions): AssignmentOutcome;
    private acquireWriteScope;
    transition(assignmentId: string, to: AssignmentStatus, reason?: string): Assignment;
    /**
     * Reassign a task to another qualified agent after a failure.
     *
     * The failed agent is excluded from the replacement selection, and — when
     * the failure is a self-review of the task's own change set — the implementer
     * is excluded from the REVIEWER selection. If nobody qualifies, the task
     * ends `NO_QUALIFIED_AGENT` rather than going back to the same agent.
     */
    reassign(assignmentId: string, requirements: TaskRequirements, reason: string, options?: Omit<AssignOptions, "taskId"> & {
        taskId?: string;
    }): AssignmentOutcome;
    /**
     * Pick a reviewer for a change set produced by `implementerAgentId`.
     *
     * The implementer is excluded structurally, not by convention, and the
     * reviewer must actually declare the review capability. If no independent
     * qualified reviewer exists, the answer is `NO_QUALIFIED_AGENT` — the change
     * set does not get to be approved by its author.
     */
    selectReviewer(input: {
        projectId: string;
        changeSetId: string;
        implementerAgentId: string;
        reviewCapabilities?: readonly string[];
        riskLevel: TaskRequirements["riskLevel"];
        now: string;
    }): AssignmentOutcome;
    require(assignmentId: string): Assignment;
    historyForTask(taskId: string): readonly Assignment[];
    currentForTask(taskId: string): Assignment | undefined;
    releaseForTask(taskId: string): readonly WriteScopeLease[];
    /** Enforced at the execution boundary. */
    mayWrite(workspaceId: string, agentId: string, path: string): boolean;
    private record;
}
export { NO_QUALIFIED_AGENT };
