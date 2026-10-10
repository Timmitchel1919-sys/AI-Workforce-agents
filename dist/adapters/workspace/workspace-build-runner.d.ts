import { type ArtifactReference, type ExecutionWorkspace, type SandboxHandle, type SandboxInvocationOutcome, type SandboxInvokeOptions, type SandboxProvider, type SandboxProviderCapabilities, type SandboxSpec, type StructuredInvocation } from "../../contracts/index.js";
import type { WorkspaceRepositorySandbox } from "./workspace-repository-sandbox.js";
export interface WorkspaceBuildRunnerOptions {
    workspace: WorkspaceRepositorySandbox;
    /** executableId → absolute path (trusted composition only). */
    executables: Readonly<Record<string, string>>;
    environmentInstanceIds: readonly string[];
    /** Controlled env values; only names a tool declares are passed. */
    controlledEnvironment?: Readonly<Record<string, string>>;
    maxConcurrentInvocations?: number;
}
export declare class WorkspaceBuildRunner implements SandboxProvider {
    private readonly options;
    readonly providerId = "workspace-build-runner";
    readonly kind: "local_restricted_process";
    readonly capabilities: SandboxProviderCapabilities;
    private readonly roots;
    constructor(options: WorkspaceBuildRunnerOptions);
    isAvailableFor(environmentInstanceId: string): boolean;
    prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
    start(spec: SandboxSpec): Promise<SandboxHandle>;
    invoke(handle: SandboxHandle, invocation: StructuredInvocation, options: SandboxInvokeOptions): Promise<SandboxInvocationOutcome>;
    terminate(): Promise<void>;
    collectOutputs(): Promise<readonly ArtifactReference[]>;
    cleanup(handle: SandboxHandle): Promise<void>;
}
