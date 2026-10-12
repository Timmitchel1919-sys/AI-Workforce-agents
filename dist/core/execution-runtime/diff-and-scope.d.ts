import { type FileChange, type ScopeReport } from "../../contracts/execution-runtime.js";
export declare function sha256(text: string | Uint8Array): string;
/**
 * A small unified-style line diff (LCS), bounded in size and secret-masked.
 * Good for review, not a patch format.
 */
export declare function unifiedDiff(before: string | undefined, after: string | undefined, label: string): string;
/**
 * Collapse a change history to its NET effect: a file changed and then restored
 * (or created and then deleted) leaves no net change and must not be flagged
 * or committed. Renames are kept as they are.
 */
export declare function netChanges(changes: readonly FileChange[]): FileChange[];
export interface ScopeInput {
    /** Files the Context Engine resolved as relevant to the task. */
    relevantFiles: readonly string[];
    /** Target/intent keywords (e.g. "login", "card"). */
    keywords: readonly string[];
}
/**
 * Compare what changed with what the task should touch. With no scope hints at
 * all every change is "unverifiable" and reported as such rather than waved
 * through.
 */
export declare function evaluateScope(changes: readonly FileChange[], input: ScopeInput): ScopeReport;
