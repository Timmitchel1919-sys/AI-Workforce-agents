import { type ArtifactReference, type ChangeSet, type ExecutionWorkspace, type ManagedWorkspaceView, type RepositoryReference, type RollbackReport, type SandboxHandle, type SandboxInvocationOutcome, type SandboxInvokeOptions, type SandboxProvider, type SandboxProviderCapabilities, type SandboxSpec, type SourceFingerprint, type StructuredInvocation, type WorkspaceCleanupReport, type WorkspaceControl, type WorkspaceFilePolicy } from "../../contracts/index.js";
export interface WorkspaceEvent {
    action: string;
    projectId: string;
    data: Record<string, unknown>;
}
export interface WorkspaceRepositorySandboxOptions {
    /** Trusted repository configuration (one per project). */
    repositories: readonly RepositoryReference[];
    environmentInstanceIds: readonly string[];
    /** Absolute path of the trusted git executable (composition time). */
    gitPath?: string;
    /** Adapter-owned directory for markers + session backups. */
    stateRoot: string;
    policy?: WorkspaceFilePolicy;
    projectPolicies?: Readonly<Record<string, WorkspaceFilePolicy>>;
    clock?: () => string;
    onEvent?: (event: WorkspaceEvent) => void;
    maxConcurrentInvocations?: number;
}
export declare class WorkspaceRepositorySandbox implements SandboxProvider, WorkspaceControl {
    private readonly options;
    readonly providerId = "workspace-repository";
    readonly kind: "local_restricted_process";
    readonly capabilities: SandboxProviderCapabilities;
    private readonly records;
    private readonly handles;
    /** Exclusive write leases per repository root. */
    private readonly leases;
    private readonly repositories;
    private readonly clock;
    constructor(options: WorkspaceRepositorySandboxOptions);
    isAvailableFor(environmentInstanceId: string): boolean;
    private emit;
    private setState;
    prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
    start(spec: SandboxSpec): Promise<SandboxHandle>;
    /** Throws when another live write session holds the root's lease. */
    private assertLeaseFree;
    private acquireLease;
    private create;
    terminate(): Promise<void>;
    collectOutputs(): Promise<readonly ArtifactReference[]>;
    cleanup(handle: SandboxHandle): Promise<void>;
    invoke(handle: SandboxHandle, invocation: StructuredInvocation, options: SandboxInvokeOptions): Promise<SandboxInvocationOutcome>;
    private platform;
    private resolve;
    /** realpath of `abs` (or of its nearest existing ancestor) stays inside the root. */
    private assertContained;
    private classify;
    private requireWrite;
    private currentHash;
    private guardBaseline;
    private remember;
    /** Write via a temp file in the target directory, then replace. */
    private atomicWrite;
    private recompute;
    private updateChangeSet;
    private fileOperation;
    /**
     * EO-4.4 secret scanner: pattern-based scan of source files. Reports path,
     * line and rule only — NEVER the matched value. Findings → tool_failure.
     */
    private secretScan;
    private search;
    private gitEnv;
    private git;
    private repositoryOperation;
    /**
     * Trusted: open (or re-enter) the session workspace for a build runner and
     * return its root. Lease, baseline and ownership rules apply exactly as for
     * file operations. Never exposed to agents or the API.
     */
    rootForBuild(spec: SandboxSpec): Promise<string>;
    private projectRoot;
    /**
     * Deterministic source fingerprint: base revision + every changed or
     * untracked SOURCE file (content hash). Generated output and secret files
     * are excluded (their contents are never hashed into shared evidence).
     */
    sourceFingerprint(projectId: string): Promise<SourceFingerprint>;
    /** SHA-256 + size of a workspace-relative, non-secret file. */
    digestFile(projectId: string, requested: string): Promise<{
        sha256: string;
        size: number;
    }>;
    setChangeSetStatus(workspaceId: string, status: ChangeSet["status"]): void;
    changeSet(workspaceId: string): ChangeSet | undefined;
    workspace(workspaceId: string): ManagedWorkspaceView | undefined;
    rollback(workspaceId: string, sessionId: string): Promise<RollbackReport>;
    /**
     * Release the lease and remove ONLY the adapter's own state directory, and
     * only when its ownership marker proves it. The attached working tree is
     * never deleted. Fails closed.
     */
    release(workspaceId: string, sessionId: string): Promise<WorkspaceCleanupReport>;
}
interface StatusEntry {
    path: string;
    code: string;
    fromPath?: string;
}
export declare function parseStatus(raw: string): {
    branch?: string;
    entries: StatusEntry[];
};
export declare function parseLog(raw: string): {
    commit: string;
    author: string;
    date: string;
    subject: string;
}[];
/** Drop per-file diff sections for secret-class files entirely. */
export declare function filterDiff(raw: string, isSecret: (path: string) => boolean): {
    diff: string;
    omitted: string[];
};
export {};
