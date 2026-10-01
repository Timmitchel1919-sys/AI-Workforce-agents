import { Connector, ConnectorCapability, ConnectorConfig, ConnectorStatus, HealthStatus, InvocationContext, InvocationResult } from '../contracts/integration-hub.js';
import { ExecutionOrchestrator } from '../core/foundation/execution-chain.js';
import { AnalyticsTracker } from '../core/foundation/analytics-tracker.js';
import { DataQualityEngine } from '../core/foundation/data-quality.js';
export declare abstract class BaseAdapter implements Connector {
    protected config: ConnectorConfig;
    protected orchestrator?: ExecutionOrchestrator | undefined;
    protected analytics?: AnalyticsTracker | undefined;
    protected dataQuality?: DataQualityEngine | undefined;
    protected status: ConnectorStatus;
    constructor(config: ConnectorConfig, orchestrator?: ExecutionOrchestrator | undefined, analytics?: AnalyticsTracker | undefined, dataQuality?: DataQualityEngine | undefined);
    getConfig(): ConnectorConfig;
    getStatus(): ConnectorStatus;
    checkHealth(): Promise<HealthStatus>;
    protected trackExecution(capabilityId: string, input: any, context: InvocationContext, result: InvocationResult, start: number): void;
    abstract getCapabilities(): Promise<ConnectorCapability[]>;
    abstract initialize(credentials?: any): Promise<void>;
    abstract shutdown(): Promise<void>;
    abstract invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class MCPAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig, orchestrator?: ExecutionOrchestrator, analytics?: AnalyticsTracker, dataQuality?: DataQualityEngine);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class APIAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig, orchestrator?: ExecutionOrchestrator, analytics?: AnalyticsTracker, dataQuality?: DataQualityEngine);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
export declare class CLIAdapterImpl extends BaseAdapter {
    constructor(config: ConnectorConfig, orchestrator?: ExecutionOrchestrator, analytics?: AnalyticsTracker, dataQuality?: DataQualityEngine);
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
}
