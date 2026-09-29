/**
 * ModelCapabilityRegistry — DECLARED model capability profiles.
 *
 * The repository has no model router; agents carry a provider-neutral
 * `modelPolicy` ({provider, model?}). Planning decides model ELIGIBILITY by
 * matching that policy against profiles an operator declared in
 * configuration. Nothing here calls a model, and nothing assumes a capability
 * that was not declared: with no matching profile the requirement is
 * `missing`, which becomes a `MISSING_MODEL_CAPABILITY` blocker.
 */
import { type Agent, type ModelCapability, type ModelCapabilityProfile } from "../../contracts/index.js";
export interface ModelEligibility {
    eligibleProfileIds: string[];
    missingCapabilities: ModelCapability[];
    /**
     * True when the agent's own `modelPolicy` scoped in NO profile at all — the
     * agent declared no provider, or a provider this deployment has no declared
     * profile for.
     *
     * This is deliberately distinct from "the profiles in scope lack the required
     * capabilities". Without it, an agent with no model policy is reported as
     * `CAPABILITY_MISMATCH` with a list of capabilities that the candidate
     * profile actually declares — a diagnostic that points at the wrong cause
     * and sends the operator to fix the wrong thing.
     */
    policyScopeEmpty: boolean;
    /** The provider the agent's policy named, for an honest diagnostic. */
    policyProvider?: string;
}
export declare class ModelCapabilityRegistry {
    private readonly profiles;
    constructor(profiles?: readonly ModelCapabilityProfile[]);
    register(profile: ModelCapabilityProfile): void;
    list(): ModelCapabilityProfile[];
    /** Profiles the agent's model policy may use, and whether they suffice. */
    eligibility(agent: Agent, required: readonly ModelCapability[]): ModelEligibility;
}
