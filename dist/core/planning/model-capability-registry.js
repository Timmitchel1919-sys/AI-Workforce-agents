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
import { ValidationError, validateModelCapabilityProfile, } from "../../contracts/index.js";
export class ModelCapabilityRegistry {
    profiles = new Map();
    constructor(profiles = []) {
        profiles.forEach((p) => this.register(p));
    }
    register(profile) {
        validateModelCapabilityProfile(profile);
        if (this.profiles.has(profile.id)) {
            throw new ValidationError(`duplicate model profile: ${profile.id}`);
        }
        this.profiles.set(profile.id, {
            ...profile,
            providerId: profile.providerId.trim().toLowerCase(),
            capabilities: [...profile.capabilities],
        });
    }
    list() {
        return [...this.profiles.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
    /** Profiles the agent's model policy may use, and whether they suffice. */
    eligibility(agent, required) {
        const provider = agent.modelPolicy?.provider?.trim().toLowerCase();
        const model = agent.modelPolicy?.model;
        const usable = provider
            ? this.list().filter((p) => p.providerId === provider &&
                (model === undefined || p.model === undefined || p.model === model))
            : [];
        const eligible = usable.filter((p) => required.every((c) => p.capabilities.includes(c)));
        const offered = new Set(usable.flatMap((p) => p.capabilities));
        return {
            eligibleProfileIds: eligible.map((p) => p.id),
            missingCapabilities: eligible.length > 0 ? [] : required.filter((c) => !offered.has(c)),
        };
    }
}
