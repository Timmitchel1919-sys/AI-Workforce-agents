/**
 * Environment probe plugin model.
 *
 * A probe detects whether a specific environment type is installed and usable
 * on a host. Probes are the ONLY source of environment truth — a descriptor or
 * an OS can never be used to claim an environment exists. EO-2A defines the
 * shared framework here; concrete probe *implementations* arrive in later
 * tracks (VS Code, VS/vswhere, Xcode, Docker, Unity, ...).
 */
import type { DetectedEnvironment, EnvironmentType, OperatingSystem } from "../../contracts/index.js";
export interface ProbeInput {
    hostId: string;
    os: OperatingSystem;
}
export interface EnvironmentProbe {
    /** Stable, unique, allowlisted probe id. */
    readonly id: string;
    /** The environment type this probe reasons about. */
    readonly environmentType: EnvironmentType;
    /** Whether this probe can meaningfully run on the given host platform. */
    supports(os: OperatingSystem): boolean;
    /** Run the probe. `detected: false` is a valid, executed result. */
    detect(input: ProbeInput): Promise<DetectedEnvironment>;
}
export type ProbeLookup = () => ProbeRegistry | readonly EnvironmentProbe[];
/** Ordered registry of probes, filtered per host platform. */
export declare class ProbeRegistry {
    private readonly probes;
    register(probe: EnvironmentProbe): void;
    list(): readonly EnvironmentProbe[];
    /** Every probe applicable to a host platform, in registration order. */
    applicable(os: OperatingSystem): EnvironmentProbe[];
    /** Every probe for a specific environment type on a host platform. */
    forType(os: OperatingSystem, environmentType: EnvironmentType): EnvironmentProbe[];
}
