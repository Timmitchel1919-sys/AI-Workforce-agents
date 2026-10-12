import type { GitState } from "../../contracts/execution-runtime.js";
export declare class GitError extends Error {
    constructor(message: string);
}
export interface GitOps {
    state(): Promise<GitState>;
    /** Stage exactly `files` and commit them. Returns the new HEAD sha. */
    commit(files: readonly string[], message: string, identity: {
        name: string;
        email: string;
    }): Promise<{
        sha: string;
    }>;
    /** Fast-forward push of HEAD to `branch` of the repository the workspace is bound to. */
    push(branch: string, expectedRepository: string): Promise<"pushed" | "up_to_date">;
}
export declare class LocalGitOps implements GitOps {
    private readonly cwd;
    private readonly timeoutMs;
    constructor(cwd: string, timeoutMs?: number);
    private run;
    state(): Promise<GitState>;
    /** Recent commits (read-only, fixed arguments) for knowledge ingestion. */
    log(limit: number): Promise<{
        sha: string;
        message: string;
        files: string[];
    }[]>;
    commit(files: readonly string[], message: string, identity: {
        name: string;
        email: string;
    }): Promise<{
        sha: string;
    }>;
    push(branch: string, expectedRepository: string): Promise<"pushed" | "up_to_date">;
}
