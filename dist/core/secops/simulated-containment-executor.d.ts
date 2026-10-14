import type { ContainmentExecutionContext, ContainmentExecutor } from "./incident-response-service.js";
/**
 * Deterministic staging/test adapter. It records the intended operation but
 * never calls an external provider or mutates an agent/resource. Production
 * must inject a real authoritative adapter instead.
 */
export declare class SimulatedContainmentExecutor implements ContainmentExecutor {
    readonly simulatedOnly: true;
    private readonly executions;
    execute(context: ContainmentExecutionContext): Promise<Readonly<Record<string, unknown>>>;
    listExecutions(): readonly Readonly<Record<string, unknown>>[];
}
