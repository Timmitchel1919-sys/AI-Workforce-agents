/**
 * Task Decomposer (Layer 4).
 *
 * Converts one validated request into the SMALLEST set of tasks that does the
 * job, with dependencies, gates and resource claims. The list is generated
 * from the request: a standard task that does not apply (no repository → no
 * commit; no deployment target → no deploy; low risk → no security gate) is
 * omitted and the omission is recorded in the plan notes — never silently.
 *
 * Safety shape is structural, not advisory: code-changing plans always route
 * through test and independent review before anything integrates or deploys,
 * and destructive work is isolated in its own approval-gated task.
 */
import type { OrchTask } from "../../contracts/execution-orchestration.js";
import type { IntentAnalysis, ResolvedContext } from "../../contracts/prompt-intelligence.js";
export interface DecomposeInput {
    runId: string;
    projectId: string;
    now: string;
    maxAttempts: number;
    intent: IntentAnalysis;
    context: ResolvedContext;
    promptText: string;
    acceptanceCriteria: readonly string[];
}
export declare function decompose(input: DecomposeInput): {
    tasks: OrchTask[];
    notes: string[];
};
