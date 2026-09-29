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
import {
  ValidationError,
  type AgentCandidateEvidence,
  type AgentDescriptor,
  type Assignment,
  type TaskRequirements,
} from "../../contracts/index.js";

export type TaskStaffingStatus =
  | "assigned"
  | "awaiting_capacity"
  | "no_qualified_agent";

export interface ProjectTaskPlan {
  readonly taskId: string;
  readonly requirements: TaskRequirements;
  readonly status: TaskStaffingStatus;
  readonly assignment?: Assignment;
  readonly evidence: readonly AgentCandidateEvidence[];
  readonly reason?: string;
}

export type ProjectStaffingStatus =
  | "fully_staffed"
  | "partially_staffed"
  | "unstaffable";

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
  readonly tasks: readonly { taskId: string; requirements: TaskRequirements }[];
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

export class ProjectWorkforcePlanner {
  constructor(
    private readonly assignments: SpecialistAssignmentService,
    private readonly descriptors: () => readonly AgentDescriptor[],
  ) {}

  plan(input: PlanInput): ProjectWorkforcePlan {
    const groupOf = input.concurrencyGroupOf ?? (() => "default");
    const pool = this.descriptors();
    // `${group}:${agentId}` -> the task that agent is currently bound to.
    const booked = new Map<string, string>();
    const used = new Set<string>();
    const plans: ProjectTaskPlan[] = [];

    for (const { taskId, requirements } of input.tasks) {
      // A task is never quietly RE-PLANNED into another project. A requirement
      // that names a different project is a caller error, and silently
      // rewriting it would staff work in a project the task was never filed
      // under.
      if (requirements.projectId !== input.projectId) {
        throw new ValidationError(
          `task ${taskId} requires project ${requirements.projectId} but was planned for ${input.projectId}`,
        );
      }
      const effective = requirements;

      const group = groupOf(taskId);
      const busyAgents = [...booked.keys()]
        .filter((key) => key.startsWith(`${group}:`))
        .map((key) => key.slice(group.length + 1));
      const free = pool.filter((d) => !busyAgents.includes(d.id));

      if (input.dryRun) {
        const preview = this.assignments.qualify(effective, free, {
          isEnabled: input.isEnabled,
        });
        if (preview.candidates.length > 0) {
          const chosen = preview.candidates[0]!;
          booked.set(`${group}:${chosen.id}`, taskId);
          used.add(chosen.id);
          plans.push({
            taskId,
            requirements: effective,
            status: "assigned",
            evidence: preview.evidence,
          });
        } else {
          plans.push(
            this.blocked(taskId, effective, preview.evidence, pool, input.projectId),
          );
        }
        continue;
      }

      const outcome = this.assignments.assign(effective, {
        taskId,
        assignedBy: input.assignedBy ?? "planner:project-workforce",
        isEnabled: input.isEnabled,
        // Agents already bound in this concurrency group are excluded, so the
        // planner can never double-book one specialist onto two live tasks.
        excludeAgentIds: busyAgents,
      });

      if (outcome.status === "assigned") {
        booked.set(`${group}:${outcome.assignment.agentId}`, taskId);
        used.add(outcome.assignment.agentId);
        plans.push({
          taskId,
          requirements: effective,
          status: "assigned",
          assignment: outcome.assignment,
          evidence: [this.evidenceFor(effective, outcome.assignment.agentId, pool)],
        });
        continue;
      }

      plans.push(
        this.blocked(taskId, effective, outcome.evidence, pool, input.projectId),
      );
    }

    return summarise(input.projectId, plans, pool, used);
  }

  private blocked(
    taskId: string,
    requirements: TaskRequirements,
    evidence: readonly AgentCandidateEvidence[],
    pool: readonly AgentDescriptor[],
    projectId: string,
  ): ProjectTaskPlan {
    // Distinguish "nobody covers this" from "everyone qualified is busy": the
    // two need different responses — a new specialist versus more time.
    const stillQualifiedSomewhere = this.assignments
      .qualify(requirements, pool)
      .candidates.length > 0;
    return {
      taskId,
      requirements,
      status: stillQualifiedSomewhere ? "awaiting_capacity" : "no_qualified_agent",
      evidence,
      reason: stillQualifiedSomewhere
        ? "every qualified specialist is already bound to a concurrent task in this wave"
        : `no registered specialist covers [${requirements.requiredCapabilities.join(", ")}] for project ${projectId}`,
    };
  }

  private evidenceFor(
    requirements: TaskRequirements,
    agentId: string,
    pool: readonly AgentDescriptor[],
  ): AgentCandidateEvidence {
    const outcome = this.assignments.qualify(requirements, pool);
    return (
      outcome.evidence.find((e) => e.agentId === agentId) ?? {
        agentId,
        qualifies: true,
        matchedCapabilities: [...requirements.requiredCapabilities],
        missingCapabilities: [],
        reasonCodes: [],
      }
    );
  }
}

function summarise(
  projectId: string,
  tasks: readonly ProjectTaskPlan[],
  pool: readonly AgentDescriptor[],
  used: ReadonlySet<string>,
): ProjectWorkforcePlan {
  const eligible = pool.filter((d) => d.projectPolicy.projects.includes(projectId));
  const blocked = tasks.filter((t) => t.status !== "assigned");
  const status: ProjectStaffingStatus =
    blocked.length === 0
      ? "fully_staffed"
      : used.size === 0
        ? "unstaffable"
        : "partially_staffed";

  const summary =
    status === "fully_staffed"
      ? `${tasks.length} of ${tasks.length} task(s) staffed by ${used.size} specialist(s) in project ${projectId}.`
      : status === "unstaffable"
        ? `No task in project ${projectId} can be staffed: ${eligible.length} specialist(s) are registered for this project and none qualifies for the stated requirements.`
        : `${tasks.length - blocked.length} of ${tasks.length} task(s) staffed; ${blocked.length} blocked.`;

  return Object.freeze({
    projectId,
    status,
    tasks: Object.freeze(tasks),
    usedAgentIds: Object.freeze([...used].sort()),
    eligibleAgentIds: Object.freeze(eligible.map((d) => d.id).sort()),
    blockedTaskIds: Object.freeze(blocked.map((t) => t.taskId)),
    summary,
  });
}
