/** Wire shapes of the Control Plane `/api/integration-center/*` surface (control/services/integration-control-service.ts). */

export const MANAGE_CAPABILITY = "manage_integrations";

export const TABS = ["overview", "tools", "events", "log"] as const;
export type IntegrationTab = (typeof TABS)[number];

export const OPERATION_CLASSES = ["READ", "DRAFT", "WRITE", "PUBLISH", "SEND", "DEPLOY", "DELETE"] as const;
export const TRUST_STATES = ["TRUSTED", "LIMITED", "REVIEW_REQUIRED", "SUSPENDED", "DISABLED"] as const;
/** Higher is more trusted; raising trust is administrator-only on the server. */
export const TRUST_RANK: Record<string, number> = { DISABLED: 0, SUSPENDED: 0, REVIEW_REQUIRED: 1, LIMITED: 2, TRUSTED: 3 };
export const ENVIRONMENTS = ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"] as const;
export const CONNECTOR_MODES = ["SANDBOX", "LIVE"] as const;
export const CREDENTIAL_KINDS = ["api_key", "token", "basic"] as const;
export const MAPPING_ROLES = ["PRIMARY", "FALLBACK"] as const;
export const EVENT_STATUSES = ["RECEIVED", "IGNORED", "TRIGGERED", "REJECTED", "FAILED"] as const;
export const ACTIVITY_OUTCOMES = ["SUCCESS", "FAILED", "DENIED", "WAITING_APPROVAL", "BLOCKED", "QUEUED", "SIMULATED"] as const;
export const MCP_STATUSES = ["ENABLED", "DISABLED", "PENDING_REVIEW"] as const;

export const INTEGRATION_COMMANDS = [
  "integration_configure", "integration_store_credential", "integration_revoke_credential", "integration_oauth_begin",
  "integration_oauth_complete", "integration_test_connection", "integration_validate_security", "integration_enable",
  "integration_disable", "integration_disconnect", "integration_set_mode", "integration_set_trust", "integration_upgrade",
  "integration_map_project", "integration_unmap_project", "integration_register_mcp", "integration_set_mcp_status",
  "integration_discover_mcp", "integration_create_subscription", "integration_set_subscription", "integration_drain_queue",
  "integration_simulate",
] as const;
export type IntegrationCommandName = (typeof INTEGRATION_COMMANDS)[number];

export interface HealthSnapshot {
  status: string;
  checkedAt?: string;
  latencyMs?: number;
  recentCalls: number;
  recentErrors: number;
  consecutiveFailures: number;
  lastError?: { kind: string; message: string; at: string };
  rateLimit?: { remaining?: number; limit?: number; resetAt?: string };
  authenticated: boolean;
}

export interface InstallStep {
  step: string;
  status: string;
  at?: string;
  note?: string;
}

export interface CapabilityCounts { total: number; available: number; reads: number; sideEffects: number }

export interface Connector {
  connectorId: string;
  provider: string;
  name: string;
  description: string;
  kind: string;
  family: string;
  version: string;
  providerApiVersion: string;
  status: string;
  trust: string;
  mode: string;
  enabled: boolean;
  auth: {
    method: string;
    scopes: string[];
    credentialConfigured: boolean;
    connectedAt: string | null;
    expiresAt: string | null;
    oauthAvailable: boolean;
  };
  config: { baseUrl: string | null; environment: string | null; settings: Record<string, string> };
  capabilities: CapabilityCounts;
  health: HealthSnapshot;
  events: string[];
  environments: string[];
  costClass: string;
  installation: InstallStep[];
  projects: string[];
  lastActivity: { at: string; capability: string; outcome: string } | null;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  at: string;
  requestId: string;
  capability: string;
  connectorId?: string;
  provider?: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  operation?: string;
  resource?: string;
  outcome: string;
  errorKind?: string;
  durationMs?: number;
  risk?: string;
  approvalId?: string;
  detail?: string;
}

export interface Overview {
  summary: {
    connectors: number; healthy: number; degraded: number; error: number; disconnected: number; disabled: number;
    waitingApproval: number; blocked24h: number; queued: number;
  };
  connectors: Connector[];
  recentActivity: ActivityRecord[];
  vault: { canStoreCredentials: boolean; note: string };
  capabilities: { mcp: number; webhooks: boolean; oauthProviders: number };
  generatedAt: string;
}

export interface CapabilityDetail {
  capability: string;
  description: string;
  operation: string;
  risk: string;
  version: number;
  permissions: string[];
  /** Server text: "allowed", "blocked" or "substitute with <capability>". */
  sandbox: string;
  approval: string;
  queueable: boolean;
  unavailable: string | null;
  params: { name: string; type: string; required?: boolean; max?: number; description?: string }[];
}

export interface Mapping {
  id: string;
  projectId: string;
  connectorId: string;
  resource: string;
  environment?: string;
  role: string;
  source: string;
  status: string;
}

export interface CredentialMeta { ref: string; kind: string; createdAt: string; updatedAt: string; expiresAt?: string | null; connectorId?: string }

export interface SecurityCheck { check: string; ok: boolean; detail: string }

export interface HubEvent {
  id: string;
  eventId: string;
  provider: string;
  connectorId: string;
  projectId?: string;
  type: string;
  providerEvent: string;
  resource?: string;
  deliveryId: string;
  receivedAt: string;
  status: string;
  reason?: string;
  summary: Record<string, string | number | boolean>;
  triggered: string[];
}

/** In the detail view `events` is the connector's recent received events (the supported-event list is not returned). */
export interface ConnectorDetail extends Omit<Connector, "events"> {
  capabilityList: CapabilityDetail[];
  mappings: Mapping[];
  credentials: CredentialMeta[];
  webhook: { configured: boolean; endpoint: string };
  activity: ActivityRecord[];
  events: HubEvent[];
  securityValidation: { ok: boolean; checks: SecurityCheck[] };
}

export interface ExplorerRow {
  capability: string;
  description: string;
  operation: string;
  risk: string;
  connectorId: string;
  provider: string;
  family: string;
  unavailable?: string;
  permissions: string[];
  sandbox: unknown;
  status: string;
  mode: string;
  trust: string;
  approval: string;
  mappedToProject: boolean | null;
}

export interface McpCapabilityRow {
  capability: string;
  description: string;
  operation: string;
  risk: string;
  providers: { connectorId: string; provider: string; status: string; mode: string; trust: string; resource: string; role: string }[];
  approval: string;
  available: boolean;
}

export interface CapabilitiesResponse { capabilities: ExplorerRow[]; mcp: McpCapabilityRow[] }

export interface Subscription {
  id: string;
  subscriptionId: string;
  name: string;
  provider: string;
  eventType: string;
  projectId: string;
  resourcePattern?: string;
  conditions: { field: string; equals: string | number | boolean }[];
  action: { kind: string; request: string };
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastFiredAt?: string;
  fires: number;
}

export interface EventsResponse { events: HubEvent[]; subscriptions: Subscription[] }

export interface EventFilters { provider: string; type: string; status: string; since: string }
export interface ActivityFilters { connectorId: string; outcome: string }

export interface QueueItem {
  id: string;
  capability: string;
  connectorId: string;
  projectId: string;
  status: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError: string | null;
}

export interface HealthResponse {
  connectors: { connectorId: string; name: string; status: string; trust: string; mode: string; enabled: boolean; health: HealthSnapshot }[];
  queue: QueueItem[];
  generatedAt: string;
}

export interface McpServer {
  id?: string;
  serverId: string;
  name: string;
  provider: string;
  version: string;
  status: string;
  trust: string;
  risk: string;
  permissions: string[];
  projects: string[];
  config: { transport: string; url: string | null };
  tools: { name: string; description: string }[];
  toolPolicies: Record<string, { operation: string; risk?: string }>;
  health: { status: string; checkedAt?: string; error?: string };
  registeredBy: string;
  updatedAt: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  operation: string;
  actor: string;
  agentId: string | null;
  projectId: string | null;
  toolId: string | null;
  resource: string | null;
  risk: string | null;
  result: string;
  detail: Record<string, unknown>;
}

/** `details` of the integration_simulate command result. */
export interface SimulationDetails {
  projectId: string;
  success: boolean;
  connectorId: string | null;
  decision: { effect: string; risk: string; explanation: string } | null;
  error: { kind: string; message: string; retryable: boolean; approvalId?: string } | null;
  selection: string[];
  executed: boolean;
}

export interface CommandResult {
  command: string;
  outcome: "executed" | "denied" | "rejected";
  ok: boolean;
  errorKind?: "forbidden" | "not_found" | "invalid_state" | "invalid_request" | "command_failure";
  reason: string;
  resourceId?: string;
  correlationId: string;
  details: Record<string, unknown>;
  auditEventId: string;
  timestamp: string;
}
export interface CommandInput { command: IntegrationCommandName; body: Record<string, unknown> }
