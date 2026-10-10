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
import {
  NotFoundError,
  StateTransitionError,
  type AgentDescriptor,
  type AgentCandidateEvidence,
  type Assignment,
  type AssignmentStatus,
  type TaskRequirements,
  canTransitionAssignment,
  validateAssignment,
} from "../../contracts/index.js";
import { createId, now as systemNow } from "../shared.js";
import {
  AgentQualificationRouter,
  NO_QUALIFIED_AGENT,
} from "../environments/agent-qualification-router.js";
import { EnvironmentRegistry } from "../environments/environment-registry.js";
import {
  WriteScopeLeaseManager,
  type LeaseRepository,
} from "./lease-manager.js";
import { InMemoryAuditSink, AuditLog } from "../audit/audit-log.js";
import type { AuditEventType, WriteScopeLease } from "../../contracts/index.js";

/* ------------------------------------------------------------------ */
/* In-memory repositories                                             */
/* ------------------------------------------------------------------ */

export class InMemoryAssignmentRepository {
  private readonly items = new Map<string, Assignment>();

  list(): Assignment[] {
    return [...this.items.values()];
  }
  findById(id: string): Assignment | undefined {
    return this.items.get(id);
  }
  upsert(item: Assignment): void {
    this.items.set(item.assignmentId, item);
  }
  /** The most recent assignment for a task — the one currently in force. */
  currentForTask(taskId: string): Assignment | undefined {
    return this.list()
      .filter((a) => a.taskId === taskId && a.status !== "reassigned")
      .sort(
        (a, b) =>
          b.assignedAt.localeCompare(a.assignedAt) ||
          a.assignmentId.localeCompare(b.assignmentId),
      )[0];
  }
  historyForTask(taskId: string): Assignment[] {
    return this.list()
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }
}

export class InMemoryLeaseRepository implements LeaseRepository<WriteScopeLease> {
  private readonly items = new Map<string, WriteScopeLease>();
  list(): WriteScopeLease[] {
    return [...this.items.values()];
  }
  findById(id: string): WriteScopeLease | undefined {
    return this.items.get(id);
  }
  upsert(item: WriteScopeLease): void {
    this.items.set(item.leaseId, item);
  }
}

export type AssignmentOutcome =
  | { readonly status: "assigned"; readonly assignment: Assignment }
  | {
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

export class SpecialistAssignmentService {
  private readonly qualification: AgentQualificationRouter;
  readonly leases: WriteScopeLeaseManager;
  private readonly audit: AuditLog;

  constructor(
    private readonly assignments: InMemoryAssignmentRepository,
    private readonly descriptors: () => readonly AgentDescriptor[],
    leaseRepository: LeaseRepository<WriteScopeLease> = new InMemoryLeaseRepository(),
    private readonly clock: () => string = () => systemNow(),
    audit: AuditLog = new AuditLog(new InMemoryAuditSink()),
    environmentRegistry: EnvironmentRegistry = new EnvironmentRegistry(),
  ) {
    this.qualification = new AgentQualificationRouter(environmentRegistry);
    this.leases = new WriteScopeLeaseManager(leaseRepository);
    this.audit = audit;
  }

  /**
   * The one qualification router, exposed so planning reads the SAME rules
   * that assignment enforces. A second copy of the qualification logic is how
   * a plan starts disagreeing with what actually happened.
   */
  qualify(
    requirements: TaskRequirements,
    descriptors: readonly AgentDescriptor[],
    context: {
      isEnabled?: (agentId: string, projectId: string) => boolean;
    } = {},
  ) {
    return this.qualification.qualify(requirements, descriptors, context);
  }

  /* ---------------------------------------------------------------- */
  /* Assignment                                                        */
  /* ---------------------------------------------------------------- */

  assign(
    requirements: TaskRequirements,
    options: AssignOptions,
  ): AssignmentOutcome {
    const at = options.now ?? this.clock();
    const selected = this.qualification.selectAssignment(
      requirements,
      this.descriptors(),
      {
        assignmentId: createId("assign"),
        taskId: options.taskId,
        assignedBy: options.assignedBy,
        correlationId: options.correlationId,
        excludeAgentIds: options.excludeAgentIds,
        now: at,
        isEnabled: options.isEnabled,
      },
    );

    if ("blocked" in selected) {
      // A blocked task is a first-class, auditable outcome — not an error to be
      // swallowed and not a licence to pick someone else.
      this.record("assignment_blocked", {
        projectId: requirements.projectId,
        taskId: options.taskId,
        data: {
          reason: NO_QUALIFIED_AGENT,
          considered: selected.evidence.map((e) => ({
            agentId: e.agentId,
            reasonCodes: e.reasonCodes,
          })),
        },
      });
      return {
        status: "blocked",
        reason: NO_QUALIFIED_AGENT,
        evidence: selected.evidence,
      };
    }

    const assignment = selected.assignment;

    if (options.workspaceId && options.writeScope?.length) {
      this.acquireWriteScope(assignment, options, at);
    }

    this.assignments.upsert(assignment);
    this.record("assignment_created", {
      projectId: assignment.projectId,
      taskId: assignment.taskId,
      agentId: assignment.agentId,
      data: {
        assignmentId: assignment.assignmentId,
        descriptorVersion: assignment.descriptorVersion,
        matchedCapabilities: assignment.qualification.matchedCapabilities,
        limitations: assignment.qualification.consideredLimitations,
      },
    });
    return { status: "assigned", assignment };
  }

  private acquireWriteScope(
    assignment: Assignment,
    options: AssignOptions,
    at: string,
  ): void {
    const lease = this.leases.acquire({
      projectId: assignment.projectId,
      taskId: assignment.taskId,
      agentId: assignment.agentId,
      workspaceId: options.workspaceId!,
      scope: options.writeScope!,
      ttlMs: options.leaseTtlMs,
      leaseId: createId("lease"),
    });
    this.assignments.upsert({
      ...assignment,
      leaseId: lease.leaseId,
      updatedAt: at,
    });
    this.record("write_lease_acquired", {
      projectId: assignment.projectId,
      taskId: assignment.taskId,
      agentId: assignment.agentId,
      data: {
        leaseId: lease.leaseId,
        scope: lease.scope,
        workspaceId: lease.workspaceId,
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle transitions                                             */
  /* ---------------------------------------------------------------- */

  transition(
    assignmentId: string,
    to: AssignmentStatus,
    reason?: string,
  ): Assignment {
    const current = this.require(assignmentId);
    if (!canTransitionAssignment(current.status, to)) {
      throw new StateTransitionError(
        `assignment ${assignmentId} cannot move from ${current.status} to ${to}`,
      );
    }
    const updated: Assignment = {
      ...current,
      status: to,
      updatedAt: this.clock(),
      ...(reason !== undefined ? { failureReason: reason } : {}),
    };
    validateAssignment(updated);
    this.assignments.upsert(updated);

    // A finished or abandoned task must not keep holding the workspace.
    if (
      to === "completed" ||
      to === "failed" ||
      to === "cancelled" ||
      to === "reassigned"
    ) {
      this.releaseForTask(current.taskId);
    }
    this.record("assignment_transitioned", {
      projectId: current.projectId,
      taskId: current.taskId,
      agentId: current.agentId,
      data: { assignmentId, from: current.status, to, reason },
    });
    return updated;
  }

  /* ---------------------------------------------------------------- */
  /* Reassignment (§32, §50)                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Reassign a task to another qualified agent after a failure.
   *
   * The failed agent is excluded from the replacement selection, and — when
   * the failure is a self-review of the task's own change set — the implementer
   * is excluded from the REVIEWER selection. If nobody qualifies, the task
   * ends `NO_QUALIFIED_AGENT` rather than going back to the same agent.
   */
  reassign(
    assignmentId: string,
    requirements: TaskRequirements,
    reason: string,
    options: Omit<AssignOptions, "taskId"> & { taskId?: string } = {
      assignedBy: "system:reassign",
    },
  ): AssignmentOutcome {
    const failed = this.require(assignmentId);
    if (failed.status === "reassigned" || failed.status === "cancelled") {
      throw new StateTransitionError(
        `assignment ${assignmentId} is terminal (${failed.status}) and cannot be reassigned`,
      );
    }
    const at = options.now ?? this.clock();
    const taskId = options.taskId ?? failed.taskId;

    // Mark history terminal BEFORE selecting, so a selector that consults
    // current-for-task sees the honest state.
    const superseded: Assignment = {
      ...failed,
      status: "reassigned",
      failureReason: reason,
      updatedAt: at,
    };
    this.assignments.upsert(superseded);
    this.releaseForTask(taskId);
    this.record("assignment_reassigned", {
      projectId: failed.projectId,
      taskId,
      agentId: failed.agentId,
      data: { from: assignmentId, reason },
    });

    const outcome = this.assign(requirements, {
      ...options,
      taskId,
      now: at,
      // Never send the work straight back to the agent that just failed it.
      excludeAgentIds: [failed.agentId],
    });

    if (outcome.status === "assigned") {
      // Return the SUPERSEDING assignment, not the one that was just created,
      // so the caller sees the chain link it actually persisted.
      const replacement: Assignment = {
        ...outcome.assignment,
        replacesAssignmentId: failed.assignmentId,
        correlationId: options.correlationId ?? failed.correlationId,
        updatedAt: at,
      };
      this.assignments.upsert(replacement);
      return { status: "assigned", assignment: replacement };
    }
    return outcome;
  }

  /* ---------------------------------------------------------------- */
  /* Review independence (§50)                                         */
  /* ---------------------------------------------------------------- */

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
  }): AssignmentOutcome {
    const requirements: TaskRequirements = {
      projectId: input.projectId,
      taskType: "review",
      requiredCapabilities: input.reviewCapabilities ?? ["software.review"],
      riskLevel: input.riskLevel,
      requiresIndependentReview: true,
      implementerAgentId: input.implementerAgentId,
      excludeAgentIds: [input.implementerAgentId],
    };
    return this.assign(requirements, {
      taskId: input.changeSetId,
      assignedBy: "system:reviewer-selection",
      now: input.now,
    });
  }

  /* ---------------------------------------------------------------- */

  require(assignmentId: string): Assignment {
    const found = this.assignments.findById(assignmentId);
    if (!found) throw new NotFoundError(`unknown assignment: ${assignmentId}`);
    return found;
  }

  historyForTask(taskId: string): readonly Assignment[] {
    return this.assignments.historyForTask(taskId);
  }

  currentForTask(taskId: string): Assignment | undefined {
    return this.assignments.currentForTask(taskId);
  }

  releaseForTask(taskId: string): readonly WriteScopeLease[] {
    const released = this.leases.releaseForTask(taskId);
    for (const lease of released) {
      this.record("write_lease_released", {
        projectId: lease.projectId,
        taskId: lease.taskId,
        agentId: lease.agentId,
        data: { leaseId: lease.leaseId, reason: "task_no_longer_writing" },
      });
    }
    return released;
  }

  /** Enforced at the execution boundary. */
  mayWrite(workspaceId: string, agentId: string, path: string): boolean {
    return this.leases.hasValidLease(workspaceId, agentId, path);
  }

  private record(
    type: AuditEventType,
    fields: {
      projectId?: string;
      taskId?: string;
      agentId?: string;
      data: Record<string, unknown>;
    },
  ): void {
    this.audit.record(type, fields);
  }
}

export { NO_QUALIFIED_AGENT };
