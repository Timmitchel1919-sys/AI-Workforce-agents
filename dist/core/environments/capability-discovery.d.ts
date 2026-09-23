/**
 * HostCapabilityDiscovery — turns detection facts into a typed, safe
 * `CapabilityReport`. The capability set is derived deterministically from
 * probe outcomes and declared facts; it is never inferred from the OS.
 */
import type { CapabilityReport, DetectedEnvironment } from "../../contracts/index.js";
import { type DeclaredFacts } from "./capability-mapping.js";
export interface CapabilityDiscoveryOptions {
    clock?: () => string;
}
export declare class HostCapabilityDiscovery {
    private readonly options;
    constructor(options?: CapabilityDiscoveryOptions);
    /**
     * @param detected   only executed probes (detected true or false).
     * @param declared   operator-declared capabilities/toolchains (trusted).
     * @param sources    probe ids / declared labels the report was built from.
     */
    derive(hostId: string, detected: readonly DetectedEnvironment[], declared?: DeclaredFacts, sources?: readonly string[]): CapabilityReport;
    private clock;
}
