import { type CommandPolicy } from "../../core/execution/command-policy.js";
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
import { type BoundedProcessResult, type TrustedExecutable } from "./bounded-process-runner.js";
export interface GovernedProcessInput {
    readonly executableId: string;
    readonly args: readonly string[];
    readonly timeoutMs: number;
    readonly env?: Readonly<Record<string, string>>;
    readonly knownSecrets?: readonly string[];
    readonly maxOutputBytes?: number;
}
export interface GovernedProcessOutput {
    readonly executableId: string;
    readonly args: readonly string[];
    readonly exitCode: number | null;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
    readonly durationMs: number;
    readonly stdout: BoundedProcessResult["stdout"];
    readonly stderr: BoundedProcessResult["stderr"];
    readonly redactions: number;
}
export type ExecutableResolver = (executableId: string) => TrustedExecutable | undefined;
export interface GovernedProcessToolHandlerOptions {
    readonly resolve: ExecutableResolver;
    readonly policy?: CommandPolicy;
    readonly defaultMaxOutputBytes?: number;
    /** Full environment allowlist to pass through from the host env. */
    readonly envPassthrough?: readonly string[];
}
export declare class GovernedProcessToolHandler {
    private readonly resolve;
    private readonly policy;
    private readonly defaultMaxOutputBytes;
    private readonly envPassthrough;
    constructor(options: GovernedProcessToolHandlerOptions);
    run(lease: WorkspaceAccess, input: GovernedProcessInput, signal?: AbortSignal): Promise<GovernedProcessOutput>;
    private buildEnv;
}
