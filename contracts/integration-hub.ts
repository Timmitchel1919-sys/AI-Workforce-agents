export interface ConnectorCapability {
  id: string;
  name: string;
  description: string;
  type: "read" | "write" | "execute";
  inputSchema: unknown;
  outputSchema: unknown;
}

export type ConnectorStatus =
  "active" | "inactive" | "degraded" | "error" | "pending";

export interface ConnectorConfig {
  id: string;
  name: string;
  version: string;
  type: "mcp" | "api" | "sdk" | "cli" | "webhook" | "runner";
  endpoint?: string;
  authType: "none" | "oauth2" | "apiKey" | "mtls" | "custom";
  metadata: Record<string, unknown>;
}

export interface Connector {
  getConfig(): ConnectorConfig;
  getStatus(): ConnectorStatus;
  getCapabilities(): Promise<ConnectorCapability[]>;
  initialize(credentials?: unknown): Promise<void>;
  shutdown(): Promise<void>;
  invokeCapability(
    capabilityId: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<InvocationResult>;
  checkHealth(): Promise<HealthStatus>;
}

export interface InvocationContext {
  userId: string;
  workspaceId: string;
  projectId?: string;
  deliveryPlanId?: string;
  roles: string[];
  traceId: string;
  timestamp: number;
}

export interface InvocationResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  metrics: Record<string, number | string | boolean> & {
    costActual?: number;
    currency?: string;
  };
}

export interface HealthStatus {
  status: ConnectorStatus;
  latencyMs: number;
  lastChecked: number;
  details?: string;
}

export interface ConnectorRegistry {
  register(connector: Connector): Promise<void>;
  unregister(connectorId: string): Promise<void>;
  getConnector(connectorId: string): Promise<Connector | undefined>;
  listConnectors(filter?: Partial<ConnectorConfig>): Promise<Connector[]>;
  findCapableConnectors(capabilityQuery: string): Promise<Connector[]>;
}

export interface CredentialBroker {
  getCredentials(
    connectorId: string,
    context: InvocationContext,
  ): Promise<unknown>;
  storeCredentials(
    connectorId: string,
    credentials: unknown,
    context: InvocationContext,
  ): Promise<void>;
  revokeCredentials(
    connectorId: string,
    context: InvocationContext,
  ): Promise<void>;
}

export interface GovernancePolicy {
  canInvoke(
    connectorId: string,
    capabilityId: string,
    context: InvocationContext,
    input: unknown,
  ): Promise<boolean>;
}

export interface ResultValidator {
  validate(capabilityId: string, result: InvocationResult): Promise<boolean>;
}
