/**
 * OnboardingControlService — the governed command/query surface for project
 * onboarding (PROJECT-2). Every command is authorized by the domain service,
 * audited as a `control_command` (denied and rejected included) and returned
 * as a structured `ControlCommandResult`. The UI never mutates state itself.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import type { OnboardingCapabilitiesView, OnboardingSession, OnboardingSessionSummary } from "../../contracts/onboarding.js";
import { type OnboardingService } from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
type Body = Record<string, unknown>;
export declare class OnboardingControlService {
    private readonly service;
    private readonly audit;
    constructor(service: OnboardingService, audit: AuditLog);
    capabilities(principal: OperatorPrincipal): OnboardingCapabilitiesView;
    list(principal: OperatorPrincipal): Promise<OnboardingSessionSummary[]>;
    get(principal: OperatorPrincipal, id: string): Promise<OnboardingSession>;
    onboardingCreate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingUpdate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingAnalyze(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingPlan(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingApprovePlan(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingProvision(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingRevalidate(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    onboardingCancel(p: OperatorPrincipal, b: Body, o?: CommandOptions): Promise<ControlCommandResult>;
    private run;
    private result;
}
export {};
