import type {
  ActivityRecord, AuditEntry, CapabilitiesResponse, CapabilityDetail, Connector, ConnectorDetail, EventsResponse, ExplorerRow, HealthResponse,
  HubEvent, McpServer, Overview, Subscription,
} from "../types";

export const NOW = "2026-05-01T10:00:00.000Z";

export const STEPS = [
  "REGISTER", "INSPECT_CAPABILITIES", "DEFINE_PERMISSIONS", "DEFINE_RISK", "CONFIGURE_AUTH", "TEST_CONNECTION", "SECURITY_VALIDATION", "ENABLE",
];

export function makeConnector(over: Partial<Connector> = {}): Connector {
  return {
    connectorId: "github", provider: "GitHub", name: "GitHub", description: "Repositories and pull requests.", kind: "rest", family: "source-control",
    version: "1.2.0", providerApiVersion: "2022-11-28", status: "HEALTHY", trust: "LIMITED", mode: "SANDBOX", enabled: true,
    auth: { method: "token", scopes: ["repo:read"], credentialConfigured: true, connectedAt: NOW, expiresAt: null, oauthAvailable: false },
    config: { baseUrl: "https://api.github.com", environment: null, settings: {} },
    capabilities: { total: 4, available: 3, reads: 2, sideEffects: 1 },
    health: { status: "HEALTHY", checkedAt: NOW, latencyMs: 120, recentCalls: 10, recentErrors: 1, consecutiveFailures: 0, authenticated: true },
    events: ["push"], environments: ["PRODUCTION"], costClass: "FREE",
    installation: STEPS.map((step, i) => ({ step, status: i < 6 ? "DONE" : "PENDING" })),
    projects: ["p1"],
    lastActivity: { at: NOW, capability: "repository.read", outcome: "SUCCESS" },
    updatedAt: NOW,
    ...over,
  };
}

export function makeActivity(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: "act-1", at: NOW, requestId: "r1", capability: "repository.read", connectorId: "github", provider: "GitHub", projectId: "p1", agentId: "agent-1",
    operation: "READ", outcome: "SUCCESS", durationMs: 87, ...over,
  };
}

export function makeOverview(over: Partial<Overview> = {}): Overview {
  const connectors = [
    makeConnector(),
    makeConnector({
      connectorId: "wordpress", provider: "WordPress", name: "WordPress", description: "Site publishing.", status: "DISCOVERED", enabled: false, trust: "REVIEW_REQUIRED",
      auth: { method: "api_key", scopes: [], credentialConfigured: false, connectedAt: null, expiresAt: null, oauthAvailable: false },
      health: { status: "DISCOVERED", recentCalls: 0, recentErrors: 0, consecutiveFailures: 0, authenticated: false },
      lastActivity: null, projects: [], capabilities: { total: 3, available: 3, reads: 1, sideEffects: 2 },
    }),
    makeConnector({
      connectorId: "slack", provider: "Slack", name: "Slack", description: "Messaging.", status: "DEGRADED", mode: "LIVE", trust: "TRUSTED",
      health: {
        status: "DEGRADED", checkedAt: NOW, latencyMs: 900, recentCalls: 20, recentErrors: 6, consecutiveFailures: 2, authenticated: true,
        lastError: { kind: "RATE_LIMIT", message: "slow down", at: NOW },
      },
    }),
  ];
  return {
    summary: { connectors: 3, healthy: 1, degraded: 1, error: 0, disconnected: 1, disabled: 0, waitingApproval: 2, blocked24h: 4, queued: 5 },
    connectors,
    recentActivity: [makeActivity()],
    vault: { canStoreCredentials: true, note: "Credentials are encrypted at rest." },
    capabilities: { mcp: 1, webhooks: true, oauthProviders: 0 },
    generatedAt: NOW,
    ...over,
  };
}

export function makeCapabilityDetail(over: Partial<CapabilityDetail> = {}): CapabilityDetail {
  return {
    capability: "repository.read", description: "Read repository contents.", operation: "READ", risk: "LOW", version: 1, permissions: ["repo:read"],
    sandbox: "allowed", approval: "none", queueable: true, unavailable: null, params: [], ...over,
  };
}

export function makeDetail(over: Partial<ConnectorDetail> = {}): ConnectorDetail {
  const { events: _events, ...base } = makeConnector();
  void _events;
  return {
    ...base,
    capabilityList: [
      makeCapabilityDetail(),
      makeCapabilityDetail({ capability: "pull_request.merge", description: "Merge a pull request.", operation: "DEPLOY", risk: "HIGH", approval: "always", sandbox: "substitute with pull_request.draft", queueable: false }),
      makeCapabilityDetail({ capability: "repository.delete", description: "Delete a repository.", operation: "DELETE", risk: "CRITICAL", approval: "always", sandbox: "blocked", unavailable: "Not implemented in this deployment" }),
    ],
    mappings: [{ id: "map-1", projectId: "p1", connectorId: "github", resource: "acme/app", environment: "PRODUCTION", role: "PRIMARY", source: "user", status: "ACTIVE" }],
    credentials: [{ ref: "vault://github/primary", kind: "token", createdAt: NOW, updatedAt: NOW, expiresAt: null }],
    webhook: { configured: false, endpoint: "/api/integrations/webhooks/github" },
    activity: [makeActivity()],
    events: [],
    securityValidation: {
      ok: false,
      checks: [
        { check: "authentication", ok: true, detail: "a credential reference is configured" },
        { check: "scope breadth", ok: false, detail: "wildcard scope requested" },
      ],
    },
    ...over,
  };
}

export function makeRow(over: Partial<ExplorerRow> = {}): ExplorerRow {
  return {
    capability: "repository.read", description: "Read repository contents.", operation: "READ", risk: "LOW", connectorId: "github", provider: "GitHub",
    family: "source-control", permissions: ["repo:read"], sandbox: "ALLOW", status: "HEALTHY", mode: "SANDBOX", trust: "LIMITED", approval: "none", mappedToProject: null,
    ...over,
  };
}

export function makeCapabilities(over: Partial<CapabilitiesResponse> = {}): CapabilitiesResponse {
  return {
    capabilities: [
      makeRow(),
      makeRow({ capability: "repository.read", connectorId: "gitlab", provider: "GitLab", status: "ERROR" }),
      makeRow({ capability: "email.send", description: "Send an email.", operation: "SEND", risk: "HIGH", connectorId: "gmail", provider: "Gmail", family: "email", sandbox: { substitute: "email.draft" }, status: "DISCOVERED", approval: "always" }),
    ],
    mcp: [],
    ...over,
  };
}

export function makeEvent(over: Partial<HubEvent> = {}): HubEvent {
  return {
    id: "ev-row-1", eventId: "ev-1", provider: "GitHub", connectorId: "github", projectId: "p1", type: "repository.changed", providerEvent: "push",
    resource: "acme/app", deliveryId: "d-1", receivedAt: NOW, status: "TRIGGERED", summary: { branch: "main", commits: 3 }, triggered: ["sub-1"], ...over,
  };
}

export function makeSubscription(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-row-1", subscriptionId: "sub-1", name: "Review pushes", provider: "GitHub", eventType: "repository.changed", projectId: "p1",
    conditions: [{ field: "branch", equals: "main" }], action: { kind: "propose_run", request: "Review the latest push" }, enabled: true,
    createdBy: "alice", createdAt: NOW, fires: 2, ...over,
  };
}

export function makeEvents(over: Partial<EventsResponse> = {}): EventsResponse {
  return { events: [makeEvent()], subscriptions: [makeSubscription()], ...over };
}

export function makeHealth(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    connectors: [{ connectorId: "github", name: "GitHub", status: "HEALTHY", trust: "LIMITED", mode: "SANDBOX", enabled: true, health: makeConnector().health }],
    queue: [{ id: "q1", capability: "email.draft", connectorId: "gmail", projectId: "p1", status: "QUEUED", attempts: 2, nextAttemptAt: NOW, lastError: "timeout" }],
    generatedAt: NOW,
    ...over,
  };
}

export function makeMcpServer(over: Partial<McpServer> = {}): McpServer {
  return {
    serverId: "docs", name: "Docs server", provider: "MCP", version: "1", status: "PENDING_REVIEW", trust: "REVIEW_REQUIRED", risk: "MEDIUM", permissions: [],
    projects: ["p1"], config: { transport: "http", url: "https://mcp.example.test" }, tools: [{ name: "search", description: "Search docs" }], toolPolicies: {},
    health: { status: "DISCOVERED" }, registeredBy: "alice", updatedAt: NOW, ...over,
  };
}

export function makeAudit(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 7, at: NOW, operation: "credential.stored", actor: "alice", agentId: null, projectId: null, toolId: null, resource: "github", risk: "HIGH", result: "STORED",
    detail: { connectorId: "github", purpose: "primary" }, ...over,
  };
}
