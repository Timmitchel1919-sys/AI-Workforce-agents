import type { Agent, EnvironmentDescriptor } from "../../contracts/index.js";
import type { CostPolicy, GitPolicy, OnboardingSession, ProjectAnalysis, ProjectPolicyCapability, ProvisioningPlan } from "../../contracts/onboarding.js";
export interface PlanningContext {
    now: string;
    descriptors: readonly EnvironmentDescriptor[];
    /** Descriptor ids that have at least one USABLE registered instance. */
    usableDescriptorIds: ReadonlySet<string>;
    agents: readonly Agent[];
    /** Whether a read credential for private GitHub repositories is configured. */
    githubPrivateAccess: boolean;
    /** Platform gaps (honest capability reporting). */
    githubRepositoryCreation: false;
    firebaseProvisioning: false;
}
/**
 * What the platform can actually GRANT today. The execution layer is a
 * deny-all baseline (EO-4.1), so only reading is operational; the rest are
 * recorded as requested and take effect only when an execution layer and
 * project policy grant them. A level is never a security bypass.
 */
export declare const PLATFORM_GRANTABLE: readonly ProjectPolicyCapability[];
export declare const ALWAYS_APPROVAL_GATED: readonly string[];
export declare const DEFAULT_GIT_POLICY: GitPolicy;
export declare const DEFAULT_COST_POLICY: CostPolicy;
export declare const VISIBILITY_SLA_MINUTES = 5;
/** Stable JSON: object keys sorted, so a hash is content-only. */
export declare function canonicalJson(value: unknown): string;
export declare function hashPlanContent(plan: Omit<ProvisioningPlan, "planHash" | "planVersion" | "generatedAt">): string;
export declare function buildPlan(session: OnboardingSession, analysis: ProjectAnalysis, planVersion: number, context: PlanningContext): ProvisioningPlan;
