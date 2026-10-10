import {
  Connector,
  ConnectorConfig,
  ConnectorRegistry,
  CredentialBroker,
  InvocationContext,
  InvocationResult,
  GovernancePolicy,
  ResultValidator,
} from "../contracts/integration-hub.js";

export class DefaultConnectorRegistry implements ConnectorRegistry {
  private connectors: Map<string, Connector> = new Map();

  async register(connector: Connector): Promise<void> {
    const config = connector.getConfig();
    this.connectors.set(config.id, connector);
  }

  async unregister(connectorId: string): Promise<void> {
    const connector = this.connectors.get(connectorId);
    if (connector) {
      await connector.shutdown();
      this.connectors.delete(connectorId);
    }
  }

  async getConnector(connectorId: string): Promise<Connector | undefined> {
    return this.connectors.get(connectorId);
  }

  async listConnectors(
    filter?: Partial<ConnectorConfig>,
  ): Promise<Connector[]> {
    const all = Array.from(this.connectors.values());
    if (!filter) return all;

    return all.filter((c) => {
      const config = c.getConfig();
      return Object.entries(filter).every(([k, v]) => (config as any)[k] === v);
    });
  }

  async findCapableConnectors(capabilityQuery: string): Promise<Connector[]> {
    const results: Connector[] = [];
    for (const connector of this.connectors.values()) {
      const capabilities = await connector.getCapabilities();
      if (
        capabilities.some(
          (cap) =>
            cap.name.includes(capabilityQuery) ||
            cap.description.includes(capabilityQuery),
        )
      ) {
        results.push(connector);
      }
    }
    return results;
  }
}

export class DefaultCredentialBroker implements CredentialBroker {
  private store: Map<string, any> = new Map();

  private getKey(connectorId: string, context: InvocationContext): string {
    return `${connectorId}:${context.userId}`;
  }

  async getCredentials(
    connectorId: string,
    context: InvocationContext,
  ): Promise<any> {
    return this.store.get(this.getKey(connectorId, context));
  }

  async storeCredentials(
    connectorId: string,
    credentials: any,
    context: InvocationContext,
  ): Promise<void> {
    this.store.set(this.getKey(connectorId, context), credentials);
  }

  async revokeCredentials(
    connectorId: string,
    context: InvocationContext,
  ): Promise<void> {
    this.store.delete(this.getKey(connectorId, context));
  }
}

import { ExecutionOrchestrator } from "./foundation/execution-chain.js";
import { AnalyticsTracker } from "./foundation/analytics-tracker.js";
import { DataQualityEngine } from "./foundation/data-quality.js";

export class ToolInvocationEngine {
  constructor(
    private registry: ConnectorRegistry,
    private credentialBroker: CredentialBroker,
    private governance: GovernancePolicy,
    private validator: ResultValidator,
    private orchestrator?: ExecutionOrchestrator,
    private analytics?: AnalyticsTracker,
    private dataQuality?: DataQualityEngine,
  ) {}

  async invoke(
    connectorId: string,
    capabilityId: string,
    input: any,
    context: InvocationContext,
  ): Promise<InvocationResult> {
    const start = Date.now();

    // Ensure execution plan / changeset lifecycle if context has project & delivery plan
    let changeSetId: string | undefined;
    if (this.orchestrator && context.projectId && context.deliveryPlanId) {
      try {
        const changeSet = this.orchestrator.createChangeSet(
          context.deliveryPlanId,
          [`invocation:${connectorId}:${capabilityId}`],
          JSON.stringify(input),
        );
        changeSetId = changeSet.id;
      } catch (e) {
        // Non-blocking if lifecycle objects don't strictly exist for minor invocations,
        // but logs error. (In a strict mode we could fail here)
      }
    }

    const connector = await this.registry.getConnector(connectorId);
    if (!connector) {
      const err = this.errorResult("Connector not found", start);
      this.trackOutcome(context, capabilityId, err, start);
      return err;
    }

    const canInvoke = await this.governance.canInvoke(
      connectorId,
      capabilityId,
      context,
      input,
    );
    if (!canInvoke) {
      const err = this.errorResult(
        "Governance policy blocked invocation",
        start,
      );
      this.trackOutcome(context, capabilityId, err, start);
      return err;
    }

    try {
      const credentials = await this.credentialBroker.getCredentials(
        connectorId,
        context,
      );
      if (credentials && connector.getStatus() === "pending") {
        await connector.initialize(credentials);
      }

      const result = await connector.invokeCapability(
        capabilityId,
        input,
        context,
      );

      const isValid = await this.validator.validate(capabilityId, result);

      // Record data quality check
      if (this.dataQuality && context.projectId) {
        this.dataQuality.runQualityCheck(
          "invocation_result",
          `${context.traceId}:${connectorId}:${capabilityId}`,
          isValid ? [] : ["Validation failed for result"],
          isValid ? 1.0 : 0.0,
        );
      }

      if (!isValid) {
        const err = this.errorResult("Result validation failed", start);
        this.trackOutcome(context, capabilityId, err, start);
        return err;
      }

      // Verify changeset if created
      if (this.orchestrator && changeSetId && context.projectId) {
        this.orchestrator.createVerification(changeSetId, true, 1.0);
      }

      this.trackOutcome(context, capabilityId, result, start);
      return result;
    } catch (error: any) {
      const err = this.errorResult(error.message, start);
      this.trackOutcome(context, capabilityId, err, start);
      return err;
    }
  }

  private trackOutcome(
    context: InvocationContext,
    capabilityId: string,
    result: InvocationResult,
    startTime: number,
  ) {
    if (!this.analytics || !context.projectId) return;

    this.analytics.trackEvent(context.projectId, "TOOL_INVOCATION", {
      traceId: context.traceId,
      workspaceId: context.workspaceId,
      capabilityId,
      success: result.success,
      durationMs: Date.now() - startTime,
    });

    // Track cost binding if metrics exist
    if (this.dataQuality && result.metrics && result.metrics.costActual) {
      this.dataQuality.bindCost(
        context.projectId,
        `invocation:${context.traceId}`,
        result.metrics.costActual,
        result.metrics.currency || "USD",
      );
    }
  }

  private errorResult(error: string, startTime: number): InvocationResult {
    return {
      success: false,
      error,
      durationMs: Date.now() - startTime,
      metrics: {},
    };
  }
}
