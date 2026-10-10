/**
 * ProjectWorkforcePlanner — answers, truthfully, "can this project be staffed
 * with the specialists that actually exist?"
 *
 * The question is easy to answer dishonestly: take the agent count, divide the
 * tasks, and report a fully-staffed plan. This planner refuses to do that:
 *
 *   ASSIGNED              a qualified agent is bound to the task.
 *   NO_QUALIFIED_AGENT    no registered specialist covers the requirements. The
 *                         task is BLOCKED and stays in the plan as blocked.
 *   AWAITING_CAPACITY     agents qualify, but every one of them is already
 *                         bound to a concurrent task in the same wave. The
 *                         task waits; no agent is ever double-booked.
 *
 * The aggregate is DERIVED from those per-task verdicts, never asserted in
 * advance. A project whose specialists are all scoped to a different project
 * comes out `UNSTAFFABLE` with the reason attached, which is the correct answer
 * and the reason this module exists.
 *
 * All matching is delegated to the one qualification router. A second copy of
 * the capability hierarchy here would be how the plan starts disagreeing with
 * the assignment that actually happened.
 */
import { SpecialistAssignmentService } from "./assignment-system.js";
import { type AgentCandidateEvidence, type AgentDescriptor, type Assignment, type TaskRequirements } from "../../contracts/index.js";
export type TaskStaffingStatus = "assigned" | "awaiting_capacity" | "no_qualified_agent";
export interface ProjectTaskPlan {
    readonly taskId: string;
    readonly requirements: TaskRequirements;
    readonly status: TaskStaffingStatus;
    readonly assignment?: Assignment;
    readonly evidence: readonly AgentCandidateEvidence[];
    readonly reason?: string;
}
export type ProjectStaffingStatus = "fully_staffed" | "partially_staffed" | "unstaffable";
export interface ProjectWorkforcePlan {
    readonly projectId: string;
    readonly status: ProjectStaffingStatus;
    readonly tasks: readonly ProjectTaskPlan[];
    /** Distinct specialists the plan actually uses. */
    readonly usedAgentIds: readonly string[];
    /** Agents whose project policy includes this project, before task matching. */
    readonly eligibleAgentIds: readonly string[];
    readonly blockedTaskIds: readonly string[];
    readonly summary: string;
}
export interface PlanInput {
    readonly projectId: string;
    readonly tasks: readonly {
        taskId: string;
        requirements: TaskRequirements;
    }[];
    readonly assignedBy?: string;
    /**
     * Tasks in the SAME group contend for the same agent; tasks in different
     * groups may run concurrently. Defaults to one group, i.e. serial.
     */
    readonly concurrencyGroupOf?: (taskId: string) => string;
    /**
     * Report staffing without creating assignments. Nothing is written, so a
     * dry run cannot leave a half-staffed project behind.
     */
    readonly dryRun?: boolean;
    readonly isEnabled?: (agentId: string, projectId: string) => boolean;
}
export declare class ProjectWorkforcePlanner {
    private readonly assignments;
    private readonly descriptors;
    constructor(assignments: SpecialistAssignmentService, descriptors: () => readonly AgentDescriptor[]);
    plan(input: PlanInput): ProjectWorkforcePlan;
    private blocked;
    private evidenceFor;
}
