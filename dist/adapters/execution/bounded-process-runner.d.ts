import { type BoundedOutput } from "../../contracts/index.js";
export interface TrustedExecutable {
    executableId: string;
    /** Absolute path, resolved by trusted composition. */
    path: string;
}
export interface BoundedProcessSpec {
    executable: TrustedExecutable;
    argv: readonly string[];
    cwd: string;
    /** The child's ENTIRE environment. */
    env: Readonly<Record<string, string>>;
    timeoutMs: number;
    maxOutputBytes: number;
    signal: AbortSignal;
    knownSecrets?: readonly string[];
}
export interface BoundedProcessResult {
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    stdout: BoundedOutput;
    stderr: BoundedOutput;
    durationMs: number;
    redactions: number;
}
export declare function validateBoundedProcessSpec(spec: BoundedProcessSpec): void;
export declare function runBoundedProcess(spec: BoundedProcessSpec): Promise<BoundedProcessResult>;
