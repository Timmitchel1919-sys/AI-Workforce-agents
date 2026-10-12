/**
 * Integration Hub & Tool Gateway — composition.
 *
 * `IntegrationSystem` wires registry, vault/OAuth, health, rate limiting, the gateway, the
 * event hub and the MCP gateway over the platform repositories and the Layer 7 security
 * system. The runtime reaches it only through the narrow `CapabilityPort`.
 */
import type { UsageDraft } from "../../contracts/cost-center.js";
import type { ActivityRecord, EventSubscription, HubConnector, HubEvent, McpServerRecord, ProjectIntegrationMapping } from "../../contracts/integration-gateway.js";
import type { Repository } from "../../contracts/persistence.js";
import type { CapabilityPort } from "../execution-runtime/tools.js";
import type { SecuritySystem } from "../security-governance/index.js";
import { EventHub, type EventTrigger, type HubWebhookDelivery } from "./events.js";
import { ToolGateway, type DeploymentExecutor, type QueuedRequest } from "./gateway.js";
import { McpGateway, type McpTransport } from "./mcp.js";
import { HubRegistry } from "./registry.js";
import { HealthMonitor, RateLimiter } from "./resilience.js";
import type { FetchLike } from "./rest.js";
import { CredentialVault, OAuthManager, type OAuthStateRecord, type StoredCredential } from "./vault.js";
export * from "./vault.js";
export * from "./rest.js";
export * from "./manifests.js";
export * from "./registry.js";
export * from "./resilience.js";
export * from "./gateway.js";
export * from "./events.js";
export * from "./mcp.js";
export interface IntegrationRepos {
    connectors: Repository<HubConnector>;
    mappings: Repository<ProjectIntegrationMapping>;
    activity: Repository<ActivityRecord>;
    queue: Repository<QueuedRequest>;
    credentials: Repository<StoredCredential>;
    oauthStates: Repository<OAuthStateRecord>;
    events: Repository<HubEvent>;
    subscriptions: Repository<EventSubscription>;
    deliveries: Repository<HubWebhookDelivery>;
    mcp: Repository<McpServerRecord>;
}
export declare function inMemoryIntegrationRepos(): IntegrationRepos;
export interface IntegrationSystemOptions {
    repos: IntegrationRepos;
    security: SecuritySystem;
    fetchImpl?: FetchLike;
    vaultKey?: string;
    env?: NodeJS.ProcessEnv;
    deployment?: DeploymentExecutor;
    mcpTransport?: McpTransport;
    trigger?: EventTrigger;
    recordUsage?: (draft: UsageDraft) => void;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
export declare class IntegrationSystem {
    readonly registry: HubRegistry;
    readonly vault: CredentialVault;
    readonly oauth: OAuthManager;
    readonly health: HealthMonitor;
    readonly limiter: RateLimiter;
    readonly gateway: ToolGateway;
    readonly events: EventHub;
    readonly mcp: McpGateway;
    readonly fetchImpl: FetchLike;
    private readonly now;
    constructor(o: IntegrationSystemOptions);
    /** GitHub mappings come from the project registry's declared repository — real configuration, never assumed. */
    syncProjectMappings(projects: {
        projectId: string;
        repositoryUrl?: string;
    }[]): number;
    /** What the Layer 5 runtime sees: discover and invoke, nothing else. */
    capabilityPort(): CapabilityPort;
}
