export class BaseAdapter {
    config;
    orchestrator;
    analytics;
    dataQuality;
    status = "pending";
    constructor(config, orchestrator, analytics, dataQuality) {
        this.config = config;
        this.orchestrator = orchestrator;
        this.analytics = analytics;
        this.dataQuality = dataQuality;
    }
    getConfig() {
        return this.config;
    }
    getStatus() {
        return this.status;
    }
    async checkHealth() {
        return {
            status: this.status,
            latencyMs: 10,
            lastChecked: Date.now(),
        };
    }
    trackExecution(capabilityId, input, context, result, start) {
        if (this.analytics && context.projectId) {
            this.analytics.trackEvent(context.projectId, "ADAPTER_INVOCATION", {
                traceId: context.traceId,
                adapterId: this.config.id,
                capabilityId,
                success: result.success,
                durationMs: Date.now() - start,
            });
        }
        if (this.dataQuality &&
            context.projectId &&
            result.metrics &&
            result.metrics.costActual) {
            this.dataQuality.bindCost(context.projectId, `adapter:${context.traceId}`, result.metrics.costActual, result.metrics.currency || "USD");
        }
        if (this.orchestrator && context.projectId && context.deliveryPlanId) {
            try {
                const changeSet = this.orchestrator.createChangeSet(context.deliveryPlanId, [`adapter:${this.config.id}:${capabilityId}`], JSON.stringify(input));
                if (result.success) {
                    this.orchestrator.createVerification(changeSet.id, true, 1.0);
                }
            }
            catch {
                // Ignore if lifecycle objects don't strictly exist
            }
        }
    }
}
export class MCPAdapterImpl extends BaseAdapter {
    constructor(config, orchestrator, analytics, dataQuality) {
        super({ ...config, type: "mcp" }, orchestrator, analytics, dataQuality);
    }
    async getCapabilities() {
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
    async initialize(_credentials) {
        this.status = "active";
    }
    async shutdown() {
        this.status = "inactive";
    }
    async invokeCapability(capabilityId, input, context) {
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
    constructor(config, orchestrator, analytics, dataQuality) {
        super({ ...config, type: "api" }, orchestrator, analytics, dataQuality);
    }
    async getCapabilities() {
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
    async initialize(_credentials) {
        this.status = "active";
    }
    async shutdown() {
        this.status = "inactive";
    }
    async invokeCapability(capabilityId, input, context) {
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
    constructor(config, orchestrator, analytics, dataQuality) {
        super({ ...config, type: "cli" }, orchestrator, analytics, dataQuality);
    }
    async getCapabilities() {
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
    async initialize(_credentials) {
        this.status = "active";
    }
    async shutdown() {
        this.status = "inactive";
    }
    async invokeCapability(capabilityId, input, context) {
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
