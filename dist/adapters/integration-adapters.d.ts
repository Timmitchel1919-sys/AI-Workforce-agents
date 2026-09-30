import { Connector, ConnectorCapability, ConnectorConfig, ConnectorStatus, HealthStatus, InvocationContext, InvocationResult } from '../contracts/integration-hub.js';
export declare abstract class BaseAdapter implements Connector {
    protected config: ConnectorConfig;
    protected status: ConnectorStatus;
    constructor(config: ConnectorConfig);
    getConfig(): ConnectorConfig;
    getStatus(): ConnectorStatus;
    checkHealth(): Promise<HealthStatus>;
    abstract getCapabilities(): Promise<ConnectorCapability[]>;
    abstract initialize(credentials?: any): Promise<void>;
    abstract shutdown(): Promise<void>;
    abstract invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class MCPAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class APIAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class CLIAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
