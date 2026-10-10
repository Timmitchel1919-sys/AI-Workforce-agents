import { type OperatorPrincipal } from "../../contracts/index.js";
import type { OnboardingCapabilitiesView, OnboardingSession, OnboardingSessionStore, OnboardingSessionSummary, ProvisionedProjectStore } from "../../contracts/onboarding.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import { type PlanningContext } from "./planner.js";
import { ProjectProvisioningService } from "./provisioning-service.js";
import { type RepositorySourceReader } from "./repository-source.js";
export interface OnboardingPlatform {
    descriptors: PlanningContext["descriptors"];
    usableDescriptorIds: PlanningContext["usableDescriptorIds"];
    agents: PlanningContext["agents"];
}
export interface OnboardingServiceDeps {
    sessions: OnboardingSessionStore;
    projects: ProvisionedProjectStore;
    registry: ProjectRegistry;
    audit: AuditLog;
    reader: RepositorySourceReader;
    provisioning: ProjectProvisioningService;
    /** Live platform state (environments, agents) — never a snapshot literal. */
    platform: () => OnboardingPlatform;
    clock?: () => string;
    newId?: () => string;
}
export interface OnboardingOutcome {
    session: OnboardingSession;
    /** True when the request repeated work that was already done. */
    idempotent?: boolean;
    note?: string;
}
export interface OnboardingCreateInput {
    mode?: unknown;
    kind?: unknown;
    identity?: unknown;
    source?: unknown;
}
export interface OnboardingPatchInput {
    identity?: unknown;
    source?: unknown;
    overrides?: unknown;
    autonomyLevel?: unknown;
    gitPolicy?: unknown;
    costPolicy?: unknown;
}
export declare class OnboardingService {
    private readonly deps;
    private readonly clock;
    private readonly newId;
    constructor(deps: OnboardingServiceDeps);
    capabilities(principal: OperatorPrincipal): OnboardingCapabilitiesView;
    list(principal: OperatorPrincipal): Promise<OnboardingSessionSummary[]>;
    get(principal: OperatorPrincipal, id: string): Promise<OnboardingSession>;
    create(principal: OperatorPrincipal, input: OnboardingCreateInput): Promise<OnboardingOutcome>;
    update(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
        patch?: unknown;
    }): Promise<OnboardingOutcome>;
    analyze(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
    }): Promise<OnboardingOutcome>;
    plan(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
    }): Promise<OnboardingOutcome>;
    approvePlan(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
        planVersion?: unknown;
        planHash?: unknown;
    }): Promise<OnboardingOutcome>;
    provision(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
        planHash?: unknown;
    }): Promise<OnboardingOutcome>;
    revalidate(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
    }): Promise<OnboardingOutcome>;
    cancel(principal: OperatorPrincipal, input: {
        id?: unknown;
        expectedRevision?: unknown;
        reason?: unknown;
    }): Promise<OnboardingOutcome>;
    private applyPatch;
    private sourceComplete;
    private requireIdentity;
    /**
     * Duplicate protection: project id (immutable, server-made), code and
     * repository binding must be unique across projects and — at plan/approval
     * time — across other live onboarding sessions.
     */
    private checkDuplicates;
    private load;
    private loadForWrite;
    private persist;
    private canCreate;
    private requireCreator;
    private summary;
    private audit;
}
