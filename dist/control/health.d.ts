/**
 * System health — only what is actually measurable in-process.
 *
 * A `HealthProbe` returns the status of one component. The Control Plane never
 * *claims* an external provider is healthy: unless a probe has actually checked
 * it, its status is reported as `unknown` with an explicit "not checked" note.
 * `unknown` is not a failure — it means unmeasured.
 */
import { type HealthStatus, type SystemHealth } from "../contracts/index.js";
export interface HealthProbe {
    readonly name: string;
    check(): HealthStatus | {
        status: HealthStatus;
        detail: string;
    };
}
/** A component that has not been wired to a real check. Honest by default. */
export declare function unverifiedComponent(name: string, detail?: string): HealthProbe;
export declare function buildSystemHealth(probes: readonly HealthProbe[], clock?: () => number): SystemHealth;
