/**
 * DeclarativeEnvironmentProbe — deterministic, fact-table-driven reference
 * probe. It answers detection from a compiled, trusted fact record instead of
 * probing a live machine.
 *
 * EO-2A uses this as the ONLY probe wired into the core detection flow: tests
 * and the offline reference runtime get fully deterministic discovery while the
 * real platform probes (VS Code, vswhere, Xcode, Docker, ...) arrive in later
 * tracks behind the same {@link EnvironmentProbe} port.
 */
import { type Availability, type DetectedEnvironment, type EnvironmentType, type OsName, type ToolchainDescriptor, type VersionInfo } from "../../contracts/index.js";
import { type ProbeInput } from "../../core/environments/environment-probe.js";
export interface DeclarativeEnvironmentFact {
    /** `"*"` = any host; otherwise exact hostId. */
    hostId: string | "*";
    /** `"*"` = any platform; otherwise must match `os.os`. */
    platform?: OsName | "*";
    environmentType: EnvironmentType;
    detected?: boolean;
    version?: VersionInfo | string;
    installation?: string;
    toolchains?: readonly ToolchainDescriptor[];
    availability?: Availability;
    evidence?: readonly string[];
    confidence?: number;
    warnings?: readonly string[];
    /** Overrides the auto id (`declarative_<type>`), unique per coexisting probe. */
    id?: string;
}
export declare class DeclarativeEnvironmentProbe {
    readonly id: string;
    readonly environmentType: EnvironmentType;
    private readonly fact;
    constructor(fact: DeclarativeEnvironmentFact);
    supports(os: ProbeInput["os"]): boolean;
    detect(input: ProbeInput): Promise<DetectedEnvironment>;
}
