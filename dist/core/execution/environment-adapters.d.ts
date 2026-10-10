import { type ArtifactRecord, type ArtifactReference, type EnvironmentExecutionAdapter, type EnvironmentFamily, type ExecutionOperationDefinition, type ExecutionReason, type ExecutionRunner, type ExecutionWorkspace, type RunnerClass, type RunnerLease, type SandboxHandle, type SandboxInvocationOutcome, type SandboxInvokeOptions, type SandboxKind, type SandboxProvider, type SandboxProviderCapabilities, type SandboxSpec, type SecretReference, type StructuredInvocation, type ToolchainObservationEvidence } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
/** Server-side resolution of runner credentials (never serialized). */
export interface RunnerCredentialResolver {
    resolve(ref: SecretReference, runnerId: string): Promise<string>;
}
/** Trusted per-project routing policy (security / residency aware). */
export interface ProjectRunnerPolicy {
    allowedRunnerClasses?: readonly RunnerClass[];
    /** Sensitive projects: never a shared/untrusted runner. */
    requireTrustedRunner?: boolean;
    allowedRegions?: readonly string[];
}
export interface EnvironmentAdapterRegistryOptions {
    environments: Pick<EnvironmentRegistry, "getInstance" | "getHost" | "listInstances">;
    audit?: AuditLog;
    credentials?: RunnerCredentialResolver;
    /** Heartbeat age after which a runner is STALE. Default 60 s. */
    staleAfterMs?: number;
    /** Bounded health-check timeout. Default 5 s. */
    healthCheckTimeoutMs?: number;
    /** Disconnect watchdog poll interval. Default 1 s. */
    heartbeatPollMs?: number;
    /** Extra time a runner gets past the operation timeout. Default 2 s. */
    timeoutGraceMs?: number;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
}
export interface AdapterResolution {
    ready: boolean;
    reasons: readonly ExecutionReason[];
    adapterId?: string;
    adapterVersion?: string;
    runnerId?: string;
    /** SandboxProvider id of the selected runner. */
    providerId?: string;
    toolchains: readonly ToolchainObservationEvidence[];
    rejectedRunners: readonly {
        runnerId: string;
        codes: readonly string[];
    }[];
    /** The adapter accepted the environment (only runners were missing). */
    compatible?: boolean;
}
export interface StageRoutingDecision {
    stageId: string;
    family: EnvironmentFamily;
    environmentInstanceId?: string;
    adapterId?: string;
    runnerId?: string;
    reasons: readonly ExecutionReason[];
}
export interface FamilyExecutionStatus {
    family: EnvironmentFamily;
    adapters: readonly {
        adapterId: string;
        version: string;
    }[];
    /** Real (non-simulated) runner state — never reported from test doubles. */
    status: "available" | "busy" | "offline" | "stale" | "not_configured" | "unsupported";
    realRunners: number;
    simulatedRunners: number;
}
export declare class EnvironmentAdapterRegistry {
    readonly options: EnvironmentAdapterRegistryOptions;
    private readonly adapters;
    private readonly runners;
    private readonly providers;
    private readonly leases;
    private readonly projectPolicies;
    readonly clock: () => string;
    readonly newId: (prefix: string) => string;
    constructor(options: EnvironmentAdapterRegistryOptions);
    registerAdapter(adapter: EnvironmentExecutionAdapter): void;
    /** Registers a runner and returns its SandboxProvider bridge. */
    registerRunner(runner: ExecutionRunner): RunnerSandboxProvider;
    setProjectPolicy(projectId: string, policy: ProjectRunnerPolicy): void;
    getRunner(runnerId: string): ExecutionRunner | undefined;
    record(action: string, projectId: string | undefined, data: Record<string, unknown>): void;
    /** Live = recent heartbeat in online/busy. Draining accepts no new work. */
    liveness(runner: ExecutionRunner): ExecutionReason | undefined;
    projectDenial(runner: ExecutionRunner, projectId: string): ExecutionReason | undefined;
    private reclaimExpired;
    activeLeases(runnerId: string): RunnerLease[];
    /** Bounded, expiring reservation — crashed sessions never lock forever. */
    acquireLease(runnerId: string, sessionId: string, projectId: string, ttlMs: number): RunnerLease;
    releaseLease(leaseId: string): void;
    /**
     * Is this registered operation execution-ready on this instance? Checks,
     * in order: adapter for the family, instance/host availability, adapter
     * compatibility (platform, toolchains, versions, targets, GPU, container
     * policy, BUILD ≠ SIGN ≠ PUBLISH), executable, then runners (identity,
     * project policy, liveness, capacity). Deterministic.
     */
    resolve(input: {
        projectId: string;
        environmentInstanceId: string;
        operation: ExecutionOperationDefinition;
        executableId?: string;
    }): AdapterResolution;
    /**
     * Stage-level routing across instances (multi-environment projects).
     * Deterministic: instances are tried in id order; the first ready one wins.
     * A stage with no ready instance is reported with the reasons of the best
     * candidate — never assigned somewhere incompatible.
     */
    routeStages(projectId: string, stages: readonly {
        stageId: string;
        operation: ExecutionOperationDefinition;
        executableId?: string;
    }[]): StageRoutingDecision[];
    /** Authoritative per-family execution status (for API/UI). */
    status(): FamilyExecutionStatus[];
}
export declare const runnerProviderId: (runnerId: string) => string;
/**
 * Exposes ONE runner to the ExecutionManager as a SandboxProvider. Only
 * eligible when the manager routed the operation to this exact runner.
 */
export declare class RunnerSandboxProvider implements SandboxProvider {
    private readonly registry;
    private readonly runner;
    private readonly adapter;
    readonly providerId: string;
    readonly kind: SandboxKind;
    readonly capabilities: SandboxProviderCapabilities;
    private readonly jobs;
    constructor(registry: EnvironmentAdapterRegistry, runner: ExecutionRunner, adapter: EnvironmentExecutionAdapter);
    isAvailableFor(environmentInstanceId: string): boolean;
    prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
    start(spec: SandboxSpec): Promise<SandboxHandle>;
    invoke(handle: SandboxHandle, invocation: StructuredInvocation, options: SandboxInvokeOptions): Promise<SandboxInvocationOutcome>;
    terminate(handle: SandboxHandle, reason: string): Promise<void>;
    collectOutputs(): Promise<readonly ArtifactReference[]>;
    cleanup(handle: SandboxHandle): Promise<void>;
}
export interface ArtifactHandoffOptions {
    registry: EnvironmentAdapterRegistry;
    artifacts: {
        get(projectId: string, artifactId: string): ArtifactRecord | undefined;
    };
    maxBytes: number;
}
/**
 * Moves ONE declared artifact (an ArtifactRecord) from one runner to another,
 * for the intended source fingerprint only, verifying the SHA-256 on read
 * and on write. Undeclared paths cannot be transferred.
 */
export declare class ArtifactHandoffService {
    private readonly options;
    constructor(options: ArtifactHandoffOptions);
    transfer(input: {
        projectId: string;
        artifactId: string;
        fromRunnerId: string;
        toRunnerId: string;
        expectedSourceFingerprint: string;
    }): Promise<{
        artifactId: string;
        sha256: string;
        size: number;
    }>;
}
