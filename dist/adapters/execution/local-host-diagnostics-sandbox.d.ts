import { type ArtifactReference, type ExecutionWorkspace, type SandboxHandle, type SandboxInvocationOutcome, type SandboxInvokeOptions, type SandboxProvider, type SandboxProviderCapabilities, type SandboxSpec, type StructuredInvocation } from "../../contracts/index.js";
export interface LocalHostDiagnosticsOptions {
    /** executableId → absolute path, from trusted composition only. */
    executables: Readonly<Record<string, string>>;
    /** Environment instances (on this host) the provider may serve. */
    environmentInstanceIds: readonly string[];
    /** Controlled env var values; only names an executable declares are passed. */
    controlledEnvironment?: Readonly<Record<string, string>>;
    /** Parent for per-invocation scratch directories. Default: OS temp dir. */
    scratchRoot?: string;
    maxConcurrentInvocations?: number;
}
export declare class LocalHostDiagnosticsSandbox implements SandboxProvider {
    private readonly options;
    readonly providerId = "local-host-diagnostics";
    readonly kind: "local_restricted_process";
    readonly capabilities: SandboxProviderCapabilities;
    private readonly scratch;
    constructor(options: LocalHostDiagnosticsOptions);
    isAvailableFor(environmentInstanceId: string): boolean;
    prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
    start(spec: SandboxSpec): Promise<SandboxHandle>;
    invoke(handle: SandboxHandle, invocation: StructuredInvocation, options: SandboxInvokeOptions): Promise<SandboxInvocationOutcome>;
    terminate(): Promise<void>;
    collectOutputs(): Promise<readonly ArtifactReference[]>;
    cleanup(handle: SandboxHandle): Promise<void>;
}
