/**
 * Integration Hub & Tool Gateway — composition.
 *
 * `IntegrationSystem` wires registry, vault/OAuth, health, rate limiting, the gateway, the
 * event hub and the MCP gateway over the platform repositories and the Layer 7 security
 * system. The runtime reaches it only through the narrow `CapabilityPort`.
 */
import type { UsageDraft } from "../../contracts/cost-center.js";
import type {
  ActivityRecord,
  EventSubscription,
  HubConnector,
  HubEvent,
  McpServerRecord,
  ProjectIntegrationMapping,
} from "../../contracts/integration-gateway.js";
import type { Repository } from "../../contracts/persistence.js";
import type { CapabilityPort } from "../execution-runtime/tools.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { SecuritySystem } from "../security-governance/index.js";
import {
  EventHub,
  type EventTrigger,
  type HubWebhookDelivery,
} from "./events.js";
import {
  ToolGateway,
  type DeploymentExecutor,
  type QueuedRequest,
} from "./gateway.js";
import { McpGateway, type McpTransport } from "./mcp.js";
import { HubRegistry } from "./registry.js";
import { HealthMonitor, RateLimiter } from "./resilience.js";
import type { FetchLike } from "./rest.js";
import {
  CredentialVault,
  OAuthManager,
  type OAuthStateRecord,
  type StoredCredential,
} from "./vault.js";

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

export function inMemoryIntegrationRepos(): IntegrationRepos {
  const r = <T extends { id: string }>() =>
    new InMemoryRepository<T>() as Repository<T>;
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

export class IntegrationSystem {
  readonly registry: HubRegistry;
  readonly vault: CredentialVault;
  readonly oauth: OAuthManager;
  readonly health: HealthMonitor;
  readonly limiter: RateLimiter;
  readonly gateway: ToolGateway;
  readonly events: EventHub;
  readonly mcp: McpGateway;
  readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(o: IntegrationSystemOptions) {
    this.now = o.now ?? Date.now;
    const clock = () => new Date(this.now()).toISOString();
    this.fetchImpl = o.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.registry = new HubRegistry(
      { connectors: o.repos.connectors, mappings: o.repos.mappings },
      clock,
      o.security.trust,
    );
    this.vault = new CredentialVault(o.repos.credentials, clock, {
      ...(o.vaultKey ? { key: o.vaultKey } : {}),
      ...(o.env ? { env: o.env } : {}),
    });
    this.oauth = new OAuthManager(
      o.repos.oauthStates,
      this.vault,
      clock,
      this.fetchImpl,
      o.env ?? process.env,
    );
    this.health = new HealthMonitor(
      this.registry,
      o.security.ledger,
      o.security.alerts,
      this.now,
    );
    this.limiter = new RateLimiter(this.now, (id) => {
      const v = Number(
        this.registry.get(id)?.config.settings?.["ratePerMinute"],
      );
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
    this.events = new EventHub(
      {
        events: o.repos.events,
        subscriptions: o.repos.subscriptions,
        deliveries: o.repos.deliveries,
      },
      this.registry,
      this.vault,
      o.security.ledger,
      o.security.alerts,
      o.trigger,
      this.now,
    );
    this.registry.installAll("system");
  }

  /** GitHub mappings come from the project registry's declared repository — real configuration, never assumed. */
  syncProjectMappings(
    projects: { projectId: string; repositoryUrl?: string }[],
  ): number {
    let n = 0;
    for (const p of projects) {
      const m = p.repositoryUrl
        ? /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
            p.repositoryUrl,
          )
        : null;
      if (!m) continue;
      const resource = `${m[1]}/${m[2]}`;
      if (
        this.registry
          .mappingFor(p.projectId, "github")
          .some((x) => x.resource === resource)
      )
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
  capabilityPort(): CapabilityPort {
    return {
      discover: (projectId) =>
        this.gateway.discover(projectId).map((c) => ({
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
