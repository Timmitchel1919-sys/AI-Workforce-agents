import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { EventHub, } from "./events.js";
import { ToolGateway, } from "./gateway.js";
import { McpGateway } from "./mcp.js";
import { HubRegistry } from "./registry.js";
import { HealthMonitor, RateLimiter } from "./resilience.js";
import { CredentialVault, OAuthManager, } from "./vault.js";
export * from "./vault.js";
export * from "./rest.js";
export * from "./manifests.js";
export * from "./registry.js";
export * from "./resilience.js";
export * from "./gateway.js";
export * from "./events.js";
export * from "./mcp.js";
export function inMemoryIntegrationRepos() {
    const r = () => new InMemoryRepository();
    return {
        connectors: r(),
        mappings: r(),
        activity: r(),
        queue: r(),
        credentials: r(),
        oauthStates: r(),
        events: r(),
        subscriptions: r(),
        deliveries: r(),
        mcp: r(),
    };
}
export class IntegrationSystem {
    registry;
    vault;
    oauth;
    health;
    limiter;
    gateway;
    events;
    mcp;
    fetchImpl;
    now;
    constructor(o) {
        this.now = o.now ?? Date.now;
        const clock = () => new Date(this.now()).toISOString();
        this.fetchImpl = o.fetchImpl ?? globalThis.fetch;
        this.registry = new HubRegistry({ connectors: o.repos.connectors, mappings: o.repos.mappings }, clock, o.security.trust);
        this.vault = new CredentialVault(o.repos.credentials, clock, {
            ...(o.vaultKey ? { key: o.vaultKey } : {}),
            ...(o.env ? { env: o.env } : {}),
        });
        this.oauth = new OAuthManager(o.repos.oauthStates, this.vault, clock, this.fetchImpl, o.env ?? process.env);
        this.health = new HealthMonitor(this.registry, o.security.ledger, o.security.alerts, this.now);
        this.limiter = new RateLimiter(this.now, (id) => {
            const v = Number(this.registry.get(id)?.config.settings?.["ratePerMinute"]);
            return Number.isFinite(v) && v > 0 ? v : 60;
        });
        this.mcp = new McpGateway(o.repos.mcp, o.mcpTransport, clock);
        this.gateway = new ToolGateway({
            registry: this.registry,
            vault: this.vault,
            oauth: this.oauth,
            security: o.security,
            health: this.health,
            limiter: this.limiter,
            activity: o.repos.activity,
            queue: o.repos.queue,
            fetchImpl: this.fetchImpl,
            ...(o.sleep ? { sleep: o.sleep } : {}),
            now: this.now,
            ...(o.deployment ? { deployment: o.deployment } : {}),
            mcp: this.mcp,
            ...(o.recordUsage ? { recordUsage: o.recordUsage } : {}),
        });
        this.events = new EventHub({
            events: o.repos.events,
            subscriptions: o.repos.subscriptions,
            deliveries: o.repos.deliveries,
        }, this.registry, this.vault, o.security.ledger, o.security.alerts, o.trigger, this.now);
        this.registry.installAll("system");
    }
    /** GitHub mappings come from the project registry's declared repository — real configuration, never assumed. */
    syncProjectMappings(projects) {
        let n = 0;
        for (const p of projects) {
            const m = p.repositoryUrl
                ? /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(p.repositoryUrl)
                : null;
            if (!m)
                continue;
            const resource = `${m[1]}/${m[2]}`;
            if (this.registry
                .mappingFor(p.projectId, "github")
                .some((x) => x.resource === resource))
                continue;
            this.registry.map({
                projectId: p.projectId,
                connectorId: "github",
                resource,
                source: "project_registry",
                by: "project-registry",
            });
            n++;
        }
        return n;
    }
    /** What the Layer 5 runtime sees: discover and invoke, nothing else. */
    capabilityPort() {
        return {
            discover: (projectId) => this.gateway.discover(projectId).map((c) => ({
                capability: c.capability,
                description: c.description,
                operation: c.operation,
                risk: c.risk,
                approval: c.approval,
                available: c.available,
                ...(c.reason ? { reason: c.reason } : {}),
            })),
            invoke: async (r) => {
                const res = await this.gateway.invoke({
                    capability: r.capability,
                    projectId: r.projectId,
                    agentId: r.agentId,
                    ...(r.taskId ? { taskId: r.taskId } : {}),
                    ...(r.executionId ? { executionId: r.executionId } : {}),
                    ...(r.taskType ? { taskType: r.taskType } : {}),
                    ...(r.resource ? { resource: r.resource } : {}),
                    parameters: r.parameters,
                });
                return {
                    success: res.success,
                    ...(res.data !== undefined ? { data: res.data } : {}),
                    ...(res.error ? { error: res.error } : {}),
                    ...(res.connectorId ? { connectorId: res.connectorId } : {}),
                };
            },
        };
    }
}
