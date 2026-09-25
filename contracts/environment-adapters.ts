/**
 * EO-4.5 — environment execution adapters & cross-platform runners.
 *
 *   ENVIRONMENT ≠ ADAPTER ≠ RUNNER ≠ SANDBOX · IDE ≠ TOOLCHAIN ·
 *   DISCOVERED ≠ EXECUTION READY · BUILD ≠ SIGN ≠ PUBLISH ·
 *   NO GENERAL-PURPOSE TERMINAL
 *
 * - EnvironmentDescriptor / EnvironmentInstance (EO-2) describe WHAT exists
 *   (discovery evidence).
 * - An EnvironmentExecutionAdapter knows how AI Workforce interacts with one
 *   environment FAMILY and decides, from authoritative instance metadata,
 *   whether a registered operation's requirement is compatible.
 * - A Runner performs bounded execution for that family (local process,
 *   self-hosted agent, cloud runner, container host).
 * - The Sandbox is the isolation boundary the runner provides and declares.
 *
 * Adapters and runners are registered by trusted composition only. Nothing
 * here accepts an adapter name, executable path or runner URL from a request.
 */
import { ValidationError } from "./index.js";
import type {
  EnvironmentInstance,
  HostInstance,
  ToolchainKind,
  ToolchainRequirement,
  VersionInfo,
} from "./environments.js";
import { formatVersion, versionAtLeast } from "./environments.js";
import type {
  ExecutionReason,
  ResourceLimitKey,
  NetworkPolicy,
  SandboxInvocationOutcome,
  SecretReference,
  StructuredInvocation,
} from "./execution.js";
import { requireExecutionId } from "./execution.js";

/* ------------------------------------------------------------------ */
/* Families                                                           */
/* ------------------------------------------------------------------ */

/**
 * Execution families. An IDE is NOT a family: Visual Studio, VS Code and
 * Android Studio projects route to the underlying toolchain family.
 */
export const ENVIRONMENT_FAMILIES = [
  "windows",
  "macos",
  "android",
  "linux",
  "docker",
  "cloud",
  "unity",
  "unreal",
] as const;
export type EnvironmentFamily = (typeof ENVIRONMENT_FAMILIES)[number];

/* ------------------------------------------------------------------ */
/* Requirements (declared on registered operations, never by requests) */
/* ------------------------------------------------------------------ */

export interface GpuRequirement {
  required: true;
  vendors?: readonly string[];
  minimumMemoryClass?: GpuMemoryClass;
  graphicsApis?: readonly string[];
  compute?: boolean;
}

export const GPU_MEMORY_CLASSES = [
  "low",
  "medium",
  "high",
  "very_high",
] as const;
export type GpuMemoryClass = (typeof GPU_MEMORY_CLASSES)[number];

/** Exact engine/toolchain version pinning (Unity, Unreal). */
export interface ExactToolchainVersion {
  kind: ToolchainKind;
  version: VersionInfo;
  /** `exact` = major.minor.patch; `major_minor` = patch may differ. */
  match: "exact" | "major_minor";
}

/** What ONE registered operation needs from an execution environment. */
export interface EnvironmentOperationRequirement {
  family: EnvironmentFamily;
  toolchains: readonly ToolchainRequirement[];
  exactVersions?: readonly ExactToolchainVersion[];
  /**
   * Platform targets / engine modules that discovery must PROVE (e.g.
   * `ios`, `android`, `windows`, a Unity build module).
   */
  targets?: readonly string[];
  gpu?: GpuRequirement;
  /** Container workload (docker family only). */
  container?: ContainerRequest;
  /** Signing is never implied by building (BUILD ≠ SIGN). */
  signing?: boolean;
  /** Publishing is never implied by building (BUILD ≠ PUBLISH). */
  publishing?: boolean;
  /** Headless/batch execution (default). GUI automation is not supported. */
  interactive?: boolean;
}

/* ------------------------------------------------------------------ */
/* Discovery metadata (EO-2 `safeMetadata.execution`)                 */
/* ------------------------------------------------------------------ */

export interface GpuDescriptor {
  vendor: string;
  memoryClass: GpuMemoryClass;
  graphicsApis: readonly string[];
  compute: boolean;
}

/**
 * Structured execution facts an EO-2 probe may attach to an instance under
 * `safeMetadata.execution`. Absent = not discovered = NOT assumed.
 */
export interface ExecutionDiscoveryMetadata {
  /** Proven platform targets / installed engine modules / SDKs. */
  targets: readonly string[];
  gpu?: GpuDescriptor;
  /** Container daemon state as last observed (docker family). */
  containerDaemon?: "operational" | "unreachable";
}

export function readExecutionDiscovery(
  instance: EnvironmentInstance,
): ExecutionDiscoveryMetadata {
  const raw = (instance.safeMetadata?.execution ?? {}) as Record<
    string,
    unknown
  >;
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter((t): t is string => typeof t === "string")
    : [];
  const gpuRaw = raw.gpu as Record<string, unknown> | undefined;
  const gpu =
    gpuRaw &&
    typeof gpuRaw.vendor === "string" &&
    GPU_MEMORY_CLASSES.includes(gpuRaw.memoryClass as GpuMemoryClass)
      ? {
          vendor: gpuRaw.vendor,
          memoryClass: gpuRaw.memoryClass as GpuMemoryClass,
          graphicsApis: Array.isArray(gpuRaw.graphicsApis)
            ? gpuRaw.graphicsApis.filter(
                (a): a is string => typeof a === "string",
              )
            : [],
          compute: gpuRaw.compute === true,
        }
      : undefined;
  const daemon = raw.containerDaemon;
  return {
    targets,
    ...(gpu ? { gpu } : {}),
    ...(daemon === "operational" || daemon === "unreachable"
      ? { containerDaemon: daemon }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Adapter                                                            */
/* ------------------------------------------------------------------ */

export interface AdapterContext {
  instance: EnvironmentInstance;
  host: HostInstance;
}

export interface ToolchainObservationEvidence {
  kind: string;
  version?: string;
}

export interface AdapterCompatibility {
  eligible: boolean;
  reasons: readonly ExecutionReason[];
  /** Toolchain versions the decision relied on (discovery evidence). */
  toolchains: readonly ToolchainObservationEvidence[];
}

/**
 * Knows how AI Workforce interacts with ONE environment family. Pure and
 * deterministic: it evaluates authoritative metadata, it never executes.
 */
export interface EnvironmentExecutionAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly family: EnvironmentFamily;
  readonly description: string;
  /** Executables this adapter's runners may serve (trusted ids only). */
  readonly executables: readonly string[];
  evaluate(
    context: AdapterContext,
    requirement: EnvironmentOperationRequirement,
  ): AdapterCompatibility;
}

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

export const RUNNER_STATUSES = [
  "online",
  "busy",
  "draining",
  "offline",
  "stale",
] as const;
export type RunnerStatus = (typeof RUNNER_STATUSES)[number];

export const RUNNER_CLASSES = [
  "local",
  "self_hosted",
  "cloud",
  "shared",
] as const;
export type RunnerClass = (typeof RUNNER_CLASSES)[number];

export interface RunnerDescriptor {
  runnerId: string;
  adapterId: string;
  /** EO-2 instances this runner executes for. */
  environmentInstanceIds: readonly string[];
  runnerClass: RunnerClass;
  trust: "trusted" | "shared_untrusted";
  /**
   * Verifiable identity (key fingerprint / attestation id). A runner is
   * never addressed by a URL from a request; unverified runners never run.
   */
  identity: { fingerprint: string; verified: boolean };
  /** Simultaneous leases. */
  capacity: number;
  /** Projects this runner may serve; absent = any project. */
  projectIds?: readonly string[];
  /** The isolation the runner's sandbox ACTUALLY enforces. */
  sandbox: {
    filesystemIsolation: boolean;
    networkIsolation: boolean;
    enforcedLimits: readonly ResourceLimitKey[];
    networkModes: readonly NetworkPolicy["mode"][];
    supportsKill: boolean;
  };
  /** Runner authentication: a reference resolved server-side only. */
  credentialRef?: SecretReference;
  /** Routing metadata for cost/security/residency — never prices. */
  routing?: {
    provider?: string;
    resourceClass?: "small" | "medium" | "large" | "gpu";
    durationClass?: "short" | "medium" | "long";
    region?: string;
    jurisdiction?: string;
    residency?: string;
  };
  /** Test/simulation runner: receipts are labelled simulated. */
  simulated?: boolean;
}

export interface RunnerHeartbeat {
  status: RunnerStatus;
  at: string;
}

export interface RunnerJobSpec {
  jobId: string;
  sessionId: string;
  projectId: string;
  environmentInstanceId: string;
  workspaceId: string;
  workspaceMode: "read_only" | "read_write";
}

export interface RunnerRunOptions {
  signal: AbortSignal;
  maxOutputBytes: number;
  knownSecrets: readonly string[];
  /** Resolved runner credential (server-side only; never serialized). */
  credential?: string;
}

/** Runner result = sandbox outcome + environment evidence it reports. */
export interface RunnerRunResult extends SandboxInvocationOutcome {
  /** Fingerprint of the source the runner actually executed. */
  sourceFingerprint?: string;
  toolchains?: readonly ToolchainObservationEvidence[];
}

/**
 * Performs bounded execution. Receives a StructuredInvocation (registered
 * executable id + fixed argv), never a command string.
 */
export interface ExecutionRunner {
  readonly descriptor: RunnerDescriptor;
  /** Latest heartbeat; undefined = never seen. */
  heartbeat(): RunnerHeartbeat | undefined;
  /** Bounded readiness probe; never arbitrary execution. */
  healthCheck(signal: AbortSignal): Promise<{ ready: boolean; detail: string }>;
  prepare(spec: RunnerJobSpec): Promise<void>;
  run(
    jobId: string,
    invocation: StructuredInvocation,
    options: RunnerRunOptions,
  ): Promise<RunnerRunResult>;
  cancel(jobId: string, reason: string): Promise<void>;
  release(jobId: string): Promise<void>;
  /** Declared-artifact transfer endpoints (optional). */
  readArtifact?(projectId: string, path: string): Promise<Uint8Array>;
  writeArtifact?(
    projectId: string,
    path: string,
    bytes: Uint8Array,
  ): Promise<{ sha256: string; size: number }>;
}

/** Environment evidence stamped on receipts (no secrets). */
export interface EnvironmentExecutionEvidence {
  environmentInstanceId: string;
  adapterId: string;
  adapterVersion: string;
  runnerId: string;
  runnerIdentity: string;
  runnerClass: RunnerClass;
  toolchains: readonly ToolchainObservationEvidence[];
  sourceFingerprint?: string;
  simulated: boolean;
}

/* ------------------------------------------------------------------ */
/* Leases                                                             */
/* ------------------------------------------------------------------ */

export interface RunnerLease {
  leaseId: string;
  runnerId: string;
  sessionId: string;
  projectId: string;
  acquiredAt: string;
  expiresAt: string;
}

/* ------------------------------------------------------------------ */
/* Containers                                                         */
/* ------------------------------------------------------------------ */

/**
 * A container workload. Mount SOURCES are symbolic (the leased workspace or
 * the artifact directory) — there is no way to name a host path.
 */
export interface ContainerRequest {
  image: { name: string; version: string; digest?: string };
  mounts: readonly {
    source: "workspace" | "artifacts";
    target: string;
    readOnly: boolean;
  }[];
  privileged?: boolean;
  hostNetwork?: boolean;
  hostPid?: boolean;
  dockerSocket?: boolean;
  devices?: readonly string[];
}

/** Trusted, per-deployment container policy. */
export interface ContainerPolicy {
  approvedImages: readonly {
    name: string;
    versions: readonly string[];
    digest?: string;
  }[];
  /** Digest pinning required for every image. */
  requireDigest: boolean;
}

/**
 * Deny-by-default container validation. Privileged mode, host networking,
 * host PID, Docker socket access and device passthrough are NEVER granted
 * by an operation request in EO-4.5.
 */
export function evaluateContainerRequest(
  request: ContainerRequest,
  policy: ContainerPolicy,
): ExecutionReason[] {
  const reasons: ExecutionReason[] = [];
  const deny = (detail: string) =>
    reasons.push({ code: "CONTAINER_POLICY_DENIED", detail });
  if (request.privileged) deny("privileged containers are not allowed");
  if (request.hostNetwork) deny("host networking is not allowed");
  if (request.hostPid) deny("the host PID namespace is not allowed");
  if (request.dockerSocket) deny("Docker socket access is never granted");
  if ((request.devices ?? []).length > 0)
    deny("device passthrough is not allowed");
  for (const mount of request.mounts) {
    if (mount.source !== "workspace" && mount.source !== "artifacts") {
      deny("only the workspace or artifact directory may be mounted");
    }
    if (
      typeof mount.target !== "string" ||
      !/^\/[A-Za-z0-9._/-]{1,200}$/.test(mount.target) ||
      mount.target.split("/").includes("..") ||
      ["/", "/proc", "/sys", "/dev", "/etc", "/var/run"].includes(
        mount.target.replace(/\/+$/, "") || "/",
      )
    ) {
      deny(`mount target ${String(mount.target).slice(0, 60)} is not allowed`);
    }
  }
  const approved = policy.approvedImages.find(
    (i) => i.name === request.image.name,
  );
  if (!approved || !approved.versions.includes(request.image.version)) {
    deny(
      `image ${request.image.name}:${request.image.version} is not approved`,
    );
  } else {
    if (policy.requireDigest && !request.image.digest)
      deny("image digest pinning is required");
    if (
      approved.digest &&
      request.image.digest &&
      approved.digest !== request.image.digest
    ) {
      deny("image digest does not match the approved digest");
    }
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Shared, platform-neutral evaluation helpers                        */
/* ------------------------------------------------------------------ */

/** Toolchain presence + minimum/exact versions from discovery evidence. */
export function evaluateToolchains(
  instance: EnvironmentInstance,
  requirement: EnvironmentOperationRequirement,
): { reasons: ExecutionReason[]; observed: ToolchainObservationEvidence[] } {
  const reasons: ExecutionReason[] = [];
  const observed: ToolchainObservationEvidence[] = [];
  for (const need of requirement.toolchains) {
    const found = instance.toolchains.find((t) => t.kind === need.kind);
    if (!found) {
      reasons.push({
        code: "TOOLCHAIN_MISSING",
        detail: `toolchain ${need.kind} was not discovered on this environment`,
      });
      continue;
    }
    observed.push({
      kind: found.kind,
      ...(found.version ? { version: formatVersion(found.version) } : {}),
    });
    if (need.minimum && !versionAtLeast(found.version, need.minimum)) {
      reasons.push({
        code: "TOOLCHAIN_VERSION_MISMATCH",
        detail: `${need.kind} ${found.version ? formatVersion(found.version) : "(unknown)"} is below ${formatVersion(need.minimum)}`,
      });
    }
    for (const component of need.components ?? []) {
      const version = found.componentVersions?.[component.name];
      if (!version) {
        reasons.push({
          code: "TOOLCHAIN_MISSING",
          detail: `${need.kind} component ${component.name} was not discovered`,
        });
      } else if (
        component.minimum &&
        !versionAtLeast(version, component.minimum)
      ) {
        reasons.push({
          code: "TOOLCHAIN_VERSION_MISMATCH",
          detail: `${need.kind} ${component.name} ${formatVersion(version)} is below ${formatVersion(component.minimum)}`,
        });
      }
    }
  }
  for (const exact of requirement.exactVersions ?? []) {
    const found = instance.toolchains.find((t) => t.kind === exact.kind);
    if (!found) {
      if (!requirement.toolchains.some((t) => t.kind === exact.kind)) {
        reasons.push({
          code: "TOOLCHAIN_MISSING",
          detail: `toolchain ${exact.kind} was not discovered on this environment`,
        });
      }
      continue;
    }
    const v = found.version;
    const matches =
      !!v &&
      v.major === exact.version.major &&
      v.minor === exact.version.minor &&
      (exact.match === "major_minor" || v.patch === exact.version.patch);
    if (!matches) {
      reasons.push({
        code: "TOOLCHAIN_VERSION_MISMATCH",
        detail: `${exact.kind} ${v ? formatVersion(v) : "(unknown)"} does not match required ${formatVersion(exact.version)} (${exact.match}); projects are never migrated silently`,
      });
    }
  }
  return { reasons, observed };
}

/** Targets/modules/SDKs must be PROVEN by discovery metadata. */
export function evaluateTargets(
  instance: EnvironmentInstance,
  requirement: EnvironmentOperationRequirement,
): ExecutionReason[] {
  const discovered = new Set(readExecutionDiscovery(instance).targets);
  return (requirement.targets ?? [])
    .filter((t) => !discovered.has(t))
    .map((t) => ({
      code: "MODULE_MISSING" as const,
      detail: `target/module ${t} was not discovered on this environment`,
    }));
}

/** GPU is only assumed when discovered — and only checked when required. */
export function evaluateGpu(
  instance: EnvironmentInstance,
  requirement: EnvironmentOperationRequirement,
): ExecutionReason[] {
  const need = requirement.gpu;
  if (!need) return [];
  const gpu = readExecutionDiscovery(instance).gpu;
  const declared = instance.capabilities.some(
    (c) => c.capability === "gpu_available" && c.available,
  );
  if (!gpu || !declared) {
    return [
      {
        code: "GPU_UNAVAILABLE",
        detail: "no GPU was discovered on this environment",
      },
    ];
  }
  const reasons: ExecutionReason[] = [];
  if (need.vendors && !need.vendors.includes(gpu.vendor)) {
    reasons.push({
      code: "GPU_UNAVAILABLE",
      detail: `GPU vendor ${gpu.vendor} is not accepted`,
    });
  }
  if (
    need.minimumMemoryClass &&
    GPU_MEMORY_CLASSES.indexOf(gpu.memoryClass) <
      GPU_MEMORY_CLASSES.indexOf(need.minimumMemoryClass)
  ) {
    reasons.push({
      code: "GPU_UNAVAILABLE",
      detail: "GPU memory class is too low",
    });
  }
  for (const api of need.graphicsApis ?? []) {
    if (!gpu.graphicsApis.includes(api)) {
      reasons.push({
        code: "GPU_UNAVAILABLE",
        detail: `graphics API ${api} is not available`,
      });
    }
  }
  if (need.compute && !gpu.compute) {
    reasons.push({
      code: "GPU_UNAVAILABLE",
      detail: "GPU compute is not available",
    });
  }
  return reasons;
}

/** Signing and publishing are separate protected capabilities. */
export function evaluateDistribution(
  requirement: EnvironmentOperationRequirement,
): ExecutionReason[] {
  const reasons: ExecutionReason[] = [];
  if (requirement.signing) {
    reasons.push({
      code: "SIGNING_NOT_AUTHORIZED",
      detail: "code signing is a separate protected capability (BUILD ≠ SIGN)",
    });
  }
  if (requirement.publishing) {
    reasons.push({
      code: "PUBLISHING_NOT_AUTHORIZED",
      detail: "publishing/upload is never automatic (BUILD ≠ PUBLISH)",
    });
  }
  if (requirement.interactive) {
    reasons.push({
      code: "ADAPTER_ERROR",
      detail:
        "interactive/GUI automation is not supported; use headless profiles",
    });
  }
  return reasons;
}

export function validateRunnerDescriptor(d: RunnerDescriptor): void {
  requireExecutionId(d.runnerId, "runner.runnerId");
  requireExecutionId(d.adapterId, "runner.adapterId");
  if (d.environmentInstanceIds.length === 0) {
    throw new ValidationError("runner must serve at least one instance");
  }
  d.environmentInstanceIds.forEach((id) =>
    requireExecutionId(id, "runner instance"),
  );
  if (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > 64) {
    throw new ValidationError("runner.capacity must be 1-64");
  }
  if (!RUNNER_CLASSES.includes(d.runnerClass)) {
    throw new ValidationError("runner.runnerClass is not known");
  }
  if (
    typeof d.identity?.fingerprint !== "string" ||
    d.identity.fingerprint === ""
  ) {
    throw new ValidationError("runner.identity.fingerprint is required");
  }
  // A runner is addressed by identity, never by a URL in its descriptor.
  if (/[a-z]+:\/\//i.test(JSON.stringify({ ...d, credentialRef: undefined }))) {
    throw new ValidationError(
      "runner descriptors must not contain endpoint URLs",
    );
  }
}
