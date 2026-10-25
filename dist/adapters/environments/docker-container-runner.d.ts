import { type ContainerPolicy, type ExecutionRunner, type RunnerDescriptor, type RunnerHeartbeat, type RunnerJobSpec, type RunnerRunOptions, type RunnerRunResult, type StructuredInvocation } from "../../contracts/index.js";
import { type BoundedProcessResult, type BoundedProcessSpec } from "../execution/bounded-process-runner.js";
/** A single image mapped to one business executable. */
export interface DockerImageBinding {
    /** Approved image name, exactly as it appears in {@link ContainerPolicy}. */
    readonly name: string;
    /** Approved image tag/version. */
    readonly version: string;
    /** Pinned digest (`sha256:...`); required when the policy demands it. */
    readonly digest?: string;
    /**
     * Entry point inside the container. Server-controlled; the agent never
     * supplies it. Defaults to the executableId itself, e.g. "node".
     */
    readonly entrypoint?: readonly string[];
    /** Non-root UID the container must run as. Defaults to 1000. */
    readonly uid?: number;
    /** Hard container limits — all honestly reported in the descriptor. */
    readonly limits?: {
        readonly memoryBytes?: number;
        readonly cpus?: number;
        readonly pidsLimit?: number;
    };
}
/**
 * Trusted port that maps `workspaceId` to an absolute HOST path. Production
 * composition supplies this (e.g. the WorkspaceRepositorySandbox's state
 * root). Agents never influence it; a lookup that returns `null` means the
 * workspace cannot be mounted and the invocation runs without it.
 */
export interface WorkspacePathResolver {
    resolve(workspaceId: string, projectId: string): Promise<string | null>;
}
/** The fixed, hard-coded in-container target for the workspace bind-mount. */
export declare const CONTAINER_WORKSPACE_TARGET = "/workspace";
export interface DockerContainerRunnerOptions {
    readonly runnerId: string;
    /** Must equal the registered adapter id (`docker-container`). */
    readonly adapterId: string;
    readonly environmentInstanceIds: readonly string[];
    /** Verifiable local-host identity, e.g. the EO-2 host fingerprint. */
    readonly identityFingerprint: string;
    /** Absolute path to the docker CLI (resolved by trusted composition). */
    readonly dockerExecutable: string;
    /** executableId → image binding; agents never see this map. */
    readonly imagesByExecutable: Readonly<Record<string, DockerImageBinding>>;
    /** Live container policy — re-evaluated on every call. */
    readonly containerPolicy: ContainerPolicy;
    readonly capacity?: number;
    /**
     * Trusted workspace resolver. When present, the runner bind-mounts the
     * resolved host path at `/workspace` inside the container, read-only
     * unless the job spec's `workspaceMode` is `read_write`. Target path is a
     * fixed server-side constant; agents cannot influence the mount at all.
     */
    readonly workspaceResolver?: WorkspacePathResolver;
    /** Injected for tests; defaults to the EO-4.2 bounded process runner. */
    readonly processRunner?: (spec: BoundedProcessSpec) => Promise<BoundedProcessResult>;
    /** Injected for tests; defaults to crypto.randomUUID. */
    readonly nameFactory?: () => string;
}
export declare class DockerContainerRunner implements ExecutionRunner {
    private readonly options;
    readonly descriptor: RunnerDescriptor;
    private readonly jobs;
    private readonly processRunner;
    private readonly nameFactory;
    constructor(options: DockerContainerRunnerOptions);
    heartbeat(): RunnerHeartbeat;
    healthCheck(signal: AbortSignal): Promise<{
        ready: boolean;
        detail: string;
    }>;
    prepare(spec: RunnerJobSpec): Promise<void>;
    run(jobId: string, invocation: StructuredInvocation, options: RunnerRunOptions): Promise<RunnerRunResult>;
    cancel(jobId: string): Promise<void>;
    release(jobId: string): Promise<void>;
    private buildChildEnv;
    /** Build the hardened `docker run` argv. Pure function, test-friendly. */
    composeDockerArgv(containerName: string, binding: DockerImageBinding, invocation: StructuredInvocation, workspaceMount?: {
        hostSource: string;
        readOnly: boolean;
    }): string[];
    private formatImageRef;
}
