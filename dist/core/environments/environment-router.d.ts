/**
 * EnvironmentRouter — routes a build/execution requirement to a REAL, currently
 * usable environment instance. Routing never fabricates: an "Xcode" environment
 * that nobody detected is never routed to, even if a descriptor exists.
 *
 * Outcomes:
 *   - ROUTED                a real instance + host are usable right now,
 *   - REQUIRES_PROVISIONING the workforce declares support, but no usable
 *                           instance exists yet,
 *   - NO_AVAILABLE_ENVIRONMENT no descriptor supports the requirement.
 *
 * `evaluate()` (EO-3.1) returns the same outcome plus structured evidence for
 * every registered instance — why it was eligible or rejected — so planning
 * decisions are explainable. Selection among eligible instances is
 * deterministic: trust level (verified > detected > declared), then environment
 * version (higher first), then instance id (ascending). No scoring.
 */
import { type EnvironmentMatchEvidence, type EnvironmentRequirement, type EnvironmentRoutingOutcome } from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
export declare const ENVIRONMENT_TIE_BREAK: readonly ["trust_level_desc", "environment_version_desc", "instance_id_asc"];
export declare class EnvironmentRouter {
    private readonly registry;
    constructor(registry: EnvironmentRegistry);
    route(requirement: EnvironmentRequirement): EnvironmentRoutingOutcome;
    /** Explainable evaluation of a requirement against every instance. */
    evaluate(requirement: EnvironmentRequirement): EnvironmentMatchEvidence;
}
