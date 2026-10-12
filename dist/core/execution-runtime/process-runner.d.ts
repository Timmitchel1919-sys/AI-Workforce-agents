import type { CommandSpec } from "../../contracts/execution-runtime.js";
export interface ProcessRequest {
    spec: CommandSpec;
    /** Workspace root (already validated by the resolver). */
    cwd: string;
    timeoutMs: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
    /** Called with masked chunks as they arrive (live output). */
    onChunk?: (chunk: string) => void;
}
export interface ProcessResult {
    exitCode?: number;
    timedOut: boolean;
    cancelled: boolean;
    /** Masked and bounded. */
    output: string;
    truncated: boolean;
    durationMs: number;
}
/** Port: any environment (local, Docker, cloud runner …) can implement it. */
export interface ProcessRunner {
    readonly id: string;
    run(request: ProcessRequest): Promise<ProcessResult>;
}
/** A minimal environment: no credential-bearing variable ever reaches a child. */
export declare function sanitizedEnv(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare class LocalProcessRunner implements ProcessRunner {
    readonly id = "local-process";
    run(request: ProcessRequest): Promise<ProcessResult>;
}
