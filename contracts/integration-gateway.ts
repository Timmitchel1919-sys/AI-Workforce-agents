/**
 * Integration Hub & Tool Gateway — contracts.
 *
 * Agents never talk to providers. They ask the gateway for a CAPABILITY
 * (`repository.read`); the hub decides which connector provides it, whether it
 * is allowed (Layer 7), and executes it with credentials the agent never sees.
 * Private single-user platform: project scoping only.
 */
import type { Entity } from "./persistence.js";
import type {
  GovEnvironment,
  GovRisk,
  PolicyEffect,
  TrustState,
} from "./security-governance.js";

export const OPERATION_CLASSES = [
  "READ",
  "DRAFT",
  "WRITE",
  "PUBLISH",
  "SEND",
  "DEPLOY",
  "DELETE",
] as const;
export type OperationClass = (typeof OPERATION_CLASSES)[number];

export const CONNECTOR_STATES = [
  "DISCOVERED",
  "CONFIGURED",
  "CONNECTED",
  "HEALTHY",
  "DEGRADED",
  "DISCONNECTED",
  "DISABLED",
  "ERROR",
] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];

export const FAILURE_KINDS = [
  "TRANSIENT",
  "AUTHENTICATION",
  "AUTHORIZATION",
  "RATE_LIMIT",
  "VALIDATION",
  "PROVIDER_ERROR",
  "NETWORK",
  "PERMANENT",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type AuthMethod =
  "oauth2" | "api_key" | "token" | "basic" | "service_account" | "none";
export type ConnectorKind = "rest" | "graphql" | "mcp" | "environment";
export type ConnectorMode = "SANDBOX" | "LIVE";

/** What a capability needs from the agent. Values are validated before any call. */
export interface ParamSpec {
  name: string;
  type: "string" | "number" | "boolean" | "string[]" | "object";
  required?: boolean;
  /** Max length for strings / items for arrays. */
  max?: number;
  description?: string;
}

/** Static description of one capability a connector provides (versioned with the connector). */
export interface CapabilityInfo {
  capability: string;
  description: string;
  operation: OperationClass;
  risk: GovRisk;
  version: number;
  /** Provider scopes / permissions this needs. */
  permissions: string[];
  params: ParamSpec[];
  /**
   * Behaviour in SANDBOX mode: a read-only call runs; a side effect is either substituted by a safer
   * capability (Gmail send → draft, WordPress publish → draft) or denied.
   */
  sandbox: "ALLOW" | "DENY" | { substitute: string };
  /** Safe to queue and retry later when the provider is unavailable. */
  queueable: boolean;
  /** Not implemented by this deployment (documented boundary only). */
  unavailable?: string;
}

export interface HealthSnapshot {
  status: ConnectorState;
  checkedAt?: string;
  latencyMs?: number;
  recentCalls: number;
  recentErrors: number;
  consecutiveFailures: number;
  lastError?: { kind: FailureKind; message: string; at: string };
  rateLimit?: { remaining?: number; limit?: number; resetAt?: string };
  authenticated: boolean;
}

export interface InstallStep {
  step:
    | "REGISTER"
    | "INSPECT_CAPABILITIES"
    | "DEFINE_PERMISSIONS"
    | "DEFINE_RISK"
    | "CONFIGURE_AUTH"
    | "TEST_CONNECTION"
    | "SECURITY_VALIDATION"
    | "ENABLE";
  status: "PENDING" | "DONE" | "FAILED";
  at?: string;
  note?: string;
}

/** A registered connector (`integration_connectors`). Configuration only — never a credential. */
export interface HubConnector extends Entity {
  connectorId: string;
  provider: string;
  name: string;
  description: string;
  kind: ConnectorKind;
  version: string;
  providerApiVersion: string;
  /** `capability@version` list. */
  capabilityVersions: string[];
  status: ConnectorState;
  trust: TrustState;
  mode: ConnectorMode;
  enabled: boolean;
  auth: {
    method: AuthMethod;
    scopes: string[];
    credentialConfigured: boolean;
    connectedAt?: string;
    expiresAt?: string;
  };
  config: {
    baseUrl?: string;
    apiVersion?: string;
    environment?: GovEnvironment;
    settings?: Record<string, string>;
  };
  events: string[];
  environments: GovEnvironment[];
  health: HealthSnapshot;
  installation: InstallStep[];
  costClass: "FREE" | "METERED";
  /** Which meeting/intelligence-type family this fulfils (provider abstraction groups). */
  family: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Project ↔ integration ↔ external resource (`integration_mappings`). */
export interface ProjectIntegrationMapping extends Entity {
  projectId: string;
  connectorId: string;
  /** The exact external identifier (owner/repo, firebase project id, site url …) or "*" for the account. */
  resource: string;
  environment?: GovEnvironment;
  role: "PRIMARY" | "FALLBACK";
  /** Where the identifier came from. Never assumed. */
  source: "project_registry" | "user";
  status: "ACTIVE" | "DISABLED";
  owner: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Requests / results                                                  */
/* ------------------------------------------------------------------ */

export interface HubRequest {
  requestId?: string;
  capability: string;
  projectId: string;
  /** Agent making the request. */
  agentId?: string;
  /** A signed-in human (control surface, simulation). */
  principalId?: string;
  taskId?: string;
  executionId?: string;
  taskType?: string;
  /** External resource identifier; defaults to the project's mapped resource. */
  resource?: string;
  parameters?: Record<string, unknown>;
  environment?: GovEnvironment;
  /** Prefer this connector among those providing the capability (still checked). */
  connectorId?: string;
  reason?: string;
  /** Evaluate only: no call, no approval, no queue. */
  dryRun?: boolean;
}

export type HubErrorKind =
  | FailureKind
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "NOT_AVAILABLE"
  | "NOT_MAPPED"
  | "SANDBOX_BLOCKED"
  | "INVALID_REQUEST"
  | "QUEUED";

export interface HubResult {
  success: boolean;
  requestId: string;
  capability: string;
  provider?: string;
  connectorId?: string;
  data?: unknown;
  metadata: {
    durationMs: number;
    attempts: number;
    operation?: OperationClass;
    sandbox?: boolean;
    substitutedFrom?: string;
    fallbackFrom?: string;
    rateLimit?: HealthSnapshot["rateLimit"];
    queuedId?: string;
    selection?: string[];
  };
  error?: {
    kind: HubErrorKind;
    message: string;
    retryable: boolean;
    approvalId?: string;
  };
  decision?: { effect: PolicyEffect; risk: GovRisk; explanation: string };
}

export interface ActivityRecord extends Entity {
  at: string;
  requestId: string;
  capability: string;
  connectorId?: string;
  provider?: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  operation?: OperationClass;
  resource?: string;
  outcome:
    | "SUCCESS"
    | "FAILED"
    | "DENIED"
    | "WAITING_APPROVAL"
    | "BLOCKED"
    | "QUEUED"
    | "SIMULATED";
  errorKind?: HubErrorKind;
  durationMs?: number;
  risk?: GovRisk;
  approvalId?: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type HubEventStatus =
  "RECEIVED" | "IGNORED" | "TRIGGERED" | "REJECTED" | "FAILED";

export interface HubEvent extends Entity {
  eventId: string;
  provider: string;
  connectorId: string;
  projectId?: string;
  /** Normalized type (`repository.changed`). */
  type: string;
  providerEvent: string;
  resource?: string;
  deliveryId: string;
  receivedAt: string;
  status: HubEventStatus;
  reason?: string;
  summary: Record<string, string | number | boolean>;
  triggered: string[];
}

export interface EventSubscription extends Entity {
  subscriptionId: string;
  name: string;
  provider: string;
  eventType: string;
  projectId: string;
  /** Substring / exact match on the event's resource. */
  resourcePattern?: string;
  /** All must match against the event summary (equals). */
  conditions: { field: string; equals: string | number | boolean }[];
  action: { kind: "propose_run"; request: string };
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastFiredAt?: string;
  fires: number;
}

/* ------------------------------------------------------------------ */
/* MCP                                                                 */
/* ------------------------------------------------------------------ */

export interface McpServerRecord extends Entity {
  serverId: string;
  name: string;
  provider: string;
  version: string;
  status: "ENABLED" | "DISABLED" | "PENDING_REVIEW";
  trust: TrustState;
  risk: GovRisk;
  permissions: string[];
  /** Projects allowed to use this server. Empty = none (a registered server is not automatically available). */
  projects: string[];
  config: { transport: "http" | "stdio"; url?: string };
  /** Per-tool operation class decided by the user at registration (default: WRITE, so side effects are never assumed safe). */
  toolPolicies: Record<string, { operation: OperationClass; risk?: GovRisk }>;
  tools: { name: string; description: string }[];
  health: { status: ConnectorState; checkedAt?: string; error?: string };
  registeredBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Control surface                                                     */
/* ------------------------------------------------------------------ */

export const INTEGRATION_COMMANDS = [
  "integration_register_connector",
  "integration_configure",
  "integration_store_credential",
  "integration_revoke_credential",
  "integration_oauth_begin",
  "integration_oauth_complete",
  "integration_test_connection",
  "integration_validate_security",
  "integration_enable",
  "integration_disable",
  "integration_disconnect",
  "integration_set_mode",
  "integration_set_trust",
  "integration_upgrade",
  "integration_map_project",
  "integration_unmap_project",
  "integration_register_mcp",
  "integration_set_mcp_status",
  "integration_discover_mcp",
  "integration_create_subscription",
  "integration_set_subscription",
  "integration_drain_queue",
  "integration_simulate",
] as const;
export type IntegrationCommand = (typeof INTEGRATION_COMMANDS)[number];

export const HUB_LIMITS = Object.freeze({
  maxParamBytes: 64_000,
  maxResponseBytes: 1_000_000,
  timeoutMs: 15_000,
  maxAttempts: 3,
  circuitFailures: 5,
  circuitOpenMs: 30_000,
  rateWindowMs: 60_000,
  defaultRatePerMinute: 60,
  oauthStateTtlMs: 10 * 60_000,
  webhookReplayMs: 5 * 60_000,
});
