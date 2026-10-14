import type {
  ContainmentExecutionContext,
  ContainmentExecutor,
} from "./incident-response-service.js";

/**
 * Deterministic staging/test adapter. It records the intended operation but
 * never calls an external provider or mutates an agent/resource. Production
 * must inject a real authoritative adapter instead.
 */
export class SimulatedContainmentExecutor implements ContainmentExecutor {
  readonly simulatedOnly = true as const;
  private readonly executions: Readonly<Record<string, unknown>>[] = [];

  async execute(
    context: ContainmentExecutionContext,
  ): Promise<Readonly<Record<string, unknown>>> {
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

  listExecutions(): readonly Readonly<Record<string, unknown>>[] {
    return [...this.executions];
  }
}
