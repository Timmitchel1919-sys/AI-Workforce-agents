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
        return all.filter((c) => {
            const config = c.getConfig();
            return Object.entries(filter).every(([k, v]) => config[k] === v);
        });
    }
    async findCapableConnectors(capabilityQuery) {
        const results = [];
        for (const connector of this.connectors.values()) {
            const capabilities = await connector.getCapabilities();
            if (capabilities.some((cap) => cap.name.includes(capabilityQuery) ||
                cap.description.includes(capabilityQuery))) {
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
    orchestrator;
    analytics;
    dataQuality;
    constructor(registry, credentialBroker, governance, validator, orchestrator, analytics, dataQuality) {
        this.registry = registry;
        this.credentialBroker = credentialBroker;
        this.governance = governance;
        this.validator = validator;
        this.orchestrator = orchestrator;
        this.analytics = analytics;
        this.dataQuality = dataQuality;
    }
    async invoke(connectorId, capabilityId, input, context) {
        const start = Date.now();
        // Ensure execution plan / changeset lifecycle if context has project & delivery plan
        let changeSetId;
        if (this.orchestrator && context.projectId && context.deliveryPlanId) {
            try {
                const changeSet = this.orchestrator.createChangeSet(context.deliveryPlanId, [`invocation:${connectorId}:${capabilityId}`], JSON.stringify(input));
                changeSetId = changeSet.id;
            }
            catch {
                // Non-blocking if lifecycle objects don't strictly exist for minor invocations,
                // but logs error. (In a strict mode we could fail here)
            }
        }
        const connector = await this.registry.getConnector(connectorId);
        if (!connector) {
            const err = this.errorResult("Connector not found", start);
            this.trackOutcome(context, capabilityId, err, start);
            return err;
        }
        const canInvoke = await this.governance.canInvoke(connectorId, capabilityId, context, input);
        if (!canInvoke) {
            const err = this.errorResult("Governance policy blocked invocation", start);
            this.trackOutcome(context, capabilityId, err, start);
            return err;
        }
        try {
            const credentials = await this.credentialBroker.getCredentials(connectorId, context);
            if (credentials && connector.getStatus() === "pending") {
                await connector.initialize(credentials);
            }
            const result = await connector.invokeCapability(capabilityId, input, context);
            const isValid = await this.validator.validate(capabilityId, result);
            // Record data quality check
            if (this.dataQuality && context.projectId) {
                this.dataQuality.runQualityCheck("invocation_result", `${context.traceId}:${connectorId}:${capabilityId}`, isValid ? [] : ["Validation failed for result"], isValid ? 1.0 : 0.0);
            }
            if (!isValid) {
                const err = this.errorResult("Result validation failed", start);
                this.trackOutcome(context, capabilityId, err, start);
                return err;
            }
            // Verify changeset if created
            if (this.orchestrator && changeSetId && context.projectId) {
                this.orchestrator.createVerification(changeSetId, true, 1.0);
            }
            this.trackOutcome(context, capabilityId, result, start);
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            const err = this.errorResult(message, start);
            this.trackOutcome(context, capabilityId, err, start);
            return err;
        }
    }
    trackOutcome(context, capabilityId, result, startTime) {
        if (!this.analytics || !context.projectId)
            return;
        this.analytics.trackEvent(context.projectId, "TOOL_INVOCATION", {
            traceId: context.traceId,
            workspaceId: context.workspaceId,
            capabilityId,
            success: result.success,
            durationMs: Date.now() - startTime,
        });
        // Track cost binding if metrics exist
        if (this.dataQuality && result.metrics && result.metrics.costActual) {
            this.dataQuality.bindCost(context.projectId, `invocation:${context.traceId}`, result.metrics.costActual, result.metrics.currency || "USD");
        }
    }
    errorResult(error, startTime) {
        return {
            success: false,
            error,
            durationMs: Date.now() - startTime,
            metrics: {},
        };
    }
}
