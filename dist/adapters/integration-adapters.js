export class BaseAdapter {
    config;
    status = 'pending';
    constructor(config) {
        this.config = config;
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
            lastChecked: Date.now()
        };
    }
}
export class MCPAdapterImpl extends BaseAdapter {
    constructor(config) {
        super({ ...config, type: 'mcp' });
    }
    async getCapabilities() {
        return [
            {
                id: 'mcp-tool-1',
                name: 'Sample MCP Tool',
                description: 'Executes an MCP tool',
                type: 'execute',
                inputSchema: {},
                outputSchema: {}
            }
        ];
    }
    async initialize(credentials) {
        this.status = 'active';
    }
    async shutdown() {
        this.status = 'inactive';
    }
    async invokeCapability(capabilityId, input, context) {
        const start = Date.now();
        return {
            success: true,
            data: { message: `MCP executed ${capabilityId}` },
            durationMs: Date.now() - start,
            metrics: {}
        };
    }
}
export class APIAdapterImpl extends BaseAdapter {
    constructor(config) {
        super({ ...config, type: 'api' });
    }
    async getCapabilities() {
        return [
            {
                id: 'api-call-1',
                name: 'API Endpoint',
                description: 'Calls a REST API endpoint',
                type: 'read',
                inputSchema: {},
                outputSchema: {}
            }
        ];
    }
    async initialize(credentials) {
        this.status = 'active';
    }
    async shutdown() {
        this.status = 'inactive';
    }
    async invokeCapability(capabilityId, input, context) {
        const start = Date.now();
        return {
            success: true,
            data: { result: `API response for ${capabilityId}` },
            durationMs: Date.now() - start,
            metrics: {}
        };
    }
}
export class CLIAdapterImpl extends BaseAdapter {
    constructor(config) {
        super({ ...config, type: 'cli' });
    }
    async getCapabilities() {
        return [
            {
                id: 'cli-cmd-1',
                name: 'CLI Command',
                description: 'Executes a CLI command',
                type: 'execute',
                inputSchema: {},
                outputSchema: {}
            }
        ];
    }
    async initialize(credentials) {
        this.status = 'active';
    }
    async shutdown() {
        this.status = 'inactive';
    }
    async invokeCapability(capabilityId, input, context) {
        const start = Date.now();
        return {
            success: true,
            data: { output: `CLI executed ${capabilityId}` },
            durationMs: Date.now() - start,
            metrics: {}
        };
    }
}
