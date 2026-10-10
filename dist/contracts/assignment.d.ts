import type { ExecutionCapability } from "./execution.js";
import type { AgentRiskLevel } from "./workforce.js";
/**
 * The structured requirements a task exposes so that qualification never has to
 * guess from a task TITLE. Every field is machine-readable; a task with none of
 * them cannot be qualified for anything and is reported as such.
 */
export interface TaskRequirements {
    readonly projectId: string;
    readonly taskType: string;
    /** An agent must cover ALL of these (least-privilege hierarchy applies). */
    readonly requiredCapabilities: readonly string[];
    /** Bonus coverage only. Never a reason to reject a candidate. */
    readonly preferredCapabilities?: readonly string[];
    /** An agent whose qualification profile lists none of these is rejected. */
    readonly technologyRequirements?: readonly string[];
    /** Environment types/codes the task must run in. */
    readonly environmentRequirements?: readonly string[];
    /** Execution capabilities the task needs. Ceiling-checked against toolPolicy. */
    readonly toolRequirements?: readonly ExecutionCapability[];
    readonly riskLevel: AgentRiskLevel;
    readonly requiresIndependentReview?: boolean;
    /** Capabilities the REVIEWER must have. Defaults to `software.review`. */
    readonly reviewCapabilities?: readonly string[];
    /** File scope this task will write. Used for write-scope conflict control. */
    readonly writeScope?: readonly string[];
    /**
     * Agents excluded by id from this task — used for review independence (the
     * implementer is excluded from reviewing its own change set). Server-side
     * only; a client cannot use this to exclude a reviewer from the whole system.
     */
    readonly excludeAgentIds?: readonly string[];
    /** The agent that produced the artefact under review, if any. */
    readonly implementerAgentId?: string;
}
/** Fail-safe structural validation. A forged requirements object never qualifies. */
export declare function validateTaskRequirements(requirements: TaskRequirements): void;
/**
 * Does a task REQUIRE independent review?
 *
 * A review requirement is asserted two ways and both hold: the task says so
 * explicitly, OR the task's risk reaches the threshold the assigned agent
 * declared. Review is never optional because an implementer finds it
 * inconvenient.
 */
export declare function requiresIndependentReview(requirements: TaskRequirements): boolean;
export declare const ASSIGNMENT_STATUSES: readonly ["pending", "assigned", "accepted", "executing", "completed", "failed", "cancelled", "reassigned"];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export declare function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean;
/** The verbatim evidence that made one agent eligible for one task. */
export interface QualificationEvidence {
    readonly agentId: string;
    readonly descriptorVersion: number;
    readonly qualified: boolean;
    readonly matchedCapabilities: readonly string[];
    readonly missingCapabilities: readonly string[];
    readonly reasonCodes: readonly string[];
    /** What the agent stated it could NOT do, for the audit trail. */
    readonly consideredLimitations: readonly string[];
    readonly evaluatedAt: string;
}
export interface Assignment {
    readonly assignmentId: string;
    readonly projectId: string;
    readonly taskId: string;
    /** Stable agent id — never a display name, never a role. */
    readonly agentId: string;
    /** Pins the exact definition that was qualified, so later revisions cannot rewrite history. */
    readonly descriptorVersion: number;
    readonly qualification: QualificationEvidence;
    readonly status: AssignmentStatus;
    readonly assignedAt: string;
    readonly assignedBy: string;
    readonly correlationId?: string;
    /** The assignment this one replaces, when this is a reassignment. */
    readonly replacesAssignmentId?: string;
    readonly failureReason?: string;
    readonly updatedAt: string;
    readonly writeScope?: readonly string[];
    readonly leaseId?: string;
    readonly metadata?: Record<string, unknown>;
}
export declare function validateAssignment(assignment: Assignment): void;
