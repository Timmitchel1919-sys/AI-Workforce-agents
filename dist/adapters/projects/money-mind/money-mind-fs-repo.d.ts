import { type MoneyMindScript } from "../../../contracts/index.js";
import type { MoneyMindRepoPort, MoneyMindRunResult } from "./money-mind-repo-port.js";
export interface MoneyMindFsRepoOptions {
    /** Absolute path to a local Money Mind checkout. */
    repoPath: string;
    /** Per-call cap on bytes read from a single file. Default 256 KiB. */
    maxFileBytes?: number;
}
export declare class NodeMoneyMindRepo implements MoneyMindRepoPort {
    private readonly repoRoot;
    private readonly maxFileBytes;
    constructor(options: MoneyMindFsRepoOptions);
    /** Resolve a validated relative path to an absolute path, re-checking containment. */
    private resolveAbsolute;
    private ensureRepoPresent;
    /** Never throws — a boolean probe, including when the repo root itself is absent. */
    exists(relPath: string): Promise<boolean>;
    readTextFile(relPath: string): Promise<string>;
    listDirectory(relPath: string): Promise<readonly {
        name: string;
        type: "file" | "dir";
    }[]>;
    hasScript(script: MoneyMindScript): Promise<boolean>;
    runScript(script: MoneyMindScript, timeoutMs: number): Promise<MoneyMindRunResult>;
}
