export interface ConnectorCapability {
    id: string;
    name: string;
    description: string;
    type: 'read' | 'write' | 'execute';
    inputSchema: any;
    outputSchema: any;
}

export type ConnectorStatus = 'active' | 'inactive' | 'degraded' | 'error' | 'pending';

export interface ConnectorConfig {
    id: string;
    name: string;
    version: string;
    type: 'mcp' | 'api' | 'sdk' | 'cli' | 'webhook' | 'runner';
    endpoint?: string;
    authType: 'none' | 'oauth2' | 'apiKey' | 'mtls' | 'custom';
    metadata: Record<string, any>;
}

export interface Connector {
    getConfig(): ConnectorConfig;
    getStatus(): ConnectorStatus;
    getCapabilities(): Promise<ConnectorCapability[]>;
    initialize(credentials?: any): Promise<void>;
    shutdown(): Promise<void>;
    invokeCapability(capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
    checkHealth(): Promise<HealthStatus>;
}

export interface InvocationContext {
    userId: string;
    workspaceId: string;
    roles: string[];
    traceId: string;
    timestamp: number;
}

export interface InvocationResult {
    success: boolean;
    data?: any;
    error?: string;
    durationMs: number;
    metrics: Record<string, any>;
}

export interface HealthStatus {
    status: ConnectorStatus;
    latencyMs: number;
    lastChecked: number;
    details?: string;
}

export interface ConnectorRegistry {
    register(connector: Connector): Promise<void>;
    unregister(connectorId: string): Promise<void>;
    getConnector(connectorId: string): Promise<Connector | undefined>;
    listConnectors(filter?: Partial<ConnectorConfig>): Promise<Connector[]>;
    findCapableConnectors(capabilityQuery: string): Promise<Connector[]>;
}

export interface CredentialBroker {
    getCredentials(connectorId: string, context: InvocationContext): Promise<any>;
    storeCredentials(connectorId: string, credentials: any, context: InvocationContext): Promise<void>;
    revokeCredentials(connectorId: string, context: InvocationContext): Promise<void>;
}

export interface GovernancePolicy {
    canInvoke(connectorId: string, capabilityId: string, context: InvocationContext, input: any): Promise<boolean>;
}

export interface ResultValidator {
    validate(capabilityId: string, result: InvocationResult): Promise<boolean>;
}
