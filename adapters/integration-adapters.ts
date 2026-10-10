import {
  Connector,
  ConnectorCapability,
  ConnectorConfig,
  ConnectorStatus,
  HealthStatus,
  InvocationContext,
  InvocationResult,
} from "../contracts/integration-hub.js";
import { ExecutionOrchestrator } from "../core/foundation/execution-chain.js";
import { AnalyticsTracker } from "../core/foundation/analytics-tracker.js";
import { DataQualityEngine } from "../core/foundation/data-quality.js";

export abstract class BaseAdapter implements Connector {
  protected status: ConnectorStatus = "pending";

  constructor(
    protected config: ConnectorConfig,
    protected orchestrator?: ExecutionOrchestrator,
    protected analytics?: AnalyticsTracker,
    protected dataQuality?: DataQualityEngine,
  ) {}

  getConfig(): ConnectorConfig {
    return this.config;
  }

  getStatus(): ConnectorStatus {
    return this.status;
  }

  async checkHealth(): Promise<HealthStatus> {
    return {
      status: this.status,
      latencyMs: 10,
      lastChecked: Date.now(),
    };
  }

  protected trackExecution(
    capabilityId: string,
    input: any,
    context: InvocationContext,
    result: InvocationResult,
    start: number,
  ) {
    if (this.analytics && context.projectId) {
      this.analytics.trackEvent(context.projectId, "ADAPTER_INVOCATION", {
        traceId: context.traceId,
        adapterId: this.config.id,
        capabilityId,
        success: result.success,
        durationMs: Date.now() - start,
      });
    }

    if (
      this.dataQuality &&
      context.projectId &&
      result.metrics &&
      result.metrics.costActual
    ) {
      this.dataQuality.bindCost(
        context.projectId,
        `adapter:${context.traceId}`,
        result.metrics.costActual,
        result.metrics.currency || "USD",
      );
    }

    if (this.orchestrator && context.projectId && context.deliveryPlanId) {
      try {
        const changeSet = this.orchestrator.createChangeSet(
          context.deliveryPlanId,
          [`adapter:${this.config.id}:${capabilityId}`],
          JSON.stringify(input),
        );
        if (result.success) {
          this.orchestrator.createVerification(changeSet.id, true, 1.0);
        }
      } catch (e) {
        // Ignore if lifecycle objects don't strictly exist
      }
    }
  }

  abstract getCapabilities(): Promise<ConnectorCapability[]>;
  abstract initialize(credentials?: any): Promise<void>;
  abstract shutdown(): Promise<void>;
  abstract invokeCapability(
    capabilityId: string,
    input: any,
    context: InvocationContext,
  ): Promise<InvocationResult>;
}

export class MCPAdapterImpl extends BaseAdapter {
  constructor(
    config: ConnectorConfig,
    orchestrator?: ExecutionOrchestrator,
    analytics?: AnalyticsTracker,
    dataQuality?: DataQualityEngine,
  ) {
    super({ ...config, type: "mcp" }, orchestrator, analytics, dataQuality);
  }

  async getCapabilities(): Promise<ConnectorCapability[]> {
    return [
      {
        id: "mcp-tool-1",
        name: "Sample MCP Tool",
        description: "Executes an MCP tool",
        type: "execute",
        inputSchema: {},
        outputSchema: {},
      },
    ];
  }

  async initialize(credentials?: any): Promise<void> {
    this.status = "active";
  }

  async shutdown(): Promise<void> {
    this.status = "inactive";
  }

  async invokeCapability(
    capabilityId: string,
    input: any,
    context: InvocationContext,
  ): Promise<InvocationResult> {
    const start = Date.now();
    const result = {
      success: true,
      data: { message: `MCP executed ${capabilityId}` },
      durationMs: Date.now() - start,
      metrics: {},
    };
    this.trackExecution(capabilityId, input, context, result, start);
    return result;
  }
}

export class APIAdapterImpl extends BaseAdapter {
  constructor(
    config: ConnectorConfig,
    orchestrator?: ExecutionOrchestrator,
    analytics?: AnalyticsTracker,
    dataQuality?: DataQualityEngine,
  ) {
    super({ ...config, type: "api" }, orchestrator, analytics, dataQuality);
  }

  async getCapabilities(): Promise<ConnectorCapability[]> {
    return [
      {
        id: "api-call-1",
        name: "API Endpoint",
        description: "Calls a REST API endpoint",
        type: "read",
        inputSchema: {},
        outputSchema: {},
      },
    ];
  }

  async initialize(credentials?: any): Promise<void> {
    this.status = "active";
  }

  async shutdown(): Promise<void> {
    this.status = "inactive";
  }

  async invokeCapability(
    capabilityId: string,
    input: any,
    context: InvocationContext,
  ): Promise<InvocationResult> {
    const start = Date.now();
    const result = {
      success: true,
      data: { result: `API response for ${capabilityId}` },
      durationMs: Date.now() - start,
      metrics: {},
    };
    this.trackExecution(capabilityId, input, context, result, start);
    return result;
  }
}

export class CLIAdapterImpl extends BaseAdapter {
  constructor(
    config: ConnectorConfig,
    orchestrator?: ExecutionOrchestrator,
    analytics?: AnalyticsTracker,
    dataQuality?: DataQualityEngine,
  ) {
    super({ ...config, type: "cli" }, orchestrator, analytics, dataQuality);
  }

  async getCapabilities(): Promise<ConnectorCapability[]> {
    return [
      {
        id: "cli-cmd-1",
        name: "CLI Command",
        description: "Executes a CLI command",
        type: "execute",
        inputSchema: {},
        outputSchema: {},
      },
    ];
  }

  async initialize(credentials?: any): Promise<void> {
    this.status = "active";
  }

  async shutdown(): Promise<void> {
    this.status = "inactive";
  }

  async invokeCapability(
    capabilityId: string,
    input: any,
    context: InvocationContext,
  ): Promise<InvocationResult> {
    const start = Date.now();
    const result = {
      success: true,
      data: { output: `CLI executed ${capabilityId}` },
      durationMs: Date.now() - start,
      metrics: {},
    };
    this.trackExecution(capabilityId, input, context, result, start);
    return result;
  }
}
