/**
 * Layer 12 — Autonomous Workflow & Operations: contracts.
 *
 * Governed autonomy for a single owner. Autonomy NEVER widens what is allowed: HIGH and CRITICAL
 * actions, and every restricted action (merging production code, deleting data, changing secrets,
 * destroying infrastructure, external communication, destructive device actions), require the
 * owner's explicit approval at EVERY level. The level only decides how much LOW/MEDIUM work may
 * proceed without asking.
 */
import type { Entity } from "./persistence.js";
import type { GovRisk } from "./security-governance.js";
export declare const OPS_AUTONOMY_LEVELS: readonly [0, 1, 2, 3, 4, 5];
export type OpsAutonomyLevel = (typeof OPS_AUTONOMY_LEVELS)[number];
export declare const AUTONOMY_LEVEL_INFO: Record<OpsAutonomyLevel, {
    name: string;
    description: string;
}>;
/** What the action does to the world. */
export declare const ACTION_KINDS: readonly ["READ", "ANALYZE", "REPORT", "TEST", "BRANCH", "PULL_REQUEST", "COMMIT", "PUSH", "MERGE", "DEPLOY", "DELETE", "SECRETS", "EXTERNAL_COMMUNICATION", "DEVICE", "INFRASTRUCTURE", "ORCHESTRATE"];
export type ActionKind = (typeof ACTION_KINDS)[number];
export interface AutonomousAction {
    actionId: string;
    label: string;
    kind: ActionKind;
    risk: GovRisk;
    /** Restricted actions are never automatic at any level. */
    restricted: boolean;
    /** Safe to repeat if it failed halfway. */
    idempotent: boolean;
    /** The action that undoes this one, when one exists. Absent = it cannot be rolled back. */
    rollbackAction?: string;
    impact: string;
}
export interface AutonomyRetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    /** Only these failure kinds are retried; anything else escalates. */
    retryOn: ExecutionErrorKind[];
}
export type ExecutionErrorKind = "TRANSIENT" | "PERMANENT" | "POLICY" | "UNAVAILABLE";
export declare const TRIGGER_SOURCES: readonly ["github", "deployment", "test_failure", "security_finding", "data_change", "schedule", "integration", "user_command", "project_state", "monitoring"];
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];
export interface WorkflowStepDef {
    stepId: string;
    actionId: string;
    description: string;
    params?: Record<string, string | number | boolean>;
}
export interface AutonomousWorkflowDef extends Entity {
    definitionId: string;
    name: string;
    description: string;
    steps: WorkflowStepDef[];
    /** Actions this workflow may use; a step outside it is refused. */
    boundaries: {
        allowedActions: string[];
        maxRisk: GovRisk;
    };
    retry: AutonomyRetryPolicy;
    builtin: boolean;
    createdAt: string;
    createdBy: string;
}
export interface TriggerRule extends Entity {
    ruleId: string;
    projectId: string;
    source: TriggerSource;
    /** e.g. "pull_request.opened"; empty = any event from the source. */
    eventType?: string;
    definitionId: string;
    enabled: boolean;
    createdAt: string;
    createdBy: string;
}
export interface AutonomySetting extends Entity {
    projectId: string;
    level: OpsAutonomyLevel;
    updatedAt: string;
    updatedBy: string;
    note?: string;
}
export interface AutonomyGlobal extends Entity {
    paused: boolean;
    reason?: string;
    updatedAt: string;
    updatedBy: string;
}
export declare const STEP_STATES: readonly ["PENDING", "WAITING_APPROVAL", "APPROVED", "RUNNING", "RETRY_WAIT", "SUCCEEDED", "FAILED", "REJECTED", "SKIPPED", "BLOCKED", "ROLLED_BACK"];
export type StepState = (typeof STEP_STATES)[number];
export interface StepGate {
    proposedAction: string;
    reason: string;
    affectedResources: string[];
    expectedImpact: string;
    risk: GovRisk;
    rollback: string;
    approvalId?: string;
    requestedAt: string;
}
export interface StepRecord {
    stepId: string;
    actionId: string;
    description: string;
    params: Record<string, string | number | boolean>;
    state: StepState;
    risk: GovRisk;
    automatic: boolean | null;
    attempts: number;
    notBefore?: string;
    gate?: StepGate;
    output?: string;
    error?: {
        kind: ExecutionErrorKind;
        message: string;
        at: string;
    };
    startedAt?: string;
    finishedAt?: string;
    approvedBy?: string;
    note?: string;
}
export declare const INSTANCE_STATES: readonly ["TRIGGERED", "PLANNED", "AWAITING_PLAN_APPROVAL", "EXECUTING", "AWAITING_APPROVAL", "RECOVERING", "BLOCKED", "PAUSED", "COMPLETED", "FAILED", "ESCALATED", "REJECTED", "CANCELLED"];
export type InstanceState = (typeof INSTANCE_STATES)[number];
export interface AutonomyPlan {
    objective: string;
    context: string;
    dependencies: string[];
    requiredTools: string[];
    agentHint: string;
    modelPolicy: string;
    environment: string;
    expectedResult: string;
    risks: string[];
    rollback: string;
    maxRisk: GovRisk;
    approvalsExpected: number;
    autoSteps: number;
    generatedAt: string;
}
export interface WorkflowInstance extends Entity {
    instanceId: string;
    definitionId: string;
    name: string;
    projectId: string;
    level: OpsAutonomyLevel;
    state: InstanceState;
    stateReason: string;
    trigger: {
        source: TriggerSource;
        summary: string;
        ref?: string;
        ruleId?: string;
        by: string;
    };
    plan: AutonomyPlan;
    planApproved: boolean;
    steps: StepRecord[];
    retry: AutonomyRetryPolicy;
    boundaries: AutonomousWorkflowDef["boundaries"];
    report?: string;
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
}
export declare const AUDIT_KINDS: readonly ["TRIGGER", "PLAN", "AGENT", "MODEL", "TOOL", "ACTION", "APPROVAL", "RESULT", "FAILURE", "RECOVERY", "POLICY", "CONTROL"];
export type AutonomyAuditKind = (typeof AUDIT_KINDS)[number];
export interface AutonomyAuditEvent extends Entity {
    at: string;
    instanceId?: string;
    projectId?: string;
    kind: AutonomyAuditKind;
    actor: string;
    stepId?: string;
    risk?: GovRisk;
    detail: string;
}
export interface OperationsCenterView {
    generatedAt: string;
    global: {
        paused: boolean;
        reason?: string;
        emergencyStop: boolean;
    };
    counts: {
        active: number;
        queued: number;
        failed: number;
        waitingApproval: number;
        blocked: number;
        incidents: number;
        recoveries: number;
        completed: number;
    };
    active: WorkflowInstance[];
    queued: WorkflowInstance[];
    failed: WorkflowInstance[];
    waitingApprovals: {
        instanceId: string;
        projectId: string;
        stepId: string;
        gate: StepGate;
    }[];
    autonomousActions: {
        instanceId: string;
        projectId: string;
        stepId: string;
        actionId: string;
        at: string;
        result: StepState;
    }[];
    blockedOperations: {
        instanceId: string;
        projectId: string;
        stepId?: string;
        reason: string;
    }[];
    incidents: {
        instanceId: string;
        projectId: string;
        state: InstanceState;
        reason: string;
        at: string;
    }[];
    recoveries: {
        instanceId: string;
        projectId: string;
        kind: "RETRY" | "ROLLBACK" | "ESCALATION";
        detail: string;
        at: string;
    }[];
    /** Orchestration runs and approvals owned by the existing layers, for one combined view. */
    orchestration: {
        active: number;
        queued: number;
        failed: number;
        waitingApproval: number;
    };
}
export declare const AUTONOMY_COMMANDS: readonly ["autonomy_set_level", "autonomy_pause_all", "autonomy_resume_all", "autonomy_create_definition", "autonomy_add_rule", "autonomy_set_rule_enabled", "autonomy_trigger", "autonomy_approve_plan", "autonomy_start", "autonomy_decide_step", "autonomy_cancel", "autonomy_rollback", "autonomy_tick"];
export type AutonomyCommand = (typeof AUTONOMY_COMMANDS)[number];
