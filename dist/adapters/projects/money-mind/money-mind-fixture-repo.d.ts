/**
 * Deterministic, in-memory `MoneyMindRepoPort`. Never touches disk, never
 * spawns a process — `runScript` returns a canned or synthesized result and
 * records the call so tests can assert exactly what would have run.
 *
 * The default fixture content below is SYNTHETIC test data written for this
 * repository. It is structurally analogous to a real Money Mind checkout
 * (a layered, feature-flagged status doc; a small doc set; a representative
 * source tree) so the adapter's parsing logic is exercised meaningfully, but
 * no file name, string, or value here is copied from the real Money Mind
 * project — see the Phase 6 ADR for the "no source copy" rationale.
 */
import { type MoneyMindScript } from "../../../contracts/index.js";
import type { MoneyMindRepoPort, MoneyMindRunResult } from "./money-mind-repo-port.js";
export interface MoneyMindFixtureOptions {
    /** relative path -> full text content. Defaults to `defaultMoneyMindFixtureFiles()`. */
    files?: Record<string, string>;
    /** package.json `scripts` map. Defaults to a project with no test/typecheck script. */
    scripts?: Record<string, string>;
    /** Canned `runScript` results, keyed by script name. Falls back to a synthesized success. */
    scriptResults?: Partial<Record<MoneyMindScript, MoneyMindRunResult>>;
}
/** A representative, invented (non-Money-Mind) documentation + source fixture. */
export declare function defaultMoneyMindFixtureFiles(): Record<string, string>;
export declare class InMemoryMoneyMindRepo implements MoneyMindRepoPort {
    private readonly files;
    private readonly scripts;
    private readonly scriptResults;
    /** Every `runScript` call, in order — tests assert exactly what was run. */
    readonly runCalls: MoneyMindScript[];
    constructor(options?: MoneyMindFixtureOptions);
    exists(relPath: string): Promise<boolean>;
    readTextFile(relPath: string): Promise<string>;
    listDirectory(relPath: string): Promise<readonly {
        name: string;
        type: "file" | "dir";
    }[]>;
    hasScript(script: MoneyMindScript): Promise<boolean>;
    runScript(script: MoneyMindScript, _timeoutMs: number): Promise<MoneyMindRunResult>;
}
