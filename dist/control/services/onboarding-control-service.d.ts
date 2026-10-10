/**
 * OnboardingControlService — the governed command/query surface for project
 * onboarding (PROJECT-2). Every command is authorized by the domain service,
 * audited as a `control_command` (denied and rejected included) and returned
 * as a structured `ControlCommandResult`. The UI never mutates state itself.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import type { OnboardingCapabilitiesView, OnboardingSession, OnboardingSessionSummary } from "../../contracts/onboarding.js";
import { type BudgetPolicyStore, type OnboardingService } from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
type Body = Record<string, unknown>;
export declare class OnboardingControlService {
    private readonly service;
    private readonly audit;
    /**
     * EO-6.3 bridge: when a plan is approved with any budget limit actually
     * set, that becomes the project's ENFORCED `BudgetPolicy` too — onboarding
     * recording a policy no longer has to mean nothing enforces it, once the
     * Cost Center is composed. Optional and best-effort: a bridging failure
     * is logged and never fails the approval itself (PROJECT READY !=
     * AUTOMATIC EXECUTION applies here too — a budget-bridge hiccup must not
     * block onboarding).
     */
    private readonly budgetPolicies?;
    constructor(service: OnboardingService, audit: AuditLog,
    /**
     * EO-6.3 bridge: when a plan is approved with any budget limit actually
     * set, that becomes the project's ENFORCED `BudgetPolicy` too — onboarding
     * recording a policy no longer has to mean nothing enforces it, once the
     * Cost Center is composed. Optional and best-effort: a bridging failure
     * is logged and never fails the approval itself (PROJECT READY !=
     * AUTOMATIC EXECUTION applies here too — a budget-bridge hiccup must not
     * block onboarding).
     */
    budgetPolicies?: Pick<BudgetPolicyStore, "set"> | undefined);
    capabilities(principal: OperatorPrincipal): OnboardingCapabilitiesView;
    list(principal: OperatorPrincipal): Promise<OnboardingSessionSummary[]>;
    get(principal: OperatorPrincipal, id: string): Promise<OnboardingSession>;
    onboardingCreate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingUpdate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingAnalyze(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingPlan(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingApprovePlan(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    /** EO-6.3: approving a plan with any budget limit set also enforces it, from today onward. */
    private bridgeBudgetPolicy;
    onboardingProvision(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingRevalidate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingCancel(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    private run;
    private result;
}
export {};
