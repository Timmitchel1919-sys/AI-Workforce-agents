/**
 * SoftwareFactoryEnvironmentProvider — maps the short, serializable
 * software-factory environment codes (contracts/environment-routing.ts) onto
 * concrete `EnvironmentRequirement`s and routes each through the existing
 * `EnvironmentRouter`. Routing never fabricates: a code resolves to `ROUTED`
 * only when a real, usable instance exists right now. Each code is independent
 * and evaluated in input order; this provider never throws.
 */
import type { SoftwareFactoryEnvironmentProvider } from "../../contracts/index.js";
import type { EnvironmentRouter } from "./environment-router.js";
export declare function createSoftwareFactoryEnvironmentProvider(router: EnvironmentRouter): SoftwareFactoryEnvironmentProvider;
