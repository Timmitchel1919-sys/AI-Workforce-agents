/**
 * EO-4.1 — secure execution contracts.
 *
 * The CONTROL BOUNDARY for future execution. Everything here is a typed,
 * validated description of what an execution MAY do; nothing here executes.
 *
 *   ExecutionRequest (project + plan revision + stage [+ operation])
 *     → pre-flight: authorization, plan revision, approval, policy,
 *       agent qualification, environment eligibility, tool/operation,
 *       workspace paths, sandbox + limits
 *     → ExecutionSession (+ attempts) with scoped CapabilityGrants
 *     → ExecutionReceipt (immutable evidence)
 *
 * Invariants (see docs/execution-security.md):
 *   DENY BY DEFAULT · NO RAW SHELL AT THE AGENT BOUNDARY · MODEL OUTPUT IS
 *   UNTRUSTED · PLAN REVISION MUST MATCH · AGENT MUST STILL BE QUALIFIED ·
 *   ENVIRONMENT MUST STILL BE ELIGIBLE · APPROVAL MUST STILL BE VALID ·
 *   WORKSPACE IS PROJECT-ISOLATED · SECRETS ARE REFERENCED, NOT STORED ·
 *   BUILD ≠ DEPLOY PERMISSION.
 *
 * There is deliberately no type in this module that carries a shell command
 * string, an executable path chosen by a caller, or a secret value.
 */
import { ValidationError } from "./index.js";
import type { ApprovalRiskLevel } from "./control.js";
import type { CapabilityId } from "./environments.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject properties that are not part of a contract (no smuggled fields). */
export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `${field} has unexpected properties: ${unknown.sort().join(", ")}`,
    );
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;

export function requireExecutionId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a valid identifier`);
  }
  return value;
}

/**
 * Well-known secret value shapes (API keys, GitHub/Slack tokens, AWS keys,
 * PEM private keys). Single source for Control Plane redaction and execution
 * output/receipt redaction.
 */
export const KNOWN_SECRET_VALUE_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;

/* ------------------------------------------------------------------ */
/* Risk (extends the existing approval risk model)                    */
/* ------------------------------------------------------------------ */

/**
 * Execution risk extends `ApprovalRiskLevel` (low/medium/high) with
 * `critical`. A risk is always declared server-side on the registered
 * operation; a request can never carry or lower it.
 */
export const EXECUTION_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type ExecutionRiskLevel = (typeof EXECUTION_RISK_LEVELS)[number];

export const EXECUTION_RISK_RANK: Readonly<Record<ExecutionRiskLevel, number>> =
  { low: 0, medium: 1, high: 2, critical: 3 };

export function riskAtLeast(
  risk: ExecutionRiskLevel,
  threshold: ExecutionRiskLevel,
): boolean {
  return EXECUTION_RISK_RANK[risk] >= EXECUTION_RISK_RANK[threshold];
}

/** Map onto the approval queue's risk levels (critical → high). */
export function toApprovalRisk(risk: ExecutionRiskLevel): ApprovalRiskLevel {
  return risk === "critical" ? "high" : risk;
}

/* ------------------------------------------------------------------ */
/* Execution capabilities (≠ agent permissions)                       */
/* ------------------------------------------------------------------ */

/**
 * What ONE execution session may do. Distinct from an agent's general
 * capabilities/permissions: a broadly qualified agent receives none of these
 * unless a policy rule grants them to a specific session. Capabilities never
 * imply each other (repository.write ⇏ repository.push, build ⇏ deploy).
 */
export const EXECUTION_CAPABILITIES = [
  "filesystem.read",
  "filesystem.write.workspace",
  "repository.read",
  "repository.write",
  "repository.commit",
  "repository.push",
  "repository.branch.manage",
  "process.invoke.bounded",
  "network.outbound.allowed-host",
  "artifact.write",
  "test.invoke",
  "build.invoke",
  "security.scan.invoke",
  "deploy.invoke",
  "secret.reference.use",
] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

export function isExecutionCapability(
  value: unknown,
): value is ExecutionCapability {
  return EXECUTION_CAPABILITIES.includes(value as ExecutionCapability);
}

/* ------------------------------------------------------------------ */
/* Error model                                                        */
/* ------------------------------------------------------------------ */

/**
 * Normalized execution outcomes. Denials are EXPECTED security outcomes —
 * they are returned as data (pre-flight `DENIED`), never as HTTP 500.
 */
export const EXECUTION_ERROR_CODES = [
  "POLICY_DENIED",
  "AUTHORIZATION_DENIED",
  "APPROVAL_REQUIRED",
  "STALE_PLAN",
  "PLAN_NOT_EXECUTABLE",
  "AGENT_NOT_QUALIFIED",
  "ENVIRONMENT_UNAVAILABLE",
  "WORKSPACE_VIOLATION",
  "TOOL_NOT_ALLOWED",
  "INVALID_TOOL_INPUT",
  "SANDBOX_UNAVAILABLE",
  "RESOURCE_LIMIT",
  "TIMEOUT",
  "CANCELLED",
  "SANDBOX_FAILURE",
  "INTERNAL_ERROR",
] as const;
export type ExecutionErrorCode = (typeof EXECUTION_ERROR_CODES)[number];

export interface ExecutionReason {
  code: ExecutionErrorCode;
  /** Short, safe, operator-facing detail. Never a secret or a stack trace. */
  detail: string;
}

// `ExecutionDeniedError` lives in ./index.ts with the other error classes
// (ESM evaluation order: subclasses must not be defined in a cycle member).

/* ------------------------------------------------------------------ */
/* Resource limits                                                    */
/* ------------------------------------------------------------------ */

export interface ExecutionResourceLimits {
  /** Whole-session wall clock. Required: no execution is unbounded. */
  sessionTimeoutMs: number;
  /** Per-operation wall clock. Required and ≤ sessionTimeoutMs. */
  operationTimeoutMs: number;
  maxOutputBytes: number;
  maxArtifactBytes: number;
  maxToolCalls: number;
  /** Optional: only meaningful when a sandbox provider can enforce them. */
  cpuMillicores?: number;
  memoryBytes?: number;
  maxProcesses?: number;
  filesystemQuotaBytes?: number;
  maxModelCalls?: number;
}

export const REQUIRED_LIMIT_KEYS = [
  "sessionTimeoutMs",
  "operationTimeoutMs",
  "maxOutputBytes",
  "maxArtifactBytes",
  "maxToolCalls",
] as const;
export const OPTIONAL_LIMIT_KEYS = [
  "cpuMillicores",
  "memoryBytes",
  "maxProcesses",
  "filesystemQuotaBytes",
  "maxModelCalls",
] as const;
export type ResourceLimitKey =
  (typeof REQUIRED_LIMIT_KEYS)[number] | (typeof OPTIONAL_LIMIT_KEYS)[number];

/** Absolute ceilings no policy may exceed (bounded by construction). */
export const LIMIT_CEILINGS: Readonly<Record<ResourceLimitKey, number>> = {
  sessionTimeoutMs: 6 * 60 * 60 * 1000,
  operationTimeoutMs: 60 * 60 * 1000,
  maxOutputBytes: 16 * 1024 * 1024,
  maxArtifactBytes: 2 * 1024 * 1024 * 1024,
  maxToolCalls: 1000,
  cpuMillicores: 64_000,
  memoryBytes: 64 * 1024 * 1024 * 1024,
  maxProcesses: 256,
  filesystemQuotaBytes: 100 * 1024 * 1024 * 1024,
  maxModelCalls: 1000,
};

export function validateResourceLimits(
  value: unknown,
  field = "limits",
): ExecutionResourceLimits {
  if (!isRecord(value)) throw new ValidationError(`${field} must be an object`);
  rejectUnknownKeys(
    value,
    [...REQUIRED_LIMIT_KEYS, ...OPTIONAL_LIMIT_KEYS],
    field,
  );
  const check = (key: ResourceLimitKey, required: boolean) => {
    const raw = value[key];
    if (raw === undefined) {
      if (required) {
        throw new ValidationError(`${field}.${key} is required (unbounded)`);
      }
      return;
    }
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      throw new ValidationError(`${field}.${key} must be a positive integer`);
    }
    if (raw > LIMIT_CEILINGS[key]) {
      throw new ValidationError(
        `${field}.${key} exceeds the ceiling of ${LIMIT_CEILINGS[key]}`,
      );
    }
  };
  REQUIRED_LIMIT_KEYS.forEach((k) => check(k, true));
  OPTIONAL_LIMIT_KEYS.forEach((k) => check(k, false));
  const limits = value as unknown as ExecutionResourceLimits;
  if (limits.operationTimeoutMs > limits.sessionTimeoutMs) {
    throw new ValidationError(
      `${field}.operationTimeoutMs must not exceed sessionTimeoutMs`,
    );
  }
  return limits;
}

/** The stricter of two limit sets (a rule can only tighten a policy). */
export function tightenLimits(
  base: ExecutionResourceLimits,
  override: Partial<ExecutionResourceLimits> | undefined,
): ExecutionResourceLimits {
  if (!override) return { ...base };
  const out: Record<string, number> = { ...base } as Record<string, number>;
  for (const [key, value] of Object.entries(override)) {
    if (typeof value !== "number") continue;
    const current = out[key];
    out[key] = current === undefined ? value : Math.min(current, value);
  }
  return out as unknown as ExecutionResourceLimits;
}

export type LimitEnforcement = "enforced" | "unsupported";

/** Per-limit statement of whether the chosen sandbox can enforce it. */
export type LimitEnforcementReport = Partial<
  Record<ResourceLimitKey, LimitEnforcement>
>;

/* ------------------------------------------------------------------ */
/* Network policy                                                     */
/* ------------------------------------------------------------------ */

export interface NetworkDestination {
  /** Exact lowercase DNS host name (no wildcard, no IP literal). */
  host: string;
  port: number;
  scheme: "https";
}

export type NetworkPolicy =
  | { mode: "deny_all" }
  | {
      mode: "allow_approved_hosts";
      destinations: readonly NetworkDestination[];
    };

export const DENY_ALL_NETWORK: NetworkPolicy = Object.freeze({
  mode: "deny_all",
});

const HOST_NAME =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const FORBIDDEN_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".intranet",
  ".lan",
];
const FORBIDDEN_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.azure.com",
  "instance-data",
]);

/**
 * A destination is only acceptable when it is an exact, public-looking DNS
 * name over HTTPS. IP literals (incl. loopback, private, link-local and the
 * 169.254.169.254 metadata address), `localhost`, internal suffixes and cloud
 * metadata names are rejected here. DNS-rebinding / resolved-address checks
 * are the enforcing provider's job and are NOT claimed by this contract.
 */
export function validateNetworkDestination(
  value: unknown,
  field = "destination",
): NetworkDestination {
  if (!isRecord(value)) throw new ValidationError(`${field} must be an object`);
  rejectUnknownKeys(value, ["host", "port", "scheme"], field);
  const host = value.host;
  if (typeof host !== "string" || host !== host.toLowerCase()) {
    throw new ValidationError(`${field}.host must be a lowercase host name`);
  }
  if (host.includes("*")) {
    throw new ValidationError(`${field}.host must not be a wildcard`);
  }
  if (/^[0-9.]+$/.test(host) || host.includes(":") || host.startsWith("[")) {
    throw new ValidationError(`${field}.host must not be an IP literal`);
  }
  if (
    FORBIDDEN_HOSTS.has(host) ||
    FORBIDDEN_HOST_SUFFIXES.some((s) => host === s || host.endsWith(s))
  ) {
    throw new ValidationError(
      `${field}.host targets a local or internal network`,
    );
  }
  if (!HOST_NAME.test(host)) {
    throw new ValidationError(
      `${field}.host must be a fully qualified host name`,
    );
  }
  if (value.scheme !== "https") {
    throw new ValidationError(`${field}.scheme must be https`);
  }
  const port = value.port ?? 443;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new ValidationError(`${field}.port must be a valid port`);
  }
  return { host, port, scheme: "https" };
}

export function validateNetworkPolicy(
  value: unknown,
  field = "network",
): NetworkPolicy {
  if (value === undefined) return DENY_ALL_NETWORK;
  if (!isRecord(value)) throw new ValidationError(`${field} must be an object`);
  if (value.mode === "deny_all") {
    rejectUnknownKeys(value, ["mode"], field);
    return DENY_ALL_NETWORK;
  }
  if (value.mode === "allow_approved_hosts") {
    rejectUnknownKeys(value, ["mode", "destinations"], field);
    if (!Array.isArray(value.destinations) || value.destinations.length === 0) {
      throw new ValidationError(
        `${field}.destinations must list at least one approved host`,
      );
    }
    return {
      mode: "allow_approved_hosts",
      destinations: value.destinations.map((d, i) =>
        validateNetworkDestination(d, `${field}.destinations[${i}]`),
      ),
    };
  }
  throw new ValidationError(
    `${field}.mode must be deny_all or allow_approved_hosts`,
  );
}

/* ------------------------------------------------------------------ */
/* Secrets — referenced, never stored                                 */
/* ------------------------------------------------------------------ */

/** `secret://<name>` — a name only. There is no value field anywhere. */
export type SecretReference = `secret://${string}`;

const SECRET_REF = /^secret:\/\/[a-z0-9][a-z0-9._-]{1,99}$/;

export function validateSecretReference(
  value: unknown,
  field = "secretRef",
): SecretReference {
  if (typeof value !== "string" || !SECRET_REF.test(value)) {
    throw new ValidationError(
      `${field} must be a secret reference (secret://name)`,
    );
  }
  return value as SecretReference;
}

/** Metadata about a secret reference. Never the value. */
export interface SecretDescriptor {
  ref: SecretReference;
  available: boolean;
}

/**
 * Opaque, single-use handle a sandbox provider exchanges for a value at the
 * last possible moment. Models, agents, logs and receipts only ever see this.
 */
export interface SecretHandle {
  handleId: string;
  ref: SecretReference;
  grantId: string;
  expiresAt: string;
}

/**
 * SecretBroker port. The execution system asks for a HANDLE bound to a
 * capability grant; it never receives or serializes a raw secret.
 */
export interface SecretBroker {
  describe(ref: SecretReference): Promise<SecretDescriptor>;
  issueHandle(
    ref: SecretReference,
    grant: CapabilityGrant,
  ): Promise<SecretHandle>;
}

/* ------------------------------------------------------------------ */
/* Operations (typed, registered, bounded)                            */
/* ------------------------------------------------------------------ */

export const EXECUTION_STAGE_KINDS = [
  "build",
  "test",
  "security",
  "deployment",
] as const;
export type ExecutionStageKind = (typeof EXECUTION_STAGE_KINDS)[number];

/** Per-field schema of an operation's structured input. */
export type OperationInputField =
  | { kind: "enum"; values: readonly string[]; required?: boolean }
  | { kind: "integer"; min: number; max: number; required?: boolean }
  /** A path RELATIVE to the session workspace; validated, never absolute. */
  | { kind: "workspace_path"; required?: boolean };

/**
 * A registered, server-side execution operation. The agent-facing boundary is
 * `{ operationId, input }` — never a command string. Risk and capabilities are
 * declared here and cannot be supplied or lowered by a request.
 */
export interface ExecutionOperationDefinition {
  id: string;
  /** Must be registered in the existing ToolRegistry (the tool boundary). */
  toolId: string;
  stageKind: ExecutionStageKind;
  description: string;
  requiredCapabilities: readonly ExecutionCapability[];
  risk: ExecutionRiskLevel;
  input: Readonly<Record<string, OperationInputField>>;
}

export function validateOperationDefinition(
  def: ExecutionOperationDefinition,
): void {
  requireExecutionId(def.id, "operation.id");
  requireExecutionId(def.toolId, "operation.toolId");
  if (!EXECUTION_STAGE_KINDS.includes(def.stageKind)) {
    throw new ValidationError("operation.stageKind is not a known stage kind");
  }
  if (!EXECUTION_RISK_LEVELS.includes(def.risk)) {
    throw new ValidationError("operation.risk is not a known risk level");
  }
  if (
    def.requiredCapabilities.length === 0 ||
    !def.requiredCapabilities.every(isExecutionCapability)
  ) {
    throw new ValidationError(
      "operation.requiredCapabilities must list known execution capabilities",
    );
  }
  for (const [name, field] of Object.entries(def.input)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) {
      throw new ValidationError(`operation.input.${name} is not a valid name`);
    }
    if (field.kind === "enum" && field.values.length === 0) {
      throw new ValidationError(`operation.input.${name} needs enum values`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Structured process invocation (future adapters only)               */
/* ------------------------------------------------------------------ */

/** One argv slot of a server-controlled executable definition. */
export type ArgumentSlot =
  | { kind: "literal"; value: string }
  | { kind: "enum_input"; input: string; values: readonly string[] }
  | { kind: "integer_input"; input: string; min: number; max: number }
  | { kind: "workspace_path_input"; input: string };

/**
 * Server-controlled executable. The executable location is resolved by the
 * provider from `executableId` — an agent can never submit a path. Every
 * argument comes from a fixed template; there are no free-form arguments.
 */
export interface ExecutableDefinition {
  executableId: string;
  operations: Readonly<Record<string, readonly ArgumentSlot[]>>;
  /** Names of controlled env vars; values come from config or secret handles. */
  environmentVariables: readonly string[];
}

/**
 * A structured, bounded invocation for a future sandbox adapter. There is no
 * `rawShellCommand`, and it is never exposed to a model.
 */
export interface StructuredInvocation {
  executableId: string;
  operationId: string;
  argv: readonly string[];
  workingDirectoryRef: string;
  environmentVariableRefs: readonly string[];
  timeoutMs: number;
}

/* ------------------------------------------------------------------ */
/* Execution policy                                                   */
/* ------------------------------------------------------------------ */

export interface FilesystemScope {
  access: "read" | "write";
  /** Workspace-relative prefix, `.` = the whole workspace. */
  path: string;
}

export interface ExecutionPolicyRule {
  id: string;
  /** Operation ids this rule permits. Exact match only — no wildcard. */
  operationIds: readonly string[];
  /** Capabilities this rule may grant. Exact match only — no implication. */
  capabilities: readonly ExecutionCapability[];
  filesystem: readonly FilesystemScope[];
  /** Environment capabilities the selected instance must still provide. */
  requiredEnvironmentCapabilities: readonly CapabilityId[];
  network?: NetworkPolicy;
  /** Secret references this rule may request handles for. */
  secretRefs?: readonly SecretReference[];
  /** Can only TIGHTEN the policy defaults. */
  limits?: Partial<ExecutionResourceLimits>;
}

/**
 * Versioned, immutable execution policy. `(policyId, version)` identifies
 * exactly one policy forever; a receipt names the version that governed it.
 * DENY UNLESS PERMITTED: an operation is allowed only when a rule lists it and
 * grants every capability it needs, none of which are forbidden.
 */
export interface ExecutionPolicy {
  policyId: string;
  version: number;
  description: string;
  rules: readonly ExecutionPolicyRule[];
  /** Explicit forbids override any rule. */
  forbiddenCapabilities: readonly ExecutionCapability[];
  /** Operations above this risk are denied outright. */
  maxRisk: ExecutionRiskLevel;
  /** Operations at/above this risk need an approved approval for the revision. */
  approvalRequiredAtOrAbove: ExecutionRiskLevel;
  defaultLimits: ExecutionResourceLimits;
  /** Default: deny_all. */
  network: NetworkPolicy;
  /** How long a capability grant stays valid (ms). */
  grantTtlMs: number;
}

export function validateExecutionPolicy(policy: ExecutionPolicy): void {
  requireExecutionId(policy.policyId, "policy.policyId");
  if (!Number.isInteger(policy.version) || policy.version < 1) {
    throw new ValidationError("policy.version must be a positive integer");
  }
  if (
    !EXECUTION_RISK_LEVELS.includes(policy.maxRisk) ||
    !EXECUTION_RISK_LEVELS.includes(policy.approvalRequiredAtOrAbove)
  ) {
    throw new ValidationError("policy risk levels must be known levels");
  }
  validateResourceLimits(policy.defaultLimits, "policy.defaultLimits");
  validateNetworkPolicy(policy.network, "policy.network");
  if (
    !Number.isInteger(policy.grantTtlMs) ||
    policy.grantTtlMs <= 0 ||
    policy.grantTtlMs > LIMIT_CEILINGS.sessionTimeoutMs
  ) {
    throw new ValidationError("policy.grantTtlMs must be bounded");
  }
  if (!policy.forbiddenCapabilities.every(isExecutionCapability)) {
    throw new ValidationError("policy.forbiddenCapabilities must be known");
  }
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    requireExecutionId(rule.id, "policy.rules[].id");
    if (ids.has(rule.id)) {
      throw new ValidationError(`policy rule ${rule.id} is duplicated`);
    }
    ids.add(rule.id);
    if (rule.operationIds.some((id) => id === "*" || id.includes("*"))) {
      throw new ValidationError("policy rules must not use wildcards");
    }
    if (!rule.capabilities.every(isExecutionCapability)) {
      throw new ValidationError(
        `policy rule ${rule.id} has unknown capabilities`,
      );
    }
    if (rule.network) validateNetworkPolicy(rule.network, `rule ${rule.id}`);
    rule.secretRefs?.forEach((r) => validateSecretReference(r));
    if (rule.limits) {
      for (const [key, v] of Object.entries(rule.limits)) {
        if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
          throw new ValidationError(`rule ${rule.id} limit ${key} is invalid`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Capability grants                                                  */
/* ------------------------------------------------------------------ */

/**
 * One capability, granted to ONE execution context, until `expiresAt`.
 * Never global, never permanent.
 */
export interface CapabilityGrant {
  grantId: string;
  sessionId: string;
  projectId: string;
  agentId: string;
  environmentInstanceId: string;
  workspaceId: string;
  toolId: string;
  operationId: string;
  capability: ExecutionCapability;
  filesystem?: readonly FilesystemScope[];
  network?: NetworkPolicy;
  policyId: string;
  policyVersion: number;
  issuedAt: string;
  expiresAt: string;
}

export interface GrantUseContext {
  sessionId: string;
  projectId: string;
  agentId: string;
  environmentInstanceId: string;
  workspaceId: string;
  toolId: string;
  operationId: string;
  capability: ExecutionCapability;
  /** ISO time of use. */
  at: string;
}

/** A grant applies only to the exact context it was issued for. */
export function grantAllows(
  grant: CapabilityGrant,
  use: GrantUseContext,
): boolean {
  return (
    grant.sessionId === use.sessionId &&
    grant.projectId === use.projectId &&
    grant.agentId === use.agentId &&
    grant.environmentInstanceId === use.environmentInstanceId &&
    grant.workspaceId === use.workspaceId &&
    grant.toolId === use.toolId &&
    grant.operationId === use.operationId &&
    grant.capability === use.capability &&
    Date.parse(use.at) < Date.parse(grant.expiresAt)
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export const WORKSPACE_STATUSES = [
  "requested",
  "prepared",
  "released",
] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/**
 * The filesystem boundary for one session. `rootRef` is an opaque reference
 * resolved only by a sandbox provider — never a host path an agent sees.
 */
export interface ExecutionWorkspace {
  workspaceId: string;
  sessionId: string;
  projectId: string;
  rootRef: string;
  mode: "read_only" | "read_write";
  status: WorkspaceStatus;
  quotaBytes?: number;
}

/* ------------------------------------------------------------------ */
/* Sandbox (≠ EnvironmentInstance)                                    */
/* ------------------------------------------------------------------ */

export const SANDBOX_KINDS = [
  "local_restricted_process",
  "docker",
  "windows_runner",
  "macos_runner",
  "cloud_runner",
  "game_engine_runner",
] as const;
export type SandboxKind = (typeof SANDBOX_KINDS)[number];

/**
 * What a provider can ACTUALLY enforce. A limit or network mode not listed
 * here is reported as `unsupported` — never silently claimed.
 */
export interface SandboxProviderCapabilities {
  enforcedLimits: readonly ResourceLimitKey[];
  networkModes: readonly NetworkPolicy["mode"][];
  filesystemIsolation: boolean;
  supportsKill: boolean;
}

export interface SandboxSpec {
  sessionId: string;
  projectId: string;
  environmentInstanceId: string;
  workspace: ExecutionWorkspace;
  limits: ExecutionResourceLimits;
  network: NetworkPolicy;
  grants: readonly CapabilityGrant[];
}

export interface SandboxHandle {
  sandboxId: string;
  providerId: string;
  sessionId: string;
}

/**
 * Provider-neutral isolation boundary. A sandbox may run WITHIN an
 * EnvironmentInstance but is not one: the environment says where compatible
 * tools exist; the sandbox is the security boundary execution runs in.
 * EO-4.1 defines the contract only — no provider runs anything yet, and
 * `invoke` accepts a StructuredInvocation, never a command string.
 */
export interface SandboxProvider {
  readonly providerId: string;
  readonly kind: SandboxKind;
  readonly capabilities: SandboxProviderCapabilities;
  /** Whether this provider can serve the given environment instance now. */
  isAvailableFor(environmentInstanceId: string): boolean;
  prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace>;
  start(spec: SandboxSpec): Promise<SandboxHandle>;
  invoke(
    handle: SandboxHandle,
    invocation: StructuredInvocation,
  ): Promise<{ exitClass: ExitClassification; output: BoundedOutput }>;
  terminate(handle: SandboxHandle, reason: string): Promise<void>;
  collectOutputs(handle: SandboxHandle): Promise<readonly ArtifactReference[]>;
  cleanup(handle: SandboxHandle): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Session & attempts                                                 */
/* ------------------------------------------------------------------ */

export const EXECUTION_SESSION_STATUSES = [
  "created",
  "validating",
  "ready",
  "running",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
  "timed_out",
  "denied",
] as const;
export type ExecutionSessionStatus =
  (typeof EXECUTION_SESSION_STATUSES)[number];

export const TERMINAL_SESSION_STATUSES: readonly ExecutionSessionStatus[] = [
  "cancelled",
  "succeeded",
  "failed",
  "timed_out",
  "denied",
];

/** Strict lifecycle. Terminal states have no exits — retries are new attempts. */
export const SESSION_TRANSITIONS: Readonly<
  Record<ExecutionSessionStatus, readonly ExecutionSessionStatus[]>
> = {
  created: ["validating", "cancelled"],
  validating: ["ready", "denied", "cancelled"],
  ready: ["running", "cancelled", "denied"],
  running: ["cancelling", "succeeded", "failed", "timed_out"],
  cancelling: ["cancelled", "failed", "timed_out"],
  cancelled: [],
  succeeded: [],
  failed: [],
  timed_out: [],
  denied: [],
};

export function isTerminalSession(status: ExecutionSessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.includes(status);
}

export function canTransitionSession(
  from: ExecutionSessionStatus,
  to: ExecutionSessionStatus,
): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export interface ExecutionPlanReference {
  /** Stable plan series id. */
  planId: string;
  /** Exact revision. Execution never floats to "the newest". */
  version: number;
  /** Document id `${planId}@v${version}`. */
  executionPlanId: string;
}

/**
 * One governed execution of one plan stage. Identity is the opaque, stable
 * `sessionId` — never a project, agent or environment display name.
 * No secret values: only references and grants.
 */
export interface ExecutionSession {
  sessionId: string;
  projectId: string;
  plan: ExecutionPlanReference;
  stageId: string;
  stageKind: ExecutionStageKind;
  operationId: string;
  toolId: string;
  workflowId?: string;
  taskId?: string;
  agentId: string;
  environmentInstanceId: string;
  policy: { policyId: string; version: number };
  approvalIds: readonly string[];
  risk: ExecutionRiskLevel;
  workspace: ExecutionWorkspace;
  grants: readonly CapabilityGrant[];
  limits: ExecutionResourceLimits;
  limitEnforcement: LimitEnforcementReport;
  network: NetworkPolicy;
  sandbox?: { providerId: string; kind: SandboxKind };
  status: ExecutionSessionStatus;
  reasons: readonly ExecutionReason[];
  requestedBy: string;
  idempotencyKey: string;
  cancellation?: {
    requestedBy: string;
    requestedAt: string;
    reason: string;
    kind: "cancel" | "kill";
  };
  attempts: readonly ExecutionAttempt[];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  revision: number;
}

export const ATTEMPT_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export type ExecutionAttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** A retry is a NEW attempt; earlier attempts stay as evidence. */
export interface ExecutionAttempt {
  attemptId: string;
  sessionId: string;
  number: number;
  status: ExecutionAttemptStatus;
  startedAt?: string;
  endedAt?: string;
  receiptId?: string;
}

/* ------------------------------------------------------------------ */
/* Output, logs, artifacts, receipts                                  */
/* ------------------------------------------------------------------ */

export interface BoundedOutput {
  text: string;
  /** Explicit: callers always know when output was cut. */
  truncated: boolean;
  originalBytes: number;
}

export type LogSeverity = "debug" | "info" | "warning" | "error";

export interface ExecutionLogEntry {
  sessionId: string;
  attemptId?: string;
  toolId?: string;
  timestamp: string;
  severity: LogSeverity;
  /** Redacted and bounded. */
  message: string;
  truncated: boolean;
}

export interface ArtifactReference {
  artifactId: string;
  kind: string;
  sizeBytes: number;
  digest: { algorithm: "sha256"; value: string };
  mediaType: string;
  producerSessionId: string;
  /** Opaque storage reference; artifacts are never inlined. */
  storageRef: string;
}

export const EXIT_CLASSIFICATIONS = [
  "success",
  "tool_failure",
  "timeout",
  "cancelled",
  "resource_limit",
  "sandbox_failure",
  "denied",
] as const;
export type ExitClassification = (typeof EXIT_CLASSIFICATIONS)[number];

/**
 * Immutable evidence of ONE execution attempt (≠ audit event, which records
 * governance/security history). `simulated: true` marks receipts produced by
 * tests/simulation — never to be presented as production execution.
 */
export interface ExecutionReceipt {
  receiptId: string;
  sessionId: string;
  attemptId: string;
  projectId: string;
  plan: ExecutionPlanReference;
  stageId: string;
  agentId: string;
  environmentInstanceId: string;
  toolId: string;
  operationId: string;
  policy: { policyId: string; version: number };
  approvalIds: readonly string[];
  startedAt: string;
  endedAt: string;
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled" | "denied";
  exitClass: ExitClassification;
  artifacts: readonly ArtifactReference[];
  logRefs: readonly string[];
  resources: {
    wallClockMs: number;
    outputBytes: number;
    outputTruncated: boolean;
  };
  redaction: { applied: true; redactedValues: number };
  simulated: boolean;
}

/* ------------------------------------------------------------------ */
/* Request & pre-flight                                               */
/* ------------------------------------------------------------------ */

/**
 * What a client may ask for. References only — project, plan revision, stage
 * and (optionally) a registered operation with structured input. No command
 * text, no executable, no risk, no capability, no approval state.
 */
export interface ExecutionRequest {
  projectId: string;
  planId: string;
  planVersion: number;
  stageId: string;
  operationId?: string;
  input?: Record<string, string | number>;
}

export const EXECUTION_REQUEST_KEYS = [
  "projectId",
  "planId",
  "planVersion",
  "stageId",
  "operationId",
  "input",
] as const;

export function validateExecutionRequest(value: unknown): ExecutionRequest {
  if (!isRecord(value)) {
    throw new ValidationError("execution request must be an object");
  }
  rejectUnknownKeys(value, EXECUTION_REQUEST_KEYS, "execution request");
  const planVersion = value.planVersion;
  if (
    typeof planVersion !== "number" ||
    !Number.isInteger(planVersion) ||
    planVersion < 1
  ) {
    throw new ValidationError("planVersion must be a positive integer");
  }
  const input = value.input;
  if (input !== undefined) {
    if (!isRecord(input)) throw new ValidationError("input must be an object");
    for (const [key, v] of Object.entries(input)) {
      if (typeof v !== "string" && typeof v !== "number") {
        throw new ValidationError(`input.${key} must be a string or number`);
      }
      if (typeof v === "string" && v.length > 512) {
        throw new ValidationError(`input.${key} is too long`);
      }
    }
  }
  return {
    projectId: requireExecutionId(value.projectId, "projectId"),
    planId: requireExecutionId(value.planId, "planId"),
    planVersion,
    stageId: requireExecutionId(value.stageId, "stageId"),
    ...(value.operationId !== undefined
      ? { operationId: requireExecutionId(value.operationId, "operationId") }
      : {}),
    ...(input !== undefined
      ? { input: input as Record<string, string | number> }
      : {}),
  };
}

export const PREFLIGHT_CHECKS = [
  "authorization",
  "plan",
  "stage",
  "approval",
  "policy",
  "agent",
  "environment",
  "tool",
  "input",
  "workspace",
  "sandbox",
] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];

export interface PreflightResult {
  decision: "ELIGIBLE" | "DENIED";
  /** Every failing gate, in check order. Empty iff ELIGIBLE. */
  reasons: readonly ExecutionReason[];
  checks: Readonly<Record<PreflightCheck, "pass" | "fail" | "skipped">>;
  plan: ExecutionPlanReference;
  projectId: string;
  stageId: string;
  stageKind?: ExecutionStageKind;
  operationId?: string;
  toolId?: string;
  agentId?: string;
  environmentInstanceId?: string;
  policy?: { policyId: string; version: number };
  risk?: ExecutionRiskLevel;
  requiredCapabilities: readonly ExecutionCapability[];
  requiredApprovals: readonly {
    reason: string;
    approvalId?: string;
    state: string;
  }[];
  limits?: ExecutionResourceLimits;
  limitEnforcement?: LimitEnforcementReport;
  network?: NetworkPolicy;
  sandbox?: { providerId: string; kind: SandboxKind };
  /** Execution itself is not available in EO-4.1. */
  executionAvailable: false;
}
