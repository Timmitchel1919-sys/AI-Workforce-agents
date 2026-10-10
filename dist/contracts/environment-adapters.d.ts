import type { EnvironmentInstance, HostInstance, ToolchainKind, ToolchainRequirement, VersionInfo } from "./environments.js";
import type { ExecutionReason, ResourceLimitKey, NetworkPolicy, SandboxInvocationOutcome, SecretReference, StructuredInvocation } from "./execution.js";
/**
 * Execution families. An IDE is NOT a family: Visual Studio, VS Code and
 * Android Studio projects route to the underlying toolchain family.
 */
export declare const ENVIRONMENT_FAMILIES: readonly ["windows", "macos", "android", "linux", "docker", "cloud", "unity", "unreal"];
export type EnvironmentFamily = (typeof ENVIRONMENT_FAMILIES)[number];
export interface GpuRequirement {
    required: true;
    vendors?: readonly string[];
    minimumMemoryClass?: GpuMemoryClass;
    graphicsApis?: readonly string[];
    compute?: boolean;
}
export declare const GPU_MEMORY_CLASSES: readonly ["low", "medium", "high", "very_high"];
export type GpuMemoryClass = (typeof GPU_MEMORY_CLASSES)[number];
/** Exact engine/toolchain version pinning (Unity, Unreal). */
export interface ExactToolchainVersion {
    kind: ToolchainKind;
    version: VersionInfo;
    /** `exact` = major.minor.patch; `major_minor` = patch may differ. */
    match: "exact" | "major_minor";
}
/** What ONE registered operation needs from an execution environment. */
export interface EnvironmentOperationRequirement {
    family: EnvironmentFamily;
    toolchains: readonly ToolchainRequirement[];
    exactVersions?: readonly ExactToolchainVersion[];
    /**
     * Platform targets / engine modules that discovery must PROVE (e.g.
     * `ios`, `android`, `windows`, a Unity build module).
     */
    targets?: readonly string[];
    gpu?: GpuRequirement;
    /** Container workload (docker family only). */
    container?: ContainerRequest;
    /** Signing is never implied by building (BUILD ≠ SIGN). */
    signing?: boolean;
    /** Publishing is never implied by building (BUILD ≠ PUBLISH). */
    publishing?: boolean;
    /** Headless/batch execution (default). GUI automation is not supported. */
    interactive?: boolean;
}
export interface GpuDescriptor {
    vendor: string;
    memoryClass: GpuMemoryClass;
    graphicsApis: readonly string[];
    compute: boolean;
}
/**
 * Structured execution facts an EO-2 probe may attach to an instance under
 * `safeMetadata.execution`. Absent = not discovered = NOT assumed.
 */
export interface ExecutionDiscoveryMetadata {
    /** Proven platform targets / installed engine modules / SDKs. */
    targets: readonly string[];
    gpu?: GpuDescriptor;
    /** Container daemon state as last observed (docker family). */
    containerDaemon?: "operational" | "unreachable";
}
export declare function readExecutionDiscovery(instance: EnvironmentInstance): ExecutionDiscoveryMetadata;
export interface AdapterContext {
    instance: EnvironmentInstance;
    host: HostInstance;
}
export interface ToolchainObservationEvidence {
    kind: string;
    version?: string;
}
export interface AdapterCompatibility {
    eligible: boolean;
    reasons: readonly ExecutionReason[];
    /** Toolchain versions the decision relied on (discovery evidence). */
    toolchains: readonly ToolchainObservationEvidence[];
}
/**
 * Knows how AI Workforce interacts with ONE environment family. Pure and
 * deterministic: it evaluates authoritative metadata, it never executes.
 */
export interface EnvironmentExecutionAdapter {
    readonly adapterId: string;
    readonly version: string;
    readonly family: EnvironmentFamily;
    readonly description: string;
    /** Executables this adapter's runners may serve (trusted ids only). */
    readonly executables: readonly string[];
    evaluate(context: AdapterContext, requirement: EnvironmentOperationRequirement): AdapterCompatibility;
}
export declare const RUNNER_STATUSES: readonly ["online", "busy", "draining", "offline", "stale"];
export type RunnerStatus = (typeof RUNNER_STATUSES)[number];
export declare const RUNNER_CLASSES: readonly ["local", "self_hosted", "cloud", "shared"];
export type RunnerClass = (typeof RUNNER_CLASSES)[number];
export interface RunnerDescriptor {
    runnerId: string;
    adapterId: string;
    /** EO-2 instances this runner executes for. */
    environmentInstanceIds: readonly string[];
    runnerClass: RunnerClass;
    trust: "trusted" | "shared_untrusted";
    /**
     * Verifiable identity (key fingerprint / attestation id). A runner is
     * never addressed by a URL from a request; unverified runners never run.
     */
    identity: {
        fingerprint: string;
        verified: boolean;
    };
    /** Simultaneous leases. */
    capacity: number;
    /** Projects this runner may serve; absent = any project. */
    projectIds?: readonly string[];
    /** The isolation the runner's sandbox ACTUALLY enforces. */
    sandbox: {
        filesystemIsolation: boolean;
        networkIsolation: boolean;
        enforcedLimits: readonly ResourceLimitKey[];
        networkModes: readonly NetworkPolicy["mode"][];
        supportsKill: boolean;
    };
    /** Runner authentication: a reference resolved server-side only. */
    credentialRef?: SecretReference;
    /** Routing metadata for cost/security/residency — never prices. */
    routing?: {
        provider?: string;
        resourceClass?: "small" | "medium" | "large" | "gpu";
        durationClass?: "short" | "medium" | "long";
        region?: string;
        jurisdiction?: string;
        residency?: string;
    };
    /** Test/simulation runner: receipts are labelled simulated. */
    simulated?: boolean;
}
export interface RunnerHeartbeat {
    status: RunnerStatus;
    at: string;
}
export interface RunnerJobSpec {
    jobId: string;
    sessionId: string;
    projectId: string;
    environmentInstanceId: string;
    workspaceId: string;
    workspaceMode: "read_only" | "read_write";
}
export interface RunnerRunOptions {
    signal: AbortSignal;
    maxOutputBytes: number;
    knownSecrets: readonly string[];
    /** Resolved runner credential (server-side only; never serialized). */
    credential?: string;
}
/** Runner result = sandbox outcome + environment evidence it reports. */
export interface RunnerRunResult extends SandboxInvocationOutcome {
    /** Fingerprint of the source the runner actually executed. */
    sourceFingerprint?: string;
    toolchains?: readonly ToolchainObservationEvidence[];
}
/**
 * Performs bounded execution. Receives a StructuredInvocation (registered
 * executable id + fixed argv), never a command string.
 */
export interface ExecutionRunner {
    readonly descriptor: RunnerDescriptor;
    /** Latest heartbeat; undefined = never seen. */
    heartbeat(): RunnerHeartbeat | undefined;
    /** Bounded readiness probe; never arbitrary execution. */
    healthCheck(signal: AbortSignal): Promise<{
        ready: boolean;
        detail: string;
    }>;
    prepare(spec: RunnerJobSpec): Promise<void>;
    run(jobId: string, invocation: StructuredInvocation, options: RunnerRunOptions): Promise<RunnerRunResult>;
    cancel(jobId: string, reason: string): Promise<void>;
    release(jobId: string): Promise<void>;
    /** Declared-artifact transfer endpoints (optional). */
    readArtifact?(projectId: string, path: string): Promise<Uint8Array>;
    writeArtifact?(projectId: string, path: string, bytes: Uint8Array): Promise<{
        sha256: string;
        size: number;
    }>;
}
/** Environment evidence stamped on receipts (no secrets). */
export interface EnvironmentExecutionEvidence {
    environmentInstanceId: string;
    adapterId: string;
    adapterVersion: string;
    runnerId: string;
    runnerIdentity: string;
    runnerClass: RunnerClass;
    toolchains: readonly ToolchainObservationEvidence[];
    sourceFingerprint?: string;
    simulated: boolean;
}
export interface RunnerLease {
    leaseId: string;
    runnerId: string;
    sessionId: string;
    projectId: string;
    acquiredAt: string;
    expiresAt: string;
}
/**
 * A container workload. Mount SOURCES are symbolic (the leased workspace or
 * the artifact directory) — there is no way to name a host path.
 */
export interface ContainerRequest {
    image: {
        name: string;
        version: string;
        digest?: string;
    };
    mounts: readonly {
        source: "workspace" | "artifacts";
        target: string;
        readOnly: boolean;
    }[];
    privileged?: boolean;
    hostNetwork?: boolean;
    hostPid?: boolean;
    dockerSocket?: boolean;
    devices?: readonly string[];
}
/** Trusted, per-deployment container policy. */
export interface ContainerPolicy {
    approvedImages: readonly {
        name: string;
        versions: readonly string[];
        digest?: string;
    }[];
    /** Digest pinning required for every image. */
    requireDigest: boolean;
}
/**
 * Deny-by-default container validation. Privileged mode, host networking,
 * host PID, Docker socket access and device passthrough are NEVER granted
 * by an operation request in EO-4.5.
 */
export declare function evaluateContainerRequest(request: ContainerRequest, policy: ContainerPolicy): ExecutionReason[];
/** Toolchain presence + minimum/exact versions from discovery evidence. */
export declare function evaluateToolchains(instance: EnvironmentInstance, requirement: EnvironmentOperationRequirement): {
    reasons: ExecutionReason[];
    observed: ToolchainObservationEvidence[];
};
/** Targets/modules/SDKs must be PROVEN by discovery metadata. */
export declare function evaluateTargets(instance: EnvironmentInstance, requirement: EnvironmentOperationRequirement): ExecutionReason[];
/** GPU is only assumed when discovered — and only checked when required. */
export declare function evaluateGpu(instance: EnvironmentInstance, requirement: EnvironmentOperationRequirement): ExecutionReason[];
/** Signing and publishing are separate protected capabilities. */
export declare function evaluateDistribution(requirement: EnvironmentOperationRequirement): ExecutionReason[];
export declare function validateRunnerDescriptor(d: RunnerDescriptor): void;
