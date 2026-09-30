export class DefaultConnectorRegistry {
    connectors = new Map();
    async register(connector) {
        const config = connector.getConfig();
        this.connectors.set(config.id, connector);
    }
    async unregister(connectorId) {
        const connector = this.connectors.get(connectorId);
        if (connector) {
            await connector.shutdown();
            this.connectors.delete(connectorId);
        }
    }
    async getConnector(connectorId) {
        return this.connectors.get(connectorId);
    }
    async listConnectors(filter) {
        const all = Array.from(this.connectors.values());
        if (!filter)
            return all;
        return all.filter(c => {
            const config = c.getConfig();
            return Object.entries(filter).every(([k, v]) => config[k] === v);
        });
    }
    async findCapableConnectors(capabilityQuery) {
        const results = [];
        for (const connector of this.connectors.values()) {
            const capabilities = await connector.getCapabilities();
            if (capabilities.some(cap => cap.name.includes(capabilityQuery) || cap.description.includes(capabilityQuery))) {
                results.push(connector);
            }
        }
        return results;
    }
}
export class DefaultCredentialBroker {
    store = new Map();
    getKey(connectorId, context) {
        return `${connectorId}:${context.userId}`;
    }
    async getCredentials(connectorId, context) {
        return this.store.get(this.getKey(connectorId, context));
    }
    async storeCredentials(connectorId, credentials, context) {
        this.store.set(this.getKey(connectorId, context), credentials);
    }
    async revokeCredentials(connectorId, context) {
        this.store.delete(this.getKey(connectorId, context));
    }
}
export class ToolInvocationEngine {
    registry;
    credentialBroker;
    governance;
    validator;
    constructor(registry, credentialBroker, governance, validator) {
        this.registry = registry;
        this.credentialBroker = credentialBroker;
        this.governance = governance;
        this.validator = validator;
    }
    async invoke(connectorId, capabilityId, input, context) {
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
        }
        catch (error) {
            return this.errorResult(error.message, start);
        }
    }
    errorResult(error, startTime) {
        return {
            success: false,
            error,
            durationMs: Date.now() - startTime,
            metrics: {}
        };
    }
}
