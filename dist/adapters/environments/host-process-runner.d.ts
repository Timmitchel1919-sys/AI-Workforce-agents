import type { ExecutionRunner, RunnerDescriptor, RunnerHeartbeat, RunnerJobSpec, RunnerRunOptions, RunnerRunResult, StructuredInvocation } from "../../contracts/index.js";
export interface HostProcessRunnerOptions {
    runnerId: string;
    adapterId: string;
    environmentInstanceIds: readonly string[];
    /** executableId → absolute path (trusted composition only). */
    executables: Readonly<Record<string, string>>;
    /** Stable host identity (e.g. the EO-2 host fingerprint). */
    identityFingerprint: string;
    capacity?: number;
}
export declare class HostProcessRunner implements ExecutionRunner {
    private readonly options;
    readonly descriptor: RunnerDescriptor;
    private readonly jobs;
    constructor(options: HostProcessRunnerOptions);
    heartbeat(): RunnerHeartbeat;
    healthCheck(): Promise<{
        ready: boolean;
        detail: string;
    }>;
    prepare(spec: RunnerJobSpec): Promise<void>;
    run(jobId: string, invocation: StructuredInvocation, options: RunnerRunOptions): Promise<RunnerRunResult>;
    cancel(jobId: string): Promise<void>;
    release(jobId: string): Promise<void>;
}
