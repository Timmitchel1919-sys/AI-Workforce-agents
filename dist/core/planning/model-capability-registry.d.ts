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
}
export declare class ModelCapabilityRegistry {
    private readonly profiles;
    constructor(profiles?: readonly ModelCapabilityProfile[]);
    register(profile: ModelCapabilityProfile): void;
    list(): ModelCapabilityProfile[];
    /** Profiles the agent's model policy may use, and whether they suffice. */
    eligibility(agent: Agent, required: readonly ModelCapability[]): ModelEligibility;
}
