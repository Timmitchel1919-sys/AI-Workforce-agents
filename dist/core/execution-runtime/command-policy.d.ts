/**
 * Command policy (Layer 5).
 *
 * There is NO shell. A command is classified from its text and, only if it is
 * on the allow-list, reduced to a structured `CommandSpec` that the process
 * runner turns into a fixed argument vector. Everything else is refused:
 *
 *   SAFE             build / test / lint / typecheck scripts, read-only git
 *   REVIEW_REQUIRED  installs, arbitrary npm scripts, commit/push, deploy —
 *                    never run from the agent surface; governed paths only
 *   BLOCKED          destructive, credential-exposing, arbitrary-code commands
 */
import type { CommandClassification, CommandSpec } from "../../contracts/execution-runtime.js";
export interface ClassifyOptions {
    /** npm scripts the workspace actually declares (unknown scripts are refused). */
    scripts?: readonly string[];
}
export declare function classifyCommand(line: unknown, options?: ClassifyOptions): CommandClassification;
export declare function displayOf(spec: CommandSpec): string;
/** Timeout by command kind (milliseconds). */
export declare function timeoutFor(spec: CommandSpec): number;
