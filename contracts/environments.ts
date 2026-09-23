/**
 * Environment Orchestration contracts — the EO-1 / EO-2A shared vocabulary.
 *
 * These are pure types and validators with NO dependency on any probe, tool,
 * operating-system API, shell, or infrastructure. The definitions here separate
 * the five concepts the foundation is built on:
 *
 *   Architecture | EnvironmentDescriptor (type support) – what we *can* support
 *     vs        | EnvironmentInstance       – what is *installed*
 *   Environment | Host                      – the machine
 *   Capability  | CapabilityDeclaration     – whether a host can perform a task
 *   Readiness   | Availability              – whether it is currently usable
 *
 * Detection is deterministic: capability and availability are never inferred
 * from the operating system alone. Nothing here stores a credential, a secret,
 * a shell command supplied by a caller, or a chain-of-thought trace.
 */
import { requireArray, requireText, ValidationError } from "./index.js";

/* ------------------------------------------------------------------ */
/* Version information                                                */
/* ------------------------------------------------------------------ */

/**
 * Structured, comparison-safe software version. Pre-release and build are kept
 * as opaque strings; ordering decisions use `major`/`minor`/`patch` only.
 */
export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  preRelease?: string;
  build?: string;
}

export function parseVersion(
  value: string | null | undefined,
): VersionInfo | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  // Optional semver-ish: "20", "20.11", "20.11.1", with optional -pre +build.
  const match =
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      v,
    );
  if (!match) return undefined;
  return {
    major: Number(match[1]!),
    minor: Number(match[2] ?? "0"),
    patch: Number(match[3] ?? "0"),
    preRelease: match[4],
    build: match[5],
  };
}

export function formatVersion(version: VersionInfo): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  const pre = version.preRelease ? `-${version.preRelease}` : "";
  const build = version.build ? `+${version.build}` : "";
  return `${base}${pre}${build}`;
}

/** Numeric ordering on major/minor/patch only — pre-release/build are ignored. */
export function versionAtLeast(
  actual: VersionInfo | undefined,
  minimum: VersionInfo,
): boolean {
  if (!actual) return false;
  return (
    actual.major > minimum.major ||
    (actual.major === minimum.major &&
      (actual.minor > minimum.minor ||
        (actual.minor === minimum.minor && actual.patch >= minimum.patch)))
  );
}

/* ------------------------------------------------------------------ */
/* Operating system                                                   */
/* ------------------------------------------------------------------ */

export const OS_NAMES = ["windows", "macos", "linux"] as const;
export type OsName = (typeof OS_NAMES)[number];

export const ARCHITECTURES = [
  "x64",
  "arm64",
  "x86",
  "arm",
  "universal",
  "unknown",
] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

/** Deterministic, minimal OS identity. Never a discovery source by itself. */
export interface OperatingSystem {
  os: OsName;
  /** Free-form like `"11"`, `"14.5"`, `"22.04"`. Optional and never parsed. */
  version?: string;
  architecture: Architecture;
}

export function validateOperatingSystem(
  os: OperatingSystem,
  field = "os",
): void {
  if (!os || typeof os !== "object") {
    throw new ValidationError(`${field} must be an object`);
  }
  if (!OS_NAMES.includes(os.os)) {
    throw new ValidationError(
      `${field}.os must be one of ${OS_NAMES.join(", ")}`,
    );
  }
  if (!ARCHITECTURES.includes(os.architecture)) {
    throw new ValidationError(
      `${field}.architecture must be one of ${ARCHITECTURES.join(", ")}`,
    );
  }
  if (os.version !== undefined && typeof os.version !== "string") {
    throw new ValidationError(`${field}.version must be a string`);
  }
}

/* ------------------------------------------------------------------ */
/* Host                                                               */
/* ------------------------------------------------------------------ */

export const HOST_TYPES = [
  "local_workstation",
  "dedicated_runner",
  "cloud_runner",
  "container_host",
  "mac_build_host",
] as const;
export type HostType = (typeof HOST_TYPES)[number];

export const TRUST_LEVELS = ["declared", "detected", "verified"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const AVAILABILITIES = [
  "available",
  "unavailable",
  "degraded",
  "disabled",
] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/**
 * Declared machine identity — the *intent* to have a host. It says nothing
 * about whether the machine is reachable, what is installed, or what it can do.
 */
export interface HostDescriptor {
  id: string;
  name: string;
  hostType: HostType;
  os: OperatingSystem;
  /** How the host identity itself was established. */
  trustLevel: TrustLevel;
  /** Cost center for cloud/gpu/ephemeral machines. Never a secret. */
  costCenter?: string;
  safeMetadata?: Record<string, unknown>;
}

/**
 * A registered, real machine. Availability is only ever set by live detection
 * or an explicit operational action — never derived from the descriptor.
 */
export interface HostInstance {
  id: string;
  hostId: string;
  name: string;
  hostType: HostType;
  os: OperatingSystem;
  trustLevel: TrustLevel;
  availability: Availability;
  capabilities: readonly CapabilityDeclaration[];
  /** Stable fingerprint across detection runs (idempotency key). */
  fingerprint: string;
  lastDetectedAt?: string;
  lastVerifiedAt?: string;
  lastHealthCheckAt?: string;
  costCenter?: string;
  safeMetadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                       */
/* ------------------------------------------------------------------ */

export const CAPABILITY_IDS = [
  "command_execution_available",
  "container_runtime_available",
  "web_build_capable",
  "desktop_build_capable",
  "mobile_build_capable",
  "game_build_capable",
  "gpu_available",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** A typed, evidenced statement about what a host can perform right now. */
export interface CapabilityDeclaration {
  capability: CapabilityId;
  available: boolean;
  /** Short, safe human-readable source of the statement. */
  evidence?: string;
  /** Bounded safe detail. Never a credential or path dump. */
  detail?: string;
}

export function validateCapabilityDeclaration(
  statement: CapabilityDeclaration,
  field = "capability",
): void {
  if (!statement || typeof statement !== "object") {
    throw new ValidationError(`${field} must be an object`);
  }
  if (!CAPABILITY_IDS.includes(statement.capability as CapabilityId)) {
    throw new ValidationError(`${field}.capability is not a known capability`);
  }
  if (typeof statement.available !== "boolean") {
    throw new ValidationError(`${field}.available must be a boolean`);
  }
}

/* ------------------------------------------------------------------ */
/* Toolchains                                                         */
/* ------------------------------------------------------------------ */

export const TOOLCHAIN_KINDS = [
  "node",
  "dotnet",
  "swift_xcode",
  "jdk_gradle",
  "android_sdk",
  "cpp_compiler",
  "unity",
  "unreal",
  "python",
  "rust",
  "go",
  "dart",
] as const;
export type ToolchainKind = (typeof TOOLCHAIN_KINDS)[number];

/** A specific, detected toolchain with structured version metadata. */
export interface ToolchainDescriptor {
  kind: ToolchainKind;
  name: string;
  version?: VersionInfo;
  /** e.g. `env.NODE` → major/minor, bundled npm under `npm`. */
  componentVersions?: Readonly<Record<string, VersionInfo>>;
  /** Safe path only (no credential or environment dump). */
  installation?: string;
}

export interface ToolchainRequirement {
  kind: ToolchainKind;
  minimum?: VersionInfo;
}

/* ------------------------------------------------------------------ */
/* Environment descriptor vs instance                                 */
/* ------------------------------------------------------------------ */

export const ENVIRONMENT_TYPES = [
  "visual_studio_code",
  "visual_studio",
  "xcode",
  "android_studio",
  "docker",
  "unity",
  "unreal_engine",
  "cli",
  "cloud_runner",
  "web_build",
  "desktop_build",
  "mobile_build",
  "game_build",
  "container_host",
] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

/**
 * EnvironmentDescriptor — *type support*. A declared, version-controlled
 * statement that the workforce can support an environment type. It does not
 * claim any machine has it installed.
 */
export interface EnvironmentDescriptor {
  id: string;
  name: string;
  description: string;
  environmentType: EnvironmentType;
  /** Toolchains a registered instance of this type is expected to provide. */
  supportedToolchains: readonly ToolchainRequirement[];
  /** Capabilities the host must already satisfy for this type to be usable. */
  requiredCapabilities: readonly CapabilityId[];
  /** Capabilities an instance of this type is expected to provide when detected. */
  declaredCapabilities?: readonly CapabilityId[];
  /** Restrictive compatibility guard. Absent = any platform. */
  minimumOs?: { os?: OsName; architecture?: Architecture };
  metadata?: Record<string, unknown>;
}

/**
 * EnvironmentInstance — a *real, detected, registered* installation on a
 * specific host. Idempotent via `fingerprint`; never created from a descriptor.
 */
export interface EnvironmentInstance {
  id: string;
  descriptorId: string;
  hostId: string;
  environmentType: EnvironmentType;
  name: string;
  version?: VersionInfo;
  installation?: string;
  availability: Availability;
  capabilities: readonly CapabilityDeclaration[];
  toolchains: readonly ToolchainDescriptor[];
  trustLevel: TrustLevel;
  /** Stable fingerprint across detection runs (dedup key). */
  fingerprint: string;
  lastDetectedAt?: string;
  lastVerifiedAt?: string;
  lastHealthCheckAt?: string;
  safeMetadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Detection                                                          */
/* ------------------------------------------------------------------ */

/**
 * A single probe result. `detected: false` is a valid, executed, truthful
 * result — absence of evidence is evidence of absence. Evidence/confidence are
 * safe and bounded; there is no chain-of-thought and no credential here.
 */
export interface DetectedEnvironment {
  environmentType: EnvironmentType;
  detected: boolean;
  version?: VersionInfo;
  installation?: string;
  toolchains: readonly ToolchainDescriptor[];
  availability: Availability;
  evidence: readonly string[];
  confidence: number;
  warnings: readonly string[];
}

/** The typed output of host capability discovery. Never fabricates availability. */
export interface CapabilityReport {
  hostId: string;
  discoveredAt: string;
  capabilities: readonly CapabilityDeclaration[];
  /** Probe ids / declared sources the report was derived from. */
  sources: readonly string[];
  warnings: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Restricted command probes                                          */
/* ------------------------------------------------------------------ */

/**
 * The ONLY way a probe may execute a process. A definition is a fixed,
 * allowlisted, parameter-less program: a bare executable name plus a fixed
 * argument list. There is NO arbitrary-`command` endpoint — callers cannot
 * supply a command, an environment, a shell, or extra arguments.
 */
export interface CommandProbeDefinition {
  id: string;
  label?: string;
  /** Bare executable basename only (e.g. `node`). Rejects paths and shell. */
  executable: string;
  /** Fixed allowlist. Never merged with caller input. */
  arguments: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  /** Exit codes treated as a clean run. Defaults to `[0]`. */
  allowedExitCodes?: readonly number[];
  /** Redact outputs matching these exact secrets. Never stored. */
  redactSecrets?: readonly string[];
}

export interface ProbeExecutionResult {
  probeId: string;
  ran: boolean;
  exitCode?: number;
  /** Bounded and redacted. */
  stdout: string;
  stderr?: string;
  outputBytes: number;
  durationMs: number;
  /** Machine-readable failure, message only — never a stack trace. */
  error?: string;
}

/** Port implemented by `adapters/execution`. Injectable for tests. */
export interface CommandProbeExecutor {
  execute(definition: CommandProbeDefinition): Promise<ProbeExecutionResult>;
}

/* ------------------------------------------------------------------ */
/* Routing                                                            */
/* ------------------------------------------------------------------ */

export interface EnvironmentRequirement {
  descriptorId?: string;
  environmentType?: EnvironmentType;
  requiredCapabilities?: readonly CapabilityId[];
  toolchains?: readonly ToolchainRequirement[];
}

export type EnvironmentRoutingOutcome =
  | { outcome: "ROUTED"; instance: EnvironmentInstance; host: HostInstance }
  | {
      outcome: "REQUIRES_PROVISIONING";
      reason: string;
      descriptorId?: string;
    }
  | { outcome: "NO_AVAILABLE_ENVIRONMENT"; reason: string };

export interface AgentQualificationResult {
  agentId: string;
  qualifies: boolean;
  reason: string;
  matchedCapability?: string;
}

export type AgentRouteResult =
  | { outcome: "ROUTED"; agentId: string; instance: EnvironmentInstance }
  | { outcome: "NOT_QUALIFIED"; agentId: string; reason: string }
  | { outcome: "REQUIRES_PROVISIONING"; agentId: string; reason: string }
  | { outcome: "NO_AVAILABLE_ENVIRONMENT"; agentId: string; reason: string };

/* ------------------------------------------------------------------ */
/* Control-plane view                                                 */
/* ------------------------------------------------------------------ */

/** Safe answer for `GET /api/hosts/:hostId/capabilities`. */
export interface HostCapabilitySnapshot {
  hostId: string;
  host: HostInstance;
  capabilities: readonly CapabilityDeclaration[];
}

/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */

export function validateToolchainDescriptor(
  toolchain: ToolchainDescriptor,
  field = "toolchain",
): void {
  requireText(toolchain.name, `${field}.name`);
  if (!TOOLCHAIN_KINDS.includes(toolchain.kind)) {
    throw new ValidationError(`${field}.kind is not a known toolchain kind`);
  }
  if (toolchain.version !== undefined) {
    const parsed = parseVersion(formatVersion(toolchain.version));
    if (!parsed) {
      throw new ValidationError(`${field}.version is not a valid version`);
    }
  }
}

export function validateToolchainRequirement(
  requirement: ToolchainRequirement,
  field = "toolchain",
): void {
  if (!TOOLCHAIN_KINDS.includes(requirement.kind)) {
    throw new ValidationError(`${field}.kind is not a known toolchain kind`);
  }
}

export function validateHostDescriptor(host: HostDescriptor): void {
  requireText(host.id, "host.id");
  requireText(host.name, "host.name");
  if (!HOST_TYPES.includes(host.hostType)) {
    throw new ValidationError(
      `host.hostType must be one of ${HOST_TYPES.join(", ")}`,
    );
  }
  validateOperatingSystem(host.os, "host.os");
  if (!TRUST_LEVELS.includes(host.trustLevel)) {
    throw new ValidationError(
      `host.trustLevel must be one of ${TRUST_LEVELS.join(", ")}`,
    );
  }
}

export function validateHostInstance(host: HostInstance): void {
  validateHostDescriptor(host);
  requireText(host.hostId, "host.hostId");
  requireText(host.fingerprint, "host.fingerprint");
  if (!AVAILABILITIES.includes(host.availability)) {
    throw new ValidationError(
      `host.availability must be one of ${AVAILABILITIES.join(", ")}`,
    );
  }
  requireArray(host.capabilities, "host.capabilities");
  host.capabilities.forEach((c, index) =>
    validateCapabilityDeclaration(c, `host.capabilities[${index}]`),
  );
}

export function validateEnvironmentDescriptor(
  descriptor: EnvironmentDescriptor,
): void {
  requireText(descriptor.id, "descriptor.id");
  requireText(descriptor.name, "descriptor.name");
  requireText(descriptor.description, "descriptor.description");
  if (
    !ENVIRONMENT_TYPES.includes(descriptor.environmentType as EnvironmentType)
  ) {
    throw new ValidationError(
      `descriptor.environmentType is not a known environment type`,
    );
  }
  requireArray(
    descriptor.supportedToolchains,
    "descriptor.supportedToolchains",
  );
  descriptor.supportedToolchains.forEach((t, index) =>
    validateToolchainRequirement(t, `descriptor.supportedToolchains[${index}]`),
  );
  requireArray(
    descriptor.requiredCapabilities,
    "descriptor.requiredCapabilities",
  );
  descriptor.requiredCapabilities.forEach((c, index) => {
    if (!CAPABILITY_IDS.includes(c)) {
      throw new ValidationError(
        `descriptor.requiredCapabilities[${index}] is not a known capability`,
      );
    }
  });
  descriptor.declaredCapabilities?.forEach((c) => {
    if (!CAPABILITY_IDS.includes(c)) {
      throw new ValidationError(
        "descriptor.declaredCapabilities contains an unknown capability",
      );
    }
  });
  if (descriptor.minimumOs !== undefined) {
    if (
      descriptor.minimumOs.os !== undefined &&
      !OS_NAMES.includes(descriptor.minimumOs.os)
    ) {
      throw new ValidationError("descriptor.minimumOs.os is not a known OS");
    }
    if (
      descriptor.minimumOs.architecture !== undefined &&
      !ARCHITECTURES.includes(descriptor.minimumOs.architecture)
    ) {
      throw new ValidationError(
        "descriptor.minimumOs.architecture is not a known architecture",
      );
    }
  }
}

export function validateEnvironmentInstance(
  instance: EnvironmentInstance,
): void {
  requireText(instance.id, "instance.id");
  requireText(instance.descriptorId, "instance.descriptorId");
  requireText(instance.hostId, "instance.hostId");
  requireText(instance.name, "instance.name");
  requireText(instance.fingerprint, "instance.fingerprint");
  if (
    !ENVIRONMENT_TYPES.includes(instance.environmentType as EnvironmentType)
  ) {
    throw new ValidationError("instance.environmentType is not known");
  }
  if (!AVAILABILITIES.includes(instance.availability)) {
    throw new ValidationError(
      `instance.availability must be one of ${AVAILABILITIES.join(", ")}`,
    );
  }
  if (!TRUST_LEVELS.includes(instance.trustLevel)) {
    throw new ValidationError(
      `instance.trustLevel must be one of ${TRUST_LEVELS.join(", ")}`,
    );
  }
  requireArray(instance.capabilities, "instance.capabilities");
  instance.capabilities.forEach((c, index) =>
    validateCapabilityDeclaration(c, `instance.capabilities[${index}]`),
  );
  requireArray(instance.toolchains, "instance.toolchains");
  instance.toolchains.forEach((t, index) =>
    validateToolchainDescriptor(t, `instance.toolchains[${index}]`),
  );
}

export function validateDetectedEnvironment(
  detected: DetectedEnvironment,
): void {
  if (
    !ENVIRONMENT_TYPES.includes(detected.environmentType as EnvironmentType)
  ) {
    throw new ValidationError("detected.environmentType is not known");
  }
  if (typeof detected.detected !== "boolean") {
    throw new ValidationError("detected.detected must be a boolean");
  }
  if (
    !AVAILABILITIES.includes(detected.availability) &&
    detected.availability !== undefined
  ) {
    throw new ValidationError("detected.availability is not known");
  }
  requireArray(detected.evidence, "detected.evidence");
  requireArray(detected.warnings, "detected.warnings");
  requireArray(detected.toolchains, "detected.toolchains");
  detected.toolchains.forEach((t, index) =>
    validateToolchainDescriptor(t, `detected.toolchains[${index}]`),
  );
  if (
    typeof detected.confidence !== "number" ||
    detected.confidence < 0 ||
    detected.confidence > 1
  ) {
    throw new ValidationError(
      "detected.confidence must be a number between 0 and 1",
    );
  }
}

export function validateCommandProbeDefinition(
  definition: CommandProbeDefinition,
): void {
  requireText(definition.id, "probe.id");
  requireText(definition.executable, "probe.executable");
  // Bare executable basename only — rejects paths, shell metacharacters, "..".
  if (!/^[A-Za-z0-9._-]+$/.test(definition.executable)) {
    throw new ValidationError(
      "probe.executable must be a bare executable basename",
    );
  }
  if (definition.executable === "." || definition.executable === "..") {
    throw new ValidationError("probe.executable must not be a dot path");
  }
  requireArray(definition.arguments, "probe.arguments");
  definition.arguments.forEach((arg) => {
    if (typeof arg !== "string") {
      throw new ValidationError("probe.arguments must be strings");
    }
  });
  if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
    throw new ValidationError("probe.timeoutMs must be a positive number");
  }
  if (
    !Number.isFinite(definition.maxOutputBytes) ||
    definition.maxOutputBytes <= 0
  ) {
    throw new ValidationError("probe.maxOutputBytes must be a positive number");
  }
  definition.allowedExitCodes?.forEach((code) => {
    if (!Number.isInteger(code)) {
      throw new ValidationError("probe.allowedExitCodes must be integers");
    }
  });
}

export function validateEnvironmentRequirement(
  requirement: EnvironmentRequirement,
): void {
  if (!requirement || typeof requirement !== "object") {
    throw new ValidationError("environment requirement must be an object");
  }
  if (
    requirement.descriptorId === undefined &&
    requirement.environmentType === undefined &&
    requirement.requiredCapabilities === undefined &&
    requirement.toolchains === undefined
  ) {
    throw new ValidationError(
      "environment requirement must name a descriptor, type, capability, or toolchain",
    );
  }
  requirement.requiredCapabilities?.forEach((c) => {
    if (!CAPABILITY_IDS.includes(c)) {
      throw new ValidationError(
        "environment requirement references an unknown capability",
      );
    }
  });
  requirement.toolchains?.forEach((t, index) =>
    validateToolchainRequirement(t, `requirement.toolchains[${index}]`),
  );
}
