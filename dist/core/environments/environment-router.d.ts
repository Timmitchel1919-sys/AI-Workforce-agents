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
 */
import { type EnvironmentRequirement, type EnvironmentRoutingOutcome } from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
export declare class EnvironmentRouter {
    private readonly registry;
    constructor(registry: EnvironmentRegistry);
    route(requirement: EnvironmentRequirement): EnvironmentRoutingOutcome;
}
