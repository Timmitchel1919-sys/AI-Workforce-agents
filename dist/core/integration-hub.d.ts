import { Connector, ConnectorConfig, ConnectorRegistry, CredentialBroker, InvocationContext, InvocationResult, GovernancePolicy, ResultValidator } from "../contracts/integration-hub.js";
export declare class DefaultConnectorRegistry implements ConnectorRegistry {
    private connectors;
    register(connector: Connector): Promise<void>;
    unregister(connectorId: string): Promise<void>;
    getConnector(connectorId: string): Promise<Connector | undefined>;
    listConnectors(filter?: Partial<ConnectorConfig>): Promise<Connector[]>;
    findCapableConnectors(capabilityQuery: string): Promise<Connector[]>;
}
export declare class DefaultCredentialBroker implements CredentialBroker {
    private store;
    private getKey;
    getCredentials(connectorId: string, context: InvocationContext): Promise<any>;
    storeCredentials(connectorId: string, credentials: any, context: InvocationContext): Promise<void>;
    revokeCredentials(connectorId: string, context: InvocationContext): Promise<void>;
}
import { ExecutionOrchestrator } from "./foundation/execution-chain.js";
import { AnalyticsTracker } from "./foundation/analytics-tracker.js";
import { DataQualityEngine } from "./foundation/data-quality.js";
export declare class ToolInvocationEngine {
    private registry;
    private credentialBroker;
    private governance;
    private validator;
    private orchestrator?;
    private analytics?;
    private dataQuality?;
    constructor(registry: ConnectorRegistry, credentialBroker: CredentialBroker, governance: GovernancePolicy, validator: ResultValidator, orchestrator?: ExecutionOrchestrator | undefined, analytics?: AnalyticsTracker | undefined, dataQuality?: DataQualityEngine | undefined);
    invoke(connectorId: string, capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult>;
    private trackOutcome;
    private errorResult;
}
