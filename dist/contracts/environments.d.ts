/**
 * Structured, comparison-safe software version. Pre-release and build are kept
 * as opaque strings; ordering decisions use `major`/`minor`/`patch` only.
 */
export interface VersionInfo {
    major: number;
    minor: number;
    patch: number;
    preRelease?: string;
    build?: string;
}
export declare function parseVersion(value: string | null | undefined): VersionInfo | undefined;
export declare function formatVersion(version: VersionInfo): string;
/** Numeric ordering on major/minor/patch only — pre-release/build are ignored. */
export declare function versionAtLeast(actual: VersionInfo | undefined, minimum: VersionInfo): boolean;
/**
 * Total order on major/minor/patch; an absent version sorts lowest.
 * Returns a negative number when `a < b`, positive when `a > b`, else 0.
 */
export declare function compareVersions(a: VersionInfo | undefined, b: VersionInfo | undefined): number;
export declare const OS_NAMES: readonly ["windows", "macos", "linux"];
export type OsName = (typeof OS_NAMES)[number];
export declare const ARCHITECTURES: readonly ["x64", "arm64", "x86", "arm", "universal", "unknown"];
export type Architecture = (typeof ARCHITECTURES)[number];
/** Deterministic, minimal OS identity. Never a discovery source by itself. */
export interface OperatingSystem {
    os: OsName;
    /** Free-form like `"11"`, `"14.5"`, `"22.04"`. Optional and never parsed. */
    version?: string;
    architecture: Architecture;
}
export declare function validateOperatingSystem(os: OperatingSystem, field?: string): void;
export declare const HOST_TYPES: readonly ["local_workstation", "dedicated_runner", "cloud_runner", "container_host", "mac_build_host"];
export type HostType = (typeof HOST_TYPES)[number];
export declare const TRUST_LEVELS: readonly ["declared", "detected", "verified"];
export type TrustLevel = (typeof TRUST_LEVELS)[number];
export declare const AVAILABILITIES: readonly ["available", "unavailable", "degraded", "disabled"];
export type Availability = (typeof AVAILABILITIES)[number];
/**
 * Declared machine identity — the *intent* to have a host. It says nothing
 * about whether the machine is reachable, what is installed, or what it can do.
 */
export interface HostDescriptor {
    id: string;
    name: string;
    hostType: HostType;
    os: OperatingSystem;
    /** How the host identity itself was established. */
    trustLevel: TrustLevel;
    /** Cost center for cloud/gpu/ephemeral machines. Never a secret. */
    costCenter?: string;
    safeMetadata?: Record<string, unknown>;
}
/**
 * A registered, real machine. Availability is only ever set by live detection
 * or an explicit operational action — never derived from the descriptor.
 */
export interface HostInstance {
    id: string;
    hostId: string;
    name: string;
    hostType: HostType;
    os: OperatingSystem;
    trustLevel: TrustLevel;
    availability: Availability;
    capabilities: readonly CapabilityDeclaration[];
    /** Stable fingerprint across detection runs (idempotency key). */
    fingerprint: string;
    lastDetectedAt?: string;
    lastVerifiedAt?: string;
    lastHealthCheckAt?: string;
    costCenter?: string;
    safeMetadata?: Record<string, unknown>;
}
export declare const CAPABILITY_IDS: readonly ["command_execution_available", "container_runtime_available", "web_build_capable", "desktop_build_capable", "mobile_build_capable", "game_build_capable", "gpu_available"];
export type CapabilityId = (typeof CAPABILITY_IDS)[number];
/** A typed, evidenced statement about what a host can perform right now. */
export interface CapabilityDeclaration {
    capability: CapabilityId;
    available: boolean;
    /** Short, safe human-readable source of the statement. */
    evidence?: string;
    /** Bounded safe detail. Never a credential or path dump. */
    detail?: string;
}
export declare function validateCapabilityDeclaration(statement: CapabilityDeclaration, field?: string): void;
export declare const TOOLCHAIN_KINDS: readonly ["node", "dotnet", "swift_xcode", "jdk_gradle", "android_sdk", "cpp_compiler", "unity", "unreal", "python", "rust", "go", "dart"];
export type ToolchainKind = (typeof TOOLCHAIN_KINDS)[number];
/** A specific, detected toolchain with structured version metadata. */
export interface ToolchainDescriptor {
    kind: ToolchainKind;
    name: string;
    version?: VersionInfo;
    /** e.g. `env.NODE` → major/minor, bundled npm under `npm`. */
    componentVersions?: Readonly<Record<string, VersionInfo>>;
    /** Safe path only (no credential or environment dump). */
    installation?: string;
}
/**
 * A named component a toolchain must carry (an SDK, a package manager, an
 * engine module, a target-platform package). Matched against the detected
 * `ToolchainDescriptor.componentVersions` keys — never inferred.
 */
export interface ToolchainComponentRequirement {
    name: string;
    minimum?: VersionInfo;
}
export interface ToolchainRequirement {
    kind: ToolchainKind;
    minimum?: VersionInfo;
    components?: readonly ToolchainComponentRequirement[];
}
export declare const ENVIRONMENT_TYPES: readonly ["visual_studio_code", "visual_studio", "xcode", "android_studio", "docker", "unity", "unreal_engine", "cli", "cloud_runner", "web_build", "desktop_build", "mobile_build", "game_build", "container_host"];
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];
/**
 * EnvironmentDescriptor — *type support*. A declared, version-controlled
 * statement that the workforce can support an environment type. It does not
 * claim any machine has it installed.
 */
export interface EnvironmentDescriptor {
    id: string;
    name: string;
    description: string;
    environmentType: EnvironmentType;
    /** Toolchains a registered instance of this type is expected to provide. */
    supportedToolchains: readonly ToolchainRequirement[];
    /** Capabilities the host must already satisfy for this type to be usable. */
    requiredCapabilities: readonly CapabilityId[];
    /** Capabilities an instance of this type is expected to provide when detected. */
    declaredCapabilities?: readonly CapabilityId[];
    /** Restrictive compatibility guard. Absent = any platform. */
    minimumOs?: {
        os?: OsName;
        architecture?: Architecture;
    };
    metadata?: Record<string, unknown>;
}
/**
 * EnvironmentInstance — a *real, detected, registered* installation on a
 * specific host. Idempotent via `fingerprint`; never created from a descriptor.
 */
export interface EnvironmentInstance {
    id: string;
    descriptorId: string;
    hostId: string;
    environmentType: EnvironmentType;
    name: string;
    version?: VersionInfo;
    installation?: string;
    availability: Availability;
    capabilities: readonly CapabilityDeclaration[];
    toolchains: readonly ToolchainDescriptor[];
    trustLevel: TrustLevel;
    /** Stable fingerprint across detection runs (dedup key). */
    fingerprint: string;
    lastDetectedAt?: string;
    lastVerifiedAt?: string;
    lastHealthCheckAt?: string;
    safeMetadata?: Record<string, unknown>;
}
/**
 * A single probe result. `detected: false` is a valid, executed, truthful
 * result — absence of evidence is evidence of absence. Evidence/confidence are
 * safe and bounded; there is no chain-of-thought and no credential here.
 */
export interface DetectedEnvironment {
    environmentType: EnvironmentType;
    detected: boolean;
    version?: VersionInfo;
    installation?: string;
    toolchains: readonly ToolchainDescriptor[];
    availability: Availability;
    evidence: readonly string[];
    confidence: number;
    warnings: readonly string[];
}
/** The typed output of host capability discovery. Never fabricates availability. */
export interface CapabilityReport {
    hostId: string;
    discoveredAt: string;
    capabilities: readonly CapabilityDeclaration[];
    /** Probe ids / declared sources the report was derived from. */
    sources: readonly string[];
    warnings: readonly string[];
}
/**
 * The ONLY way a probe may execute a process. A definition is a fixed,
 * allowlisted, parameter-less program: a bare executable name plus a fixed
 * argument list. There is NO arbitrary-`command` endpoint — callers cannot
 * supply a command, an environment, a shell, or extra arguments.
 */
export interface CommandProbeDefinition {
    id: string;
    label?: string;
    /** Bare executable basename only (e.g. `node`). Rejects paths and shell. */
    executable: string;
    /** Fixed allowlist. Never merged with caller input. */
    arguments: readonly string[];
    timeoutMs: number;
    maxOutputBytes: number;
    /** Exit codes treated as a clean run. Defaults to `[0]`. */
    allowedExitCodes?: readonly number[];
    /** Redact outputs matching these exact secrets. Never stored. */
    redactSecrets?: readonly string[];
}
export interface ProbeExecutionResult {
    probeId: string;
    ran: boolean;
    exitCode?: number;
    /** Bounded and redacted. */
    stdout: string;
    stderr?: string;
    outputBytes: number;
    durationMs: number;
    /** Machine-readable failure, message only — never a stack trace. */
    error?: string;
}
/** Port implemented by `adapters/execution`. Injectable for tests. */
export interface CommandProbeExecutor {
    execute(definition: CommandProbeDefinition): Promise<ProbeExecutionResult>;
}
export interface EnvironmentRequirement {
    descriptorId?: string;
    environmentType?: EnvironmentType;
    requiredCapabilities?: readonly CapabilityId[];
    toolchains?: readonly ToolchainRequirement[];
    /** Host platform guard, matched against the instance's host OS. */
    os?: {
        os?: OsName;
        architecture?: Architecture;
    };
    /** Lowest acceptable instance trust level. Absent = any. */
    minimumTrust?: TrustLevel;
}
/** Machine-readable reasons an instance was rejected for a requirement. */
export declare const ENVIRONMENT_REJECTION_REASONS: readonly ["instance_unavailable", "host_unavailable", "host_unknown", "descriptor_mismatch", "environment_type_mismatch", "os_mismatch", "architecture_mismatch", "trust_too_low", "missing_capability", "missing_toolchain", "toolchain_version_too_low", "missing_toolchain_component", "toolchain_component_version_too_low"];
export type EnvironmentRejectionReason = (typeof ENVIRONMENT_REJECTION_REASONS)[number];
export interface EnvironmentCandidateEvidence {
    instanceId: string;
    hostId: string;
    descriptorId: string;
    environmentType: EnvironmentType;
    trustLevel: TrustLevel;
    eligible: boolean;
    reasonCodes: readonly EnvironmentRejectionReason[];
    matchedCapabilities: readonly CapabilityId[];
    missingCapabilities: readonly CapabilityId[];
    /** `kind` or `kind:component` labels that were not satisfied. */
    missingToolchains: readonly string[];
}
/**
 * Explainable, deterministic evaluation of a requirement against every
 * registered instance. `selectedInstanceId` is set only when an eligible,
 * usable instance exists — a descriptor alone never selects anything.
 */
export interface EnvironmentMatchEvidence {
    outcome: EnvironmentRoutingOutcome["outcome"];
    selectedInstanceId?: string;
    selectedHostId?: string;
    /** Descriptor that declares support (may exist with no usable instance). */
    supportingDescriptorId?: string;
    candidates: readonly EnvironmentCandidateEvidence[];
    tieBreak: readonly string[];
}
export type EnvironmentRoutingOutcome = {
    outcome: "ROUTED";
    instance: EnvironmentInstance;
    host: HostInstance;
} | {
    outcome: "REQUIRES_PROVISIONING";
    reason: string;
    descriptorId?: string;
} | {
    outcome: "NO_AVAILABLE_ENVIRONMENT";
    reason: string;
};
export interface AgentQualificationResult {
    agentId: string;
    qualifies: boolean;
    reason: string;
    matchedCapability?: string;
}
export type AgentRouteResult = {
    outcome: "ROUTED";
    agentId: string;
    instance: EnvironmentInstance;
} | {
    outcome: "NOT_QUALIFIED";
    agentId: string;
    reason: string;
} | {
    outcome: "REQUIRES_PROVISIONING";
    agentId: string;
    reason: string;
} | {
    outcome: "NO_AVAILABLE_ENVIRONMENT";
    agentId: string;
    reason: string;
};
/** Safe answer for `GET /api/hosts/:hostId/capabilities`. */
export interface HostCapabilitySnapshot {
    hostId: string;
    host: HostInstance;
    capabilities: readonly CapabilityDeclaration[];
}
export declare function validateToolchainDescriptor(toolchain: ToolchainDescriptor, field?: string): void;
export declare function validateToolchainRequirement(requirement: ToolchainRequirement, field?: string): void;
export declare function validateHostDescriptor(host: HostDescriptor): void;
export declare function validateHostInstance(host: HostInstance): void;
export declare function validateEnvironmentDescriptor(descriptor: EnvironmentDescriptor): void;
export declare function validateEnvironmentInstance(instance: EnvironmentInstance): void;
export declare function validateDetectedEnvironment(detected: DetectedEnvironment): void;
export declare function validateCommandProbeDefinition(definition: CommandProbeDefinition): void;
export declare function validateEnvironmentRequirement(requirement: EnvironmentRequirement): void;
