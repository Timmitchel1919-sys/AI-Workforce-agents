/**
 * Deterministic staging/test adapter. It records the intended operation but
 * never calls an external provider or mutates an agent/resource. Production
 * must inject a real authoritative adapter instead.
 */
export class SimulatedContainmentExecutor {
    simulatedOnly = true;
    executions = [];
    async execute(context) {
        const result = Object.freeze({
            simulatedOnly: true,
            subsystem: "simulated_resource",
            action: "contain",
            incidentId: context.incident.incidentId,
            targetResourceType: context.request.targetResourceType,
            targetResourceId: context.request.targetResourceId,
            executedBy: context.principal.id,
        });
        this.executions.push(result);
        return result;
    }
    listExecutions() {
        return [...this.executions];
    }
}
