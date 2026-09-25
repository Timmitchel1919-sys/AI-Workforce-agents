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
/** Hard ceiling for one structured text input (e.g. file content). */
export const MAX_INVOCATION_TEXT_BYTES = 1024 * 1024;
/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject properties that are not part of a contract (no smuggled fields). */
export function rejectUnknownKeys(value, allowed, field) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new ValidationError(`${field} has unexpected properties: ${unknown.sort().join(", ")}`);
    }
}
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;
export function requireExecutionId(value, field) {
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
export const KNOWN_SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
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
];
export const EXECUTION_RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
export function riskAtLeast(risk, threshold) {
    return EXECUTION_RISK_RANK[risk] >= EXECUTION_RISK_RANK[threshold];
}
/** Map onto the approval queue's risk levels (critical → high). */
export function toApprovalRisk(risk) {
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
    /** EO-4.3: deleting (or moving away) a file is its own capability. */
    "filesystem.delete.workspace",
    /** EO-4.3: writing protected paths (CI/CD, rules, infrastructure). */
    "filesystem.write.protected",
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
];
export function isExecutionCapability(value) {
    return EXECUTION_CAPABILITIES.includes(value);
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
    /** EO-4.2: the session holds no valid grant for a required capability. */
    "CAPABILITY_NOT_GRANTED",
    /** EO-4.2: the operation output failed its declared output schema. */
    "INVALID_OUTPUT",
    /**
     * EO-4.3: a write would overwrite content that changed (stale expected
     * hash, existing file, pre-existing user change, workspace lease held).
     */
    "WORKSPACE_CONFLICT",
    /** EO-4.4: a required toolchain is not present on the environment. */
    "TOOLCHAIN_UNAVAILABLE",
    /** EO-4.4: declared dependencies (e.g. installed packages) are missing. */
    "DEPENDENCY_MISSING",
    /* ---- EO-4.5 environment execution (normalized, adapter-neutral) ---- */
    "ENVIRONMENT_OFFLINE",
    "RUNNER_UNAVAILABLE",
    "RUNNER_TIMEOUT",
    "RUNNER_DISCONNECTED",
    "RUNNER_IDENTITY_UNVERIFIED",
    "ADAPTER_UNAVAILABLE",
    "ADAPTER_ERROR",
    "PLATFORM_MISMATCH",
    "TOOLCHAIN_MISSING",
    "TOOLCHAIN_VERSION_MISMATCH",
    "MODULE_MISSING",
    "GPU_UNAVAILABLE",
    "RESOURCE_UNAVAILABLE",
    "CONTAINER_POLICY_DENIED",
    "SIGNING_NOT_AUTHORIZED",
    "PUBLISHING_NOT_AUTHORIZED",
    "SOURCE_MISMATCH",
    "INTEGRITY_FAILED",
    /* ---- EO-4.6 governed source control & deployment ---- */
    "VERIFICATION_REQUIRED",
    "REVERIFICATION_REQUIRED",
    "REVIEW_REQUIRED",
    "REVIEW_NOT_INDEPENDENT",
    "STAGING_CONFLICT",
    "COMMIT_FAILED",
    "BRANCH_PROTECTED",
    "REMOTE_CHANGED",
    "PUSH_FAILED",
    "TARGET_NOT_REGISTERED",
    "STALE_CANDIDATE",
    "DEPLOYMENT_LOCKED",
    "DEPLOYMENT_FAILED",
    "ROLLBACK_UNAVAILABLE",
    "ROLLBACK_FAILED",
];
export const REQUIRED_LIMIT_KEYS = [
    "sessionTimeoutMs",
    "operationTimeoutMs",
    "maxOutputBytes",
    "maxArtifactBytes",
    "maxToolCalls",
];
export const OPTIONAL_LIMIT_KEYS = [
    "cpuMillicores",
    "memoryBytes",
    "maxProcesses",
    "filesystemQuotaBytes",
    "maxModelCalls",
];
/** Absolute ceilings no policy may exceed (bounded by construction). */
export const LIMIT_CEILINGS = {
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
export function validateResourceLimits(value, field = "limits") {
    if (!isRecord(value))
        throw new ValidationError(`${field} must be an object`);
    rejectUnknownKeys(value, [...REQUIRED_LIMIT_KEYS, ...OPTIONAL_LIMIT_KEYS], field);
    const check = (key, required) => {
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
            throw new ValidationError(`${field}.${key} exceeds the ceiling of ${LIMIT_CEILINGS[key]}`);
        }
    };
    REQUIRED_LIMIT_KEYS.forEach((k) => check(k, true));
    OPTIONAL_LIMIT_KEYS.forEach((k) => check(k, false));
    const limits = value;
    if (limits.operationTimeoutMs > limits.sessionTimeoutMs) {
        throw new ValidationError(`${field}.operationTimeoutMs must not exceed sessionTimeoutMs`);
    }
    return limits;
}
/** The stricter of two limit sets (a rule can only tighten a policy). */
export function tightenLimits(base, override) {
    if (!override)
        return { ...base };
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (typeof value !== "number")
            continue;
        const current = out[key];
        out[key] = current === undefined ? value : Math.min(current, value);
    }
    return out;
}
export const DENY_ALL_NETWORK = Object.freeze({
    mode: "deny_all",
});
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const FORBIDDEN_HOST_SUFFIXES = [
    "localhost",
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
    ".intranet",
    ".lan",
];
/** Wildcard DNS services that resolve names to embedded IPs (SSRF). */
const FORBIDDEN_IP_DNS_SUFFIXES = [
    ".nip.io",
    ".sslip.io",
    ".xip.io",
    ".localtest.me",
    ".lvh.me",
    ".traefik.me",
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
export function validateNetworkDestination(value, field = "destination") {
    if (!isRecord(value))
        throw new ValidationError(`${field} must be an object`);
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
    if (FORBIDDEN_HOSTS.has(host) ||
        FORBIDDEN_HOST_SUFFIXES.some((s) => host === s || host.endsWith(s))) {
        throw new ValidationError(`${field}.host targets a local or internal network`);
    }
    if (!HOST_NAME.test(host)) {
        throw new ValidationError(`${field}.host must be a fully qualified host name`);
    }
    // EO-4.8: a real TLD is alphabetic. Numeric / hex-looking hosts such as
    // `0x7f.1` or `127.1` can be parsed as IP addresses by resolvers.
    const labels = host.split(".");
    const numeric = (label) => /^(0x[0-9a-f]+|[0-9]+)$/.test(label);
    if (!/^[a-z][a-z0-9-]*$/.test(labels[labels.length - 1]) ||
        labels.every(numeric)) {
        throw new ValidationError(`${field}.host must not encode an IP address`);
    }
    if (FORBIDDEN_IP_DNS_SUFFIXES.some((s) => host.endsWith(s) || host === s.slice(1))) {
        throw new ValidationError(`${field}.host resolves to embedded IP addresses (not allowed)`);
    }
    if (value.scheme !== "https") {
        throw new ValidationError(`${field}.scheme must be https`);
    }
    const port = value.port ?? 443;
    if (typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535) {
        throw new ValidationError(`${field}.port must be a valid port`);
    }
    return { host, port, scheme: "https" };
}
export function validateNetworkPolicy(value, field = "network") {
    if (value === undefined)
        return DENY_ALL_NETWORK;
    if (!isRecord(value))
        throw new ValidationError(`${field} must be an object`);
    if (value.mode === "deny_all") {
        rejectUnknownKeys(value, ["mode"], field);
        return DENY_ALL_NETWORK;
    }
    if (value.mode === "allow_approved_hosts") {
        rejectUnknownKeys(value, ["mode", "destinations"], field);
        if (!Array.isArray(value.destinations) || value.destinations.length === 0) {
            throw new ValidationError(`${field}.destinations must list at least one approved host`);
        }
        return {
            mode: "allow_approved_hosts",
            destinations: value.destinations.map((d, i) => validateNetworkDestination(d, `${field}.destinations[${i}]`)),
        };
    }
    throw new ValidationError(`${field}.mode must be deny_all or allow_approved_hosts`);
}
const SECRET_REF = /^secret:\/\/[a-z0-9][a-z0-9._-]{1,99}$/;
export function validateSecretReference(value, field = "secretRef") {
    if (typeof value !== "string" || !SECRET_REF.test(value)) {
        throw new ValidationError(`${field} must be a secret reference (secret://name)`);
    }
    return value;
}
/* ------------------------------------------------------------------ */
/* Operations (typed, registered, bounded)                            */
/* ------------------------------------------------------------------ */
export const EXECUTION_STAGE_KINDS = [
    "build",
    "test",
    "security",
    "deployment",
];
/** Workspace reach of an operation (explicit, else from its capabilities). */
export function operationWorkspaceAccess(op) {
    if (op.workspaceAccess)
        return op.workspaceAccess;
    if (op.requiredCapabilities.includes("filesystem.write.workspace")) {
        return "write";
    }
    return op.requiredCapabilities.includes("filesystem.read") ? "read" : "none";
}
export function validateExecutionToolDefinition(def) {
    requireExecutionId(def.toolId, "tool.toolId");
    requireExecutionId(def.executable.executableId, "tool.executable.executableId");
    if (typeof def.version !== "string" || def.version.trim() === "") {
        throw new ValidationError("tool.version is required");
    }
    if (!def.requiredCapabilities.every(isExecutionCapability)) {
        throw new ValidationError("tool.requiredCapabilities must be known");
    }
    if (def.operations.length === 0) {
        throw new ValidationError("tool.operations must not be empty");
    }
    for (const op of def.operations) {
        requireExecutionId(op, "tool.operations[]");
        if (!def.executable.operations[op]) {
            throw new ValidationError(`tool ${def.toolId} exposes ${op} without an argument template`);
        }
    }
    for (const name of def.executable.environmentVariables) {
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) {
            throw new ValidationError(`tool env var ${name} is not a valid name`);
        }
    }
}
export function validateOperationDefinition(def) {
    requireExecutionId(def.id, "operation.id");
    requireExecutionId(def.toolId, "operation.toolId");
    if (!EXECUTION_STAGE_KINDS.includes(def.stageKind)) {
        throw new ValidationError("operation.stageKind is not a known stage kind");
    }
    if (!EXECUTION_RISK_LEVELS.includes(def.risk)) {
        throw new ValidationError("operation.risk is not a known risk level");
    }
    if (def.requiredCapabilities.length === 0 ||
        !def.requiredCapabilities.every(isExecutionCapability)) {
        throw new ValidationError("operation.requiredCapabilities must list known execution capabilities");
    }
    if (def.optionalCapabilities &&
        !def.optionalCapabilities.every(isExecutionCapability)) {
        throw new ValidationError("operation.optionalCapabilities must be known");
    }
    if (def.timeoutMs !== undefined &&
        (!Number.isInteger(def.timeoutMs) ||
            def.timeoutMs <= 0 ||
            def.timeoutMs > LIMIT_CEILINGS.operationTimeoutMs)) {
        throw new ValidationError("operation.timeoutMs must be bounded");
    }
    if (def.networkAccess === "approved_hosts" &&
        !def.requiredCapabilities.includes("network.outbound.allowed-host")) {
        throw new ValidationError("network access requires the network.outbound.allowed-host capability");
    }
    for (const [name, field] of Object.entries(def.input)) {
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) {
            throw new ValidationError(`operation.input.${name} is not a valid name`);
        }
        if (field.kind === "enum" && field.values.length === 0) {
            throw new ValidationError(`operation.input.${name} needs enum values`);
        }
        if (field.kind === "text" &&
            (!Number.isInteger(field.maxBytes) ||
                field.maxBytes <= 0 ||
                field.maxBytes > MAX_INVOCATION_TEXT_BYTES)) {
            throw new ValidationError(`operation.input.${name} needs bounded maxBytes`);
        }
    }
}
export function validateExecutionPolicy(policy) {
    requireExecutionId(policy.policyId, "policy.policyId");
    if (!Number.isInteger(policy.version) || policy.version < 1) {
        throw new ValidationError("policy.version must be a positive integer");
    }
    if (!EXECUTION_RISK_LEVELS.includes(policy.maxRisk) ||
        !EXECUTION_RISK_LEVELS.includes(policy.approvalRequiredAtOrAbove)) {
        throw new ValidationError("policy risk levels must be known levels");
    }
    validateResourceLimits(policy.defaultLimits, "policy.defaultLimits");
    validateNetworkPolicy(policy.network, "policy.network");
    if (!Number.isInteger(policy.grantTtlMs) ||
        policy.grantTtlMs <= 0 ||
        policy.grantTtlMs > LIMIT_CEILINGS.sessionTimeoutMs) {
        throw new ValidationError("policy.grantTtlMs must be bounded");
    }
    if (!policy.forbiddenCapabilities.every(isExecutionCapability)) {
        throw new ValidationError("policy.forbiddenCapabilities must be known");
    }
    const ids = new Set();
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
            throw new ValidationError(`policy rule ${rule.id} has unknown capabilities`);
        }
        if (rule.network)
            validateNetworkPolicy(rule.network, `rule ${rule.id}`);
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
/** A grant applies only to the exact context it was issued for. */
export function grantAllows(grant, use) {
    return (grant.sessionId === use.sessionId &&
        grant.projectId === use.projectId &&
        grant.agentId === use.agentId &&
        grant.environmentInstanceId === use.environmentInstanceId &&
        grant.workspaceId === use.workspaceId &&
        grant.toolId === use.toolId &&
        grant.operationId === use.operationId &&
        grant.capability === use.capability &&
        Date.parse(use.at) < Date.parse(grant.expiresAt));
}
/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */
export const WORKSPACE_STATUSES = [
    "requested",
    "prepared",
    "released",
];
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
];
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
];
export const TERMINAL_SESSION_STATUSES = [
    "cancelled",
    "succeeded",
    "failed",
    "timed_out",
    "denied",
];
/** Strict lifecycle. Terminal states have no exits — retries are new attempts. */
export const SESSION_TRANSITIONS = {
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
export function isTerminalSession(status) {
    return TERMINAL_SESSION_STATUSES.includes(status);
}
export function canTransitionSession(from, to) {
    return SESSION_TRANSITIONS[from].includes(to);
}
export const ATTEMPT_STATUSES = [
    "pending",
    "running",
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
];
export const EXIT_CLASSIFICATIONS = [
    "success",
    "tool_failure",
    "timeout",
    "cancelled",
    "resource_limit",
    "sandbox_failure",
    "denied",
];
export const EXECUTION_REQUEST_KEYS = [
    "projectId",
    "planId",
    "planVersion",
    "stageId",
    "operationId",
    "operationIds",
    "input",
];
function validateOperationIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
        throw new ValidationError("operationIds must list 1-20 operations");
    }
    const ids = value.map((v, i) => requireExecutionId(v, `operationIds[${i}]`));
    if (new Set(ids).size !== ids.length) {
        throw new ValidationError("operationIds must not repeat");
    }
    return ids;
}
export function validateExecutionRequest(value) {
    if (!isRecord(value)) {
        throw new ValidationError("execution request must be an object");
    }
    rejectUnknownKeys(value, EXECUTION_REQUEST_KEYS, "execution request");
    const planVersion = value.planVersion;
    if (typeof planVersion !== "number" ||
        !Number.isInteger(planVersion) ||
        planVersion < 1) {
        throw new ValidationError("planVersion must be a positive integer");
    }
    const input = value.input;
    if (input !== undefined) {
        if (!isRecord(input))
            throw new ValidationError("input must be an object");
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
        ...(value.operationIds !== undefined
            ? { operationIds: validateOperationIds(value.operationIds) }
            : {}),
        ...(input !== undefined
            ? { input: input }
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
];
export const INVOCATION_REQUEST_KEYS = [
    "sessionId",
    "invocationId",
    "toolId",
    "operationId",
    "input",
];
export function validateInvocationRequest(value) {
    if (!isRecord(value)) {
        throw new ValidationError("invocation request must be an object");
    }
    rejectUnknownKeys(value, INVOCATION_REQUEST_KEYS, "invocation request");
    const input = value.input;
    if (input !== undefined) {
        if (!isRecord(input))
            throw new ValidationError("input must be an object");
        for (const [key, v] of Object.entries(input)) {
            if (typeof v !== "string" && typeof v !== "number") {
                throw new ValidationError(`input.${key} must be a string or number`);
            }
            // Hard ceiling; each operation schema sets its own (smaller) bounds.
            if (typeof v === "string" && v.length > MAX_INVOCATION_TEXT_BYTES) {
                throw new ValidationError(`input.${key} is too long`);
            }
        }
    }
    return {
        sessionId: requireExecutionId(value.sessionId, "sessionId"),
        invocationId: requireExecutionId(value.invocationId, "invocationId"),
        toolId: requireExecutionId(value.toolId, "toolId"),
        operationId: requireExecutionId(value.operationId, "operationId"),
        ...(input !== undefined
            ? { input: input }
            : {}),
    };
}
