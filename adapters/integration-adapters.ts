import { 
    Connector, 
    ConnectorCapability, 
    ConnectorConfig, 
    ConnectorStatus, 
    HealthStatus, 
    InvocationContext, 
    InvocationResult 
} from '../contracts/integration-hub.js';

export abstract class BaseAdapter implements Connector {
    protected status: ConnectorStatus = 'pending';
    
    constructor(protected config: ConnectorConfig) {}

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
            lastChecked: Date.now()
        };
    }

    abstract getCapabilities(): Promise<ConnectorCapability[]>;
    abstract initialize(credentials?: any): Promise<void>;
    abstract shutdown(): Promise<void>;
    abstract invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}

export class MCPAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig) {
        super({ ...config, type: 'mcp' });
    }

    async getCapabilities(): Promise<ConnectorCapability[]> {
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

    async initialize(credentials?: any): Promise<void> {
        this.status = 'active';
    }

    async shutdown(): Promise<void> {
        this.status = 'inactive';
    }

    async invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult> {
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
    constructor(config: ConnectorConfig) {
        super({ ...config, type: 'api' });
    }

    async getCapabilities(): Promise<ConnectorCapability[]> {
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

    async initialize(credentials?: any): Promise<void> {
        this.status = 'active';
    }

    async shutdown(): Promise<void> {
        this.status = 'inactive';
    }

    async invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult> {
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
    constructor(config: ConnectorConfig) {
        super({ ...config, type: 'cli' });
    }

    async getCapabilities(): Promise<ConnectorCapability[]> {
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

    async initialize(credentials?: any): Promise<void> {
        this.status = 'active';
    }

    async shutdown(): Promise<void> {
        this.status = 'inactive';
    }

    async invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult> {
        const start = Date.now();
        return {
            success: true,
            data: { output: `CLI executed ${capabilityId}` },
            durationMs: Date.now() - start,
            metrics: {}
        };
    }
}
