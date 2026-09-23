/**
 * EnvironmentDetector — the discovery orchestration boundary.
 *
 *   Host request → applicable probes → DetectedEnvironment[] → registry
 *
 * The detector is responsible for everything about a discovery pass: choosing
 * probes for the host platform, running them (errors become warnings, never
 * fatal), computing fingerprints, updating host + instance records idempotently,
 * marking previously-seen-but-now-missing environments unavailable, and
 * recording structured audit events. It never guesses: no OS inference, no
 * fake availability, no synthetic environments.
 */
import { type CapabilityDeclaration, type EnvironmentType, type HostInstance, type HostType, type OperatingSystem, type ToolchainDescriptor, type TrustLevel } from "../../contracts/index.js";
import { type AuditLog } from "../audit/audit-log.js";
import { type ProbeRegistry } from "./environment-probe.js";
import { EnvironmentRegistry } from "./environment-registry.js";
export interface DetectHostRequest {
    hostId: string;
    name: string;
    hostType: HostType;
    os: OperatingSystem;
    trustLevel?: TrustLevel;
    costCenter?: string;
    safeMetadata?: Record<string, unknown>;
    /** Capabilities the host owner declares (highest trust, so they win). */
    declaredCapabilities?: readonly CapabilityDeclaration[];
    /** Toolchains the host owner declares (used for capability mapping). */
    declaredToolchains?: readonly ToolchainDescriptor[];
    /** Restrict discovery to these probe ids. Default: all applicable. */
    probes?: readonly string[];
    /** Injectable deterministic timestamp. */
    detectedAt?: string;
}
export interface DetectionOutcome {
    hostId: string;
    host: HostInstance;
    detected: readonly EnvironmentType[];
    registered: readonly string[];
    refreshed: readonly string[];
    madeUnavailable: readonly string[];
    warnings: readonly string[];
}
export interface EnvironmentDetectorOptions {
    /** Overrides the default absolute clock for deterministic tests. */
    clock?: () => string;
}
export declare class EnvironmentDetector {
    private readonly registry;
    private readonly probes;
    private readonly audit?;
    private readonly discovery;
    private readonly resolvedClock;
    constructor(registry: EnvironmentRegistry, probes: ProbeRegistry, audit?: AuditLog | undefined, options?: EnvironmentDetectorOptions);
    detect(request: DetectHostRequest): Promise<DetectionOutcome>;
    /**
     * Previously-registered instances on this host that were not re-detected are
     * transitioned to `unavailable` — never silently dropped, never kept
     * available. Credentials/sensitive data are not touched.
     */
    private markMissingInstancesUnavailable;
    private upsertHost;
}
