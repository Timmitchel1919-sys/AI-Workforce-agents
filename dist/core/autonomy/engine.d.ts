import { type AutonomousAction, type AutonomousWorkflowDef, type AutonomyAuditEvent, type AutonomyGlobal, type OpsAutonomyLevel, type AutonomySetting, type ExecutionErrorKind, type InstanceState, type OperationsCenterView, type TriggerRule, type TriggerSource, type WorkflowInstance } from "../../contracts/autonomy.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
export declare class AutonomyError extends Error {
    readonly code: "invalid_request" | "not_found" | "invalid_state" | "forbidden" | "conflict";
    constructor(code: "invalid_request" | "not_found" | "invalid_state" | "forbidden" | "conflict", message: string);
}
export interface ActionContext {
    instanceId: string;
    projectId: string;
    stepId: string;
    params: Record<string, string | number | boolean>;
    attempt: number;
    approvedBy?: string;
}
export interface ActionResult {
    ok: boolean;
    output?: string;
    error?: {
        kind: ExecutionErrorKind;
        message: string;
    };
}
export interface ActionExecutor {
    available(actionId: string): {
        ok: boolean;
        reason: string;
    };
    execute(actionId: string, ctx: ActionContext): Promise<ActionResult>;
}
export interface AutonomyPorts {
    executor: ActionExecutor;
    requestApproval(d: {
        action: string;
        requestedBy: string;
        reason: string;
        metadata: Record<string, unknown>;
    }): string;
    approvalState(approvalId: string): "pending" | "approved" | "rejected" | "expired" | "unknown";
    decideApproval?(approvalId: string, decision: "approve" | "deny", by: string): void;
    emergencyStopped(): boolean;
    raiseAlert?(a: {
        severity: "MEDIUM" | "HIGH";
        projectId: string;
        event: string;
        description: string;
        dedupeKey: string;
    }): void;
    projectExists(projectId: string): boolean;
    environmentOf?(projectId: string): string | undefined;
    /** The level the owner chose when onboarding the project (1–5); used until an explicit level is set here. */
    onboardingLevel?(projectId: string): number | undefined;
    orchestration(): {
        active: number;
        queued: number;
        failed: number;
        waitingApproval: number;
    };
    ledger: GovernanceLedger;
    clock: () => string;
    now: () => number;
}
export interface AutonomyRepos {
    settings: Repository<AutonomySetting>;
    global: Repository<AutonomyGlobal>;
    definitions: Repository<AutonomousWorkflowDef>;
    rules: Repository<TriggerRule>;
    instances: Repository<WorkflowInstance>;
    audit: Repository<AutonomyAuditEvent>;
}
export declare class AutonomyEngine {
    private readonly ports;
    private readonly settings;
    private readonly globalRepo;
    private readonly definitions;
    private readonly rules;
    private readonly instances;
    private readonly auditRepo;
    private readonly running;
    private seq;
    constructor(repos: AutonomyRepos, ports: AutonomyPorts);
    private audit;
    auditTrail(filter?: {
        instanceId?: string;
        projectId?: string;
        limit?: number;
    }): AutonomyAuditEvent[];
    levelOf(projectId: string): OpsAutonomyLevel;
    private defaultLevel;
    settingOf(projectId: string): AutonomySetting;
    /** Only a human principal may change a level; callers must never pass an agent/workflow identity. */
    setLevel(projectId: string, level: unknown, by: string, opts?: {
        confirmHighest?: boolean;
        note?: string;
    }): AutonomySetting;
    listSettings(): AutonomySetting[];
    globalState(): AutonomyGlobal;
    pauseAll(by: string, reason: string): AutonomyGlobal;
    resumeAll(by: string): AutonomyGlobal;
    listDefinitions(): AutonomousWorkflowDef[];
    definition(definitionId: string): AutonomousWorkflowDef;
    actions(): AutonomousAction[];
    createDefinition(input: Record<string, unknown>, by: string): AutonomousWorkflowDef;
    listRules(projectId?: string): TriggerRule[];
    addRule(input: Record<string, unknown>, by: string): TriggerRule;
    setRuleEnabled(ruleId: string, enabled: boolean, by: string): TriggerRule;
    /** An event arrives (webhook, schedule tick, monitoring…). Matching enabled rules create instances; duplicates are ignored. */
    ingestEvent(e: {
        source: TriggerSource;
        projectId: string;
        eventType?: string;
        summary: string;
        ref?: string;
        by?: string;
    }): Promise<WorkflowInstance[]>;
    /** CONTEXT → PLAN → RISK. Creating an instance never executes a step on its own except when policy allows an auto-start. */
    create(definitionId: string, projectId: string, trigger: WorkflowInstance["trigger"]): Promise<WorkflowInstance>;
    private buildPlan;
    get(instanceId: string): WorkflowInstance;
    list(filter?: {
        projectId?: string;
        states?: InstanceState[];
    }): WorkflowInstance[];
    private set;
    approvePlan(instanceId: string, by: string): WorkflowInstance;
    start(instanceId: string, by: string): Promise<WorkflowInstance>;
    cancel(instanceId: string, by: string): WorkflowInstance;
    decideStep(instanceId: string, stepId: string, decision: "APPROVE" | "REJECT" | "EDIT" | "CANCEL", by: string, edit?: Record<string, unknown>): Promise<WorkflowInstance>;
    /** Advance every runnable workflow: due retries, approvals decided elsewhere, paused ones that may resume. */
    tick(): Promise<{
        advanced: number;
    }>;
    /** The owner may decide in the central approvals queue instead of the Operations Center. */
    private reconcileApprovals;
    advance(instanceId: string, by: string): Promise<WorkflowInstance>;
    private gateFor;
    private runStep;
    /** Stop unsafe continuation, capture the error, keep state, retry only when policy and idempotency allow, else escalate. */
    private fail;
    /** OBSERVATION → VALIDATION → REPORT. */
    private finish;
    /**
     * Reverse completed steps, newest first, ONLY where the catalogue defines a reversal and the
     * executor can perform it. Anything else is reported as not rollbackable; nothing is promised.
     */
    rollback(instanceId: string, by: string): Promise<{
        instance: WorkflowInstance;
        results: {
            stepId: string;
            outcome: "ROLLED_BACK" | "NOT_SUPPORTED" | "FAILED";
            detail: string;
        }[];
    }>;
    operations(accessible: (projectId: string) => boolean): OperationsCenterView;
}
