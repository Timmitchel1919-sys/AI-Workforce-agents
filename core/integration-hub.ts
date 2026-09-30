import { 
    Connector, 
    ConnectorConfig, 
    ConnectorRegistry, 
    CredentialBroker, 
    InvocationContext, 
    InvocationResult, 
    GovernancePolicy,
    ResultValidator
} from '../contracts/integration-hub.js';

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

    async listConnectors(filter?: Partial<ConnectorConfig>): Promise<Connector[]> {
        const all = Array.from(this.connectors.values());
        if (!filter) return all;
        
        return all.filter(c => {
            const config = c.getConfig();
            return Object.entries(filter).every(([k, v]) => (config as any)[k] === v);
        });
    }

    async findCapableConnectors(capabilityQuery: string): Promise<Connector[]> {
        const results: Connector[] = [];
        for (const connector of this.connectors.values()) {
            const capabilities = await connector.getCapabilities();
            if (capabilities.some(cap => cap.name.includes(capabilityQuery) || cap.description.includes(capabilityQuery))) {
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

    async getCredentials(connectorId: string, context: InvocationContext): Promise<any> {
        return this.store.get(this.getKey(connectorId, context));
    }

    async storeCredentials(connectorId: string, credentials: any, context: InvocationContext): Promise<void> {
        this.store.set(this.getKey(connectorId, context), credentials);
    }

    async revokeCredentials(connectorId: string, context: InvocationContext): Promise<void> {
        this.store.delete(this.getKey(connectorId, context));
    }
}

export class ToolInvocationEngine {
    constructor(
        private registry: ConnectorRegistry,
        private credentialBroker: CredentialBroker,
        private governance: GovernancePolicy,
        private validator: ResultValidator
    ) {}

    async invoke(connectorId: string, capabilityId: string, input: any, context: InvocationContext): Promise<InvocationResult> {
        const start = Date.now();
        
        const connector = await this.registry.getConnector(connectorId);
        if (!connector) {
            return this.errorResult('Connector not found', start);
        }

        const canInvoke = await this.governance.canInvoke(connectorId, capabilityId, context, input);
        if (!canInvoke) {
            return this.errorResult('Governance policy blocked invocation', start);
        }

        try {
            const credentials = await this.credentialBroker.getCredentials(connectorId, context);
            if (credentials && connector.getStatus() === 'pending') {
                await connector.initialize(credentials);
            }

            const result = await connector.invokeCapability(capabilityId, input, context);
            
            const isValid = await this.validator.validate(capabilityId, result);
            if (!isValid) {
                return this.errorResult('Result validation failed', start);
            }

            return result;
        } catch (error: any) {
            return this.errorResult(error.message, start);
        }
    }

    private errorResult(error: string, startTime: number): InvocationResult {
        return {
            success: false,
            error,
            durationMs: Date.now() - startTime,
            metrics: {}
        };
    }
}
