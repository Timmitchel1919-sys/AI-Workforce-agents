/**
 * EO-4.5 EnvironmentAdapterRegistry + runner bridge — platform NEUTRAL.
 *
 * Control Plane → ExecutionManager → EnvironmentAdapterRegistry → Adapter →
 * Runner → (declared) Sandbox. There is no `if windows / if macos` here:
 * platform knowledge lives in registered adapters; this module only
 * resolves, leases, bounds and records.
 *
 * - Adapters and runners come from trusted composition (`register*`). No
 *   adapter name, executable path or runner URL is ever taken from a request.
 * - Resolution is deterministic (sorted ids) and evidence-based: discovery
 *   says what APPEARS available; adapter + live runner + health decide what
 *   is EXECUTION READY.
 * - A runner is exposed to the ExecutionManager as a SandboxProvider that is
 *   only eligible when explicitly routed (`requiresRouting`), so a session is
 *   pinned to its runner and never silently fails over.
 */
import { createHash } from "node:crypto";
import {
  ExecutionDeniedError,
  NotFoundError,
  requireExecutionId,
  validateRunnerDescriptor,
  type ArtifactRecord,
  type ArtifactReference,
  type EnvironmentExecutionAdapter,
  type EnvironmentExecutionEvidence,
  type EnvironmentFamily,
  type ExecutionOperationDefinition,
  type ExecutionReason,
  type ExecutionRunner,
  type ExecutionWorkspace,
  type RunnerClass,
  type RunnerLease,
  type RunnerRunResult,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxInvokeOptions,
  type SandboxKind,
  type SandboxProvider,
  type SandboxProviderCapabilities,
  type SandboxSpec,
  type SecretReference,
  type StructuredInvocation,
  type ToolchainObservationEvidence,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import { createId, now } from "../shared.js";

/** Server-side resolution of runner credentials (never serialized). */
export interface RunnerCredentialResolver {
  resolve(ref: SecretReference, runnerId: string): Promise<string>;
}

/** Trusted per-project routing policy (security / residency aware). */
export interface ProjectRunnerPolicy {
  allowedRunnerClasses?: readonly RunnerClass[];
  /** Sensitive projects: never a shared/untrusted runner. */
  requireTrustedRunner?: boolean;
  allowedRegions?: readonly string[];
}

export interface EnvironmentAdapterRegistryOptions {
  environments: Pick<
    EnvironmentRegistry,
    "getInstance" | "getHost" | "listInstances"
  >;
  audit?: AuditLog;
  credentials?: RunnerCredentialResolver;
  /** Heartbeat age after which a runner is STALE. Default 60 s. */
  staleAfterMs?: number;
  /** Bounded health-check timeout. Default 5 s. */
  healthCheckTimeoutMs?: number;
  /** Disconnect watchdog poll interval. Default 1 s. */
  heartbeatPollMs?: number;
  /** Extra time a runner gets past the operation timeout. Default 2 s. */
  timeoutGraceMs?: number;
  clock?: () => string;
  idFactory?: (prefix: string) => string;
}

export interface AdapterResolution {
  ready: boolean;
  reasons: readonly ExecutionReason[];
  adapterId?: string;
  adapterVersion?: string;
  runnerId?: string;
  /** SandboxProvider id of the selected runner. */
  providerId?: string;
  toolchains: readonly ToolchainObservationEvidence[];
  rejectedRunners: readonly { runnerId: string; codes: readonly string[] }[];
  /** The adapter accepted the environment (only runners were missing). */
  compatible?: boolean;
}

export interface StageRoutingDecision {
  stageId: string;
  family: EnvironmentFamily;
  environmentInstanceId?: string;
  adapterId?: string;
  runnerId?: string;
  reasons: readonly ExecutionReason[];
}

export interface FamilyExecutionStatus {
  family: EnvironmentFamily;
  adapters: readonly { adapterId: string; version: string }[];
  /** Real (non-simulated) runner state — never reported from test doubles. */
  status:
    | "available"
    | "busy"
    | "offline"
    | "stale"
    | "not_configured"
    | "unsupported";
  realRunners: number;
  simulatedRunners: number;
}

const SANDBOX_KIND: Record<EnvironmentFamily, SandboxKind> = {
  windows: "windows_runner",
  macos: "macos_runner",
  android: "local_restricted_process",
  linux: "local_restricted_process",
  docker: "docker",
  cloud: "cloud_runner",
  unity: "game_engine_runner",
  unreal: "game_engine_runner",
};

const denied = (
  reason: ExecutionReason,
  started: number,
): SandboxInvocationOutcome => ({
  exitClass: "denied",
  exitCode: null,
  stdout: { text: "", truncated: false, originalBytes: 0 },
  stderr: { text: "", truncated: false, originalBytes: 0 },
  durationMs: Date.now() - started,
  redactions: 0,
  denial: reason,
});

export class EnvironmentAdapterRegistry {
  private readonly adapters = new Map<string, EnvironmentExecutionAdapter>();
  private readonly runners = new Map<string, ExecutionRunner>();
  private readonly providers = new Map<string, RunnerSandboxProvider>();
  private readonly leases = new Map<string, RunnerLease>();
  private readonly projectPolicies = new Map<string, ProjectRunnerPolicy>();
  readonly clock: () => string;
  readonly newId: (prefix: string) => string;

  constructor(readonly options: EnvironmentAdapterRegistryOptions) {
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
  }

  /* ---- trusted composition ------------------------------------- */

  registerAdapter(adapter: EnvironmentExecutionAdapter): void {
    requireExecutionId(adapter.adapterId, "adapterId");
    if (this.adapters.has(adapter.adapterId)) {
      throw new Error(`adapter ${adapter.adapterId} is already registered`);
    }
    this.adapters.set(adapter.adapterId, adapter);
  }

  /** Registers a runner and returns its SandboxProvider bridge. */
  registerRunner(runner: ExecutionRunner): RunnerSandboxProvider {
    const d = runner.descriptor;
    validateRunnerDescriptor(d);
    const adapter = this.adapters.get(d.adapterId);
    if (!adapter) throw new Error(`unknown adapter ${d.adapterId}`);
    if (this.runners.has(d.runnerId)) {
      throw new Error(`runner ${d.runnerId} is already registered`);
    }
    this.runners.set(d.runnerId, runner);
    const provider = new RunnerSandboxProvider(this, runner, adapter);
    this.providers.set(d.runnerId, provider);
    return provider;
  }

  setProjectPolicy(projectId: string, policy: ProjectRunnerPolicy): void {
    this.projectPolicies.set(requireExecutionId(projectId, "projectId"), {
      ...policy,
    });
  }

  getRunner(runnerId: string): ExecutionRunner | undefined {
    return this.runners.get(runnerId);
  }

  record(
    action: string,
    projectId: string | undefined,
    data: Record<string, unknown>,
  ) {
    this.options.audit?.record("execution_event", {
      ...(projectId ? { projectId } : {}),
      data: { ...data, action },
    });
  }

  /* ---- liveness, project policy, leases ------------------------ */

  /** Live = recent heartbeat in online/busy. Draining accepts no new work. */
  liveness(runner: ExecutionRunner): ExecutionReason | undefined {
    const beat = runner.heartbeat();
    if (!beat) {
      return {
        code: "RUNNER_UNAVAILABLE",
        detail: "the runner has never reported a heartbeat",
      };
    }
    const age = Date.parse(this.clock()) - Date.parse(beat.at);
    if (
      beat.status === "stale" ||
      age > (this.options.staleAfterMs ?? 60_000)
    ) {
      return {
        code: "RUNNER_UNAVAILABLE",
        detail: "the runner heartbeat is stale",
      };
    }
    if (beat.status === "offline") {
      return { code: "RUNNER_UNAVAILABLE", detail: "the runner is offline" };
    }
    if (beat.status === "draining") {
      return { code: "RUNNER_UNAVAILABLE", detail: "the runner is draining" };
    }
    return undefined;
  }

  projectDenial(
    runner: ExecutionRunner,
    projectId: string,
  ): ExecutionReason | undefined {
    const d = runner.descriptor;
    if (!d.identity.verified) {
      return {
        code: "RUNNER_IDENTITY_UNVERIFIED",
        detail: "the runner identity is not verified",
      };
    }
    if (d.projectIds && !d.projectIds.includes(projectId)) {
      return {
        code: "POLICY_DENIED",
        detail: "the runner is restricted to other projects",
      };
    }
    const policy = this.projectPolicies.get(projectId);
    if (
      policy?.allowedRunnerClasses &&
      !policy.allowedRunnerClasses.includes(d.runnerClass)
    ) {
      return {
        code: "POLICY_DENIED",
        detail: `runner class ${d.runnerClass} is not allowed for this project`,
      };
    }
    if (policy?.requireTrustedRunner && d.trust !== "trusted") {
      return {
        code: "POLICY_DENIED",
        detail: "this project requires a trusted runner",
      };
    }
    if (
      policy?.allowedRegions &&
      !(d.routing?.region && policy.allowedRegions.includes(d.routing.region))
    ) {
      return {
        code: "POLICY_DENIED",
        detail: "the runner region is not allowed for this project",
      };
    }
    return undefined;
  }

  private reclaimExpired(): void {
    const at = Date.parse(this.clock());
    for (const [id, lease] of this.leases) {
      if (Date.parse(lease.expiresAt) <= at) {
        this.leases.delete(id);
        this.record("runner_lease_expired", lease.projectId, {
          runnerId: lease.runnerId,
          leaseId: id,
          execution: lease.sessionId,
        });
      }
    }
  }

  activeLeases(runnerId: string): RunnerLease[] {
    this.reclaimExpired();
    return [...this.leases.values()].filter((l) => l.runnerId === runnerId);
  }

  /** Bounded, expiring reservation — crashed sessions never lock forever. */
  acquireLease(
    runnerId: string,
    sessionId: string,
    projectId: string,
    ttlMs: number,
  ): RunnerLease {
    const runner = this.runners.get(runnerId);
    if (!runner)
      throw new ExecutionDeniedError("RUNNER_UNAVAILABLE", "unknown runner");
    if (this.activeLeases(runnerId).length >= runner.descriptor.capacity) {
      throw new ExecutionDeniedError(
        "RESOURCE_UNAVAILABLE",
        "the runner is at capacity; retry when it has a free slot",
      );
    }
    const acquiredAt = this.clock();
    const lease: RunnerLease = {
      leaseId: this.newId("rls"),
      runnerId,
      sessionId,
      projectId,
      acquiredAt,
      expiresAt: new Date(
        Date.parse(acquiredAt) + Math.max(1, ttlMs),
      ).toISOString(),
    };
    this.leases.set(lease.leaseId, lease);
    this.record("runner_lease_acquired", projectId, {
      runnerId,
      leaseId: lease.leaseId,
      execution: sessionId,
    });
    return lease;
  }

  releaseLease(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.delete(leaseId);
    this.record("runner_lease_released", lease.projectId, {
      runnerId: lease.runnerId,
      leaseId,
      execution: lease.sessionId,
    });
  }

  /* ---- resolution ---------------------------------------------- */

  /**
   * Is this registered operation execution-ready on this instance? Checks,
   * in order: adapter for the family, instance/host availability, adapter
   * compatibility (platform, toolchains, versions, targets, GPU, container
   * policy, BUILD ≠ SIGN ≠ PUBLISH), executable, then runners (identity,
   * project policy, liveness, capacity). Deterministic.
   */
  resolve(input: {
    projectId: string;
    environmentInstanceId: string;
    operation: ExecutionOperationDefinition;
    executableId?: string;
  }): AdapterResolution {
    const requirement = input.operation.environment;
    const empty = { toolchains: [], rejectedRunners: [] };
    if (!requirement) {
      return {
        ready: false,
        reasons: [
          {
            code: "ADAPTER_ERROR",
            detail: "the operation declares no environment requirement",
          },
        ],
        ...empty,
      };
    }
    const adapters = [...this.adapters.values()]
      .filter((a) => a.family === requirement.family)
      .sort((a, b) => a.adapterId.localeCompare(b.adapterId));
    if (adapters.length === 0) {
      return {
        ready: false,
        reasons: [
          {
            code: "ADAPTER_UNAVAILABLE",
            detail: `no ${requirement.family} execution adapter is registered`,
          },
        ],
        ...empty,
      };
    }
    const instance = this.options.environments.getInstance(
      input.environmentInstanceId,
    );
    const host = instance
      ? this.options.environments.getHost(instance.hostId)
      : undefined;
    if (
      !instance ||
      !host ||
      instance.availability !== "available" ||
      host.availability !== "available"
    ) {
      return {
        ready: false,
        reasons: [
          {
            code: "ENVIRONMENT_OFFLINE",
            detail: "the environment or its host is not available",
          },
        ],
        ...empty,
      };
    }
    let firstFailure: AdapterResolution | undefined;
    for (const adapter of adapters) {
      const compat = adapter.evaluate({ instance, host }, requirement);
      const base = {
        adapterId: adapter.adapterId,
        adapterVersion: adapter.version,
        toolchains: compat.toolchains,
      };
      if (!compat.eligible) {
        firstFailure ??= {
          ready: false,
          reasons: compat.reasons,
          ...base,
          rejectedRunners: [],
        };
        continue;
      }
      if (
        input.executableId &&
        !adapter.executables.includes(input.executableId)
      ) {
        firstFailure ??= {
          ready: false,
          reasons: [
            {
              code: "ADAPTER_ERROR",
              detail: `the ${adapter.adapterId} adapter does not serve executable ${input.executableId}`,
            },
          ],
          ...base,
          rejectedRunners: [],
        };
        continue;
      }
      const runners = [...this.runners.values()]
        .filter(
          (r) =>
            r.descriptor.adapterId === adapter.adapterId &&
            r.descriptor.environmentInstanceIds.includes(instance.id),
        )
        .sort((a, b) =>
          a.descriptor.runnerId.localeCompare(b.descriptor.runnerId),
        );
      const rejected: { runnerId: string; codes: string[] }[] = [];
      const reasons: ExecutionReason[] = [];
      for (const runner of runners) {
        const reason =
          this.projectDenial(runner, input.projectId) ??
          this.liveness(runner) ??
          (this.activeLeases(runner.descriptor.runnerId).length >=
          runner.descriptor.capacity
            ? {
                code: "RESOURCE_UNAVAILABLE" as const,
                detail: "the runner is at capacity",
              }
            : undefined);
        if (reason) {
          rejected.push({
            runnerId: runner.descriptor.runnerId,
            codes: [reason.code],
          });
          reasons.push(reason);
          this.record("runner_rejected", input.projectId, {
            runnerId: runner.descriptor.runnerId,
            adapterId: adapter.adapterId,
            environmentInstanceId: instance.id,
            code: reason.code,
          });
          continue;
        }
        this.record("adapter_selected", input.projectId, {
          adapterId: adapter.adapterId,
          adapterVersion: adapter.version,
          runnerId: runner.descriptor.runnerId,
          environmentInstanceId: instance.id,
          operationId: input.operation.id,
        });
        return {
          ready: true,
          reasons: [],
          ...base,
          runnerId: runner.descriptor.runnerId,
          providerId: runnerProviderId(runner.descriptor.runnerId),
          rejectedRunners: rejected,
        };
      }
      firstFailure ??= {
        ready: false,
        compatible: true,
        reasons:
          runners.length === 0
            ? [
                {
                  code: "RUNNER_UNAVAILABLE",
                  detail: `no ${adapter.family} runner is configured for this environment`,
                },
              ]
            : reasons,
        ...base,
        rejectedRunners: rejected,
      };
    }
    return firstFailure!;
  }

  /**
   * Stage-level routing across instances (multi-environment projects).
   * Deterministic: instances are tried in id order; the first ready one wins.
   * A stage with no ready instance is reported with the reasons of the best
   * candidate — never assigned somewhere incompatible.
   */
  routeStages(
    projectId: string,
    stages: readonly {
      stageId: string;
      operation: ExecutionOperationDefinition;
      executableId?: string;
    }[],
  ): StageRoutingDecision[] {
    const instances = this.options.environments
      .listInstances()
      .sort((a, b) => a.id.localeCompare(b.id));
    return stages.map(({ stageId, operation, executableId }) => {
      const family = operation.environment?.family ?? "linux";
      let reasons: readonly ExecutionReason[] = [
        {
          code: "ENVIRONMENT_UNAVAILABLE",
          detail: "no environment instance is registered",
        },
      ];
      let bestCompatible = false;
      let haveReason = false;
      for (const instance of instances) {
        const r = this.resolve({
          projectId,
          environmentInstanceId: instance.id,
          operation,
          ...(executableId ? { executableId } : {}),
        });
        if (r.ready) {
          return {
            stageId,
            family,
            environmentInstanceId: instance.id,
            adapterId: r.adapterId!,
            runnerId: r.runnerId!,
            reasons: [],
          };
        }
        // Explain with the closest candidate: an environment the adapter
        // accepted (only runners missing) beats an incompatible platform.
        if (r.adapterId && r.reasons.length > 0) {
          if (r.compatible && !bestCompatible) {
            reasons = r.reasons;
            bestCompatible = true;
          } else if (!bestCompatible && !haveReason) {
            reasons = r.reasons;
          }
          haveReason = true;
        }
      }
      return { stageId, family, reasons };
    });
  }

  /** Authoritative per-family execution status (for API/UI). */
  status(): FamilyExecutionStatus[] {
    const families: EnvironmentFamily[] = [
      "windows",
      "macos",
      "android",
      "linux",
      "docker",
      "cloud",
      "unity",
      "unreal",
    ];
    return families.map((family) => {
      const adapters = [...this.adapters.values()]
        .filter((a) => a.family === family)
        .map((a) => ({ adapterId: a.adapterId, version: a.version }));
      const runners = [...this.runners.values()].filter(
        (r) => this.adapters.get(r.descriptor.adapterId)?.family === family,
      );
      const real = runners.filter((r) => !r.descriptor.simulated);
      let status: FamilyExecutionStatus["status"] = "not_configured";
      if (adapters.length === 0) status = "unsupported";
      else if (real.length > 0) {
        const live = real.filter((r) => !this.liveness(r));
        const free = live.filter(
          (r) =>
            r.heartbeat()?.status === "online" &&
            this.activeLeases(r.descriptor.runnerId).length <
              r.descriptor.capacity,
        );
        if (free.length > 0) status = "available";
        else if (live.length > 0) status = "busy";
        else if (real.some((r) => this.liveness(r)?.detail.includes("stale")))
          status = "stale";
        else status = "offline";
      }
      return {
        family,
        adapters,
        status,
        realRunners: real.length,
        simulatedRunners: runners.length - real.length,
      };
    });
  }
}

export const runnerProviderId = (runnerId: string) => `runner:${runnerId}`;

interface RunnerJob {
  jobId: string;
  lease: RunnerLease;
  spec: SandboxSpec;
  credential?: string;
}

/**
 * Exposes ONE runner to the ExecutionManager as a SandboxProvider. Only
 * eligible when the manager routed the operation to this exact runner.
 */
export class RunnerSandboxProvider implements SandboxProvider {
  readonly providerId: string;
  readonly kind: SandboxKind;
  readonly capabilities: SandboxProviderCapabilities;
  private readonly jobs = new Map<string, RunnerJob>();

  constructor(
    private readonly registry: EnvironmentAdapterRegistry,
    private readonly runner: ExecutionRunner,
    private readonly adapter: EnvironmentExecutionAdapter,
  ) {
    const d = runner.descriptor;
    this.providerId = runnerProviderId(d.runnerId);
    this.kind = SANDBOX_KIND[adapter.family];
    this.capabilities = {
      enforcedLimits: d.sandbox.enforcedLimits,
      networkModes: d.sandbox.networkModes,
      networkIsolation: d.sandbox.networkIsolation,
      filesystemIsolation: d.sandbox.filesystemIsolation,
      supportsKill: d.sandbox.supportsKill,
      maxConcurrentInvocations: d.capacity,
      executables: adapter.executables,
      requiresRouting: true,
      ...(d.simulated ? { simulated: true } : {}),
    };
  }

  isAvailableFor(environmentInstanceId: string): boolean {
    return (
      this.runner.descriptor.environmentInstanceIds.includes(
        environmentInstanceId,
      ) && !this.registry.liveness(this.runner)
    );
  }

  async prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace> {
    return { ...spec.workspace, status: "prepared" };
  }

  async start(spec: SandboxSpec): Promise<SandboxHandle> {
    const d = this.runner.descriptor;
    const deny =
      this.registry.projectDenial(this.runner, spec.projectId) ??
      this.registry.liveness(this.runner);
    if (deny) throw new ExecutionDeniedError(deny.code, deny.detail);
    if (!d.environmentInstanceIds.includes(spec.environmentInstanceId)) {
      throw new ExecutionDeniedError(
        "RUNNER_UNAVAILABLE",
        "the runner does not serve this environment",
      );
    }
    const lease = this.registry.acquireLease(
      d.runnerId,
      spec.sessionId,
      spec.projectId,
      spec.limits.sessionTimeoutMs,
    );
    const jobId = this.registry.newId("job");
    try {
      let credential: string | undefined;
      if (d.credentialRef) {
        const resolver = this.registry.options.credentials;
        if (!resolver)
          throw new ExecutionDeniedError(
            "RUNNER_UNAVAILABLE",
            "runner credentials cannot be resolved",
          );
        credential = await resolver.resolve(d.credentialRef, d.runnerId);
      }
      await this.runner.prepare({
        jobId,
        sessionId: spec.sessionId,
        projectId: spec.projectId,
        environmentInstanceId: spec.environmentInstanceId,
        workspaceId: spec.workspace.workspaceId,
        workspaceMode: spec.workspace.mode,
      });
      this.jobs.set(jobId, {
        jobId,
        lease,
        spec,
        ...(credential ? { credential } : {}),
      });
    } catch (error) {
      this.registry.releaseLease(lease.leaseId);
      if (error instanceof ExecutionDeniedError) throw error;
      throw new ExecutionDeniedError(
        "ADAPTER_ERROR",
        "the runner could not prepare the job",
      );
    }
    this.registry.record("runner_job_prepared", spec.projectId, {
      runnerId: d.runnerId,
      adapterId: this.adapter.adapterId,
      execution: spec.sessionId,
      jobId,
    });
    return {
      sandboxId: jobId,
      providerId: this.providerId,
      sessionId: spec.sessionId,
    };
  }

  async invoke(
    handle: SandboxHandle,
    invocation: StructuredInvocation,
    options: SandboxInvokeOptions,
  ): Promise<SandboxInvocationOutcome> {
    const started = Date.now();
    const job = this.jobs.get(handle.sandboxId);
    const d = this.runner.descriptor;
    if (!job)
      return denied(
        { code: "ADAPTER_ERROR", detail: "unknown runner job" },
        started,
      );
    // Runner went away between routing and execution: nothing runs.
    const gone = this.registry.liveness(this.runner);
    if (gone) return denied(gone, started);
    const health = await withTimeout(
      (signal) => this.runner.healthCheck(signal),
      this.registry.options.healthCheckTimeoutMs ?? 5_000,
    ).catch(() => ({
      ready: false,
      detail: "health check failed or timed out",
    }));
    if (!health.ready) {
      return denied(
        {
          code: "RUNNER_UNAVAILABLE",
          detail: `runner not ready: ${health.detail}`,
        },
        started,
      );
    }

    const projectId = job.spec.projectId;
    this.registry.record("runner_execution_started", projectId, {
      runnerId: d.runnerId,
      execution: job.spec.sessionId,
      jobId: job.jobId,
      executableId: invocation.executableId,
    });
    const controller = new AbortController();
    const knownSecrets = [
      ...(options.knownSecrets ?? []),
      ...(job.credential ? [job.credential] : []),
    ];
    type Ending =
      | { kind: "result"; result: RunnerRunResult }
      | { kind: "error" }
      | { kind: "timeout" }
      | { kind: "cancelled" }
      | { kind: "disconnected" };
    let settle!: (e: Ending) => void;
    const ending = new Promise<Ending>((resolve) => (settle = resolve));
    const onAbort = () => settle({ kind: "cancelled" });
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) settle({ kind: "cancelled" });
    const timer = setTimeout(
      () => settle({ kind: "timeout" }),
      invocation.timeoutMs + (this.registry.options.timeoutGraceMs ?? 2_000),
    );
    const watchdog = setInterval(() => {
      const lost = this.registry.liveness(this.runner);
      if (lost && lost.detail !== "the runner is draining")
        settle({ kind: "disconnected" });
    }, this.registry.options.heartbeatPollMs ?? 1_000);
    this.runner
      .run(job.jobId, invocation, {
        signal: controller.signal,
        maxOutputBytes: options.maxOutputBytes,
        knownSecrets,
        ...(job.credential ? { credential: job.credential } : {}),
      })
      .then(
        (result) => settle({ kind: "result", result }),
        () => settle({ kind: "error" }),
      );
    const end = await ending;
    clearTimeout(timer);
    clearInterval(watchdog);
    options.signal.removeEventListener("abort", onAbort);
    if (end.kind !== "result") {
      controller.abort();
      await this.runner.cancel(job.jobId, end.kind).catch(() => undefined);
    }
    const evidence: EnvironmentExecutionEvidence = {
      environmentInstanceId: job.spec.environmentInstanceId,
      adapterId: this.adapter.adapterId,
      adapterVersion: this.adapter.version,
      runnerId: d.runnerId,
      runnerIdentity: d.identity.fingerprint,
      runnerClass: d.runnerClass,
      // Runner-reported versions, else the instance's discovery evidence.
      toolchains:
        end.kind === "result" && end.result.toolchains?.length
          ? end.result.toolchains
          : (
              this.registry.options.environments.getInstance(
                job.spec.environmentInstanceId,
              )?.toolchains ?? []
            ).map((t) => ({
              kind: t.kind,
              ...(t.version
                ? {
                    version: `${t.version.major}.${t.version.minor}.${t.version.patch}`,
                  }
                : {}),
            })),
      ...(end.kind === "result" && end.result.sourceFingerprint
        ? { sourceFingerprint: end.result.sourceFingerprint }
        : {}),
      simulated: d.simulated === true,
    };
    const blank = { text: "", truncated: false, originalBytes: 0 };
    const failure = (
      exitClass: SandboxInvocationOutcome["exitClass"],
      reason: ExecutionReason,
    ): SandboxInvocationOutcome => ({
      exitClass,
      exitCode: null,
      stdout: blank,
      stderr: blank,
      durationMs: Date.now() - started,
      redactions: 0,
      denial: reason,
      environment: evidence,
    });
    let outcome: SandboxInvocationOutcome;
    switch (end.kind) {
      case "result": {
        const { sourceFingerprint: _fp, toolchains: _tc, ...rest } = end.result;
        void _fp;
        void _tc;
        // Never trust a runner to redact: scrub credential values here too.
        const scrub = (t: string) =>
          knownSecrets.reduce(
            (acc, s) => (s ? acc.split(s).join("[REDACTED]") : acc),
            t,
          );
        outcome = {
          ...rest,
          stdout: { ...rest.stdout, text: scrub(rest.stdout.text) },
          stderr: { ...rest.stderr, text: scrub(rest.stderr.text) },
          environment: evidence,
        };
        break;
      }
      case "cancelled":
        outcome = failure("cancelled", {
          code: "CANCELLED",
          detail: "cancellation propagated to the runner",
        });
        break;
      case "timeout":
        outcome = failure("timeout", {
          code: "RUNNER_TIMEOUT",
          detail: "the runner exceeded the operation timeout",
        });
        break;
      case "disconnected":
        this.registry.record("runner_disconnected", projectId, {
          runnerId: d.runnerId,
          execution: job.spec.sessionId,
          jobId: job.jobId,
        });
        outcome = failure("sandbox_failure", {
          code: "RUNNER_DISCONNECTED",
          detail: "the runner disconnected mid-operation; outcome interrupted",
        });
        break;
      default:
        outcome = failure("sandbox_failure", {
          code: "ADAPTER_ERROR",
          detail: "the runner reported an execution error",
        });
    }
    this.registry.record(
      outcome.exitClass === "success"
        ? "runner_execution_completed"
        : "runner_execution_failed",
      projectId,
      {
        runnerId: d.runnerId,
        execution: job.spec.sessionId,
        jobId: job.jobId,
        exitClass: outcome.exitClass,
        ...(outcome.denial ? { code: outcome.denial.code } : {}),
      },
    );
    return outcome;
  }

  async terminate(handle: SandboxHandle, reason: string): Promise<void> {
    if (this.jobs.has(handle.sandboxId)) {
      await this.runner.cancel(handle.sandboxId, reason).catch(() => undefined);
    }
  }

  async collectOutputs(): Promise<readonly ArtifactReference[]> {
    return [];
  }

  async cleanup(handle: SandboxHandle): Promise<void> {
    const job = this.jobs.get(handle.sandboxId);
    if (!job) return;
    this.jobs.delete(handle.sandboxId);
    await this.runner.release(job.jobId).catch(() => undefined);
    this.registry.releaseLease(job.lease.leaseId);
  }
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Artifact handoff between runners                                   */
/* ------------------------------------------------------------------ */

export interface ArtifactHandoffOptions {
  registry: EnvironmentAdapterRegistry;
  artifacts: {
    get(projectId: string, artifactId: string): ArtifactRecord | undefined;
  };
  maxBytes: number;
}

/**
 * Moves ONE declared artifact (an ArtifactRecord) from one runner to another,
 * for the intended source fingerprint only, verifying the SHA-256 on read
 * and on write. Undeclared paths cannot be transferred.
 */
export class ArtifactHandoffService {
  constructor(private readonly options: ArtifactHandoffOptions) {}

  async transfer(input: {
    projectId: string;
    artifactId: string;
    fromRunnerId: string;
    toRunnerId: string;
    expectedSourceFingerprint: string;
  }): Promise<{ artifactId: string; sha256: string; size: number }> {
    const { registry } = this.options;
    const artifact = this.options.artifacts.get(
      input.projectId,
      input.artifactId,
    );
    if (!artifact) throw new NotFoundError("resource not found");
    if (artifact.sourceFingerprint !== input.expectedSourceFingerprint) {
      throw new ExecutionDeniedError(
        "SOURCE_MISMATCH",
        "the artifact was built from a different source fingerprint",
      );
    }
    const from = registry.getRunner(input.fromRunnerId);
    const to = registry.getRunner(input.toRunnerId);
    if (!from || !to)
      throw new ExecutionDeniedError("RUNNER_UNAVAILABLE", "unknown runner");
    for (const runner of [from, to]) {
      const deny =
        registry.projectDenial(runner, input.projectId) ??
        registry.liveness(runner);
      if (deny) throw new ExecutionDeniedError(deny.code, deny.detail);
    }
    if (!from.readArtifact || !to.writeArtifact) {
      throw new ExecutionDeniedError(
        "ADAPTER_ERROR",
        "a runner does not support artifact transfer",
      );
    }
    const bytes = await from.readArtifact(input.projectId, artifact.path);
    if (bytes.byteLength > this.options.maxBytes) {
      throw new ExecutionDeniedError(
        "RESOURCE_LIMIT",
        "the artifact exceeds the transfer limit",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      digest !== artifact.digest.value ||
      bytes.byteLength !== artifact.sizeBytes
    ) {
      registry.record("artifact_handoff_rejected", input.projectId, {
        artifactId: artifact.artifactId,
        fromRunnerId: input.fromRunnerId,
        stage: "read",
      });
      throw new ExecutionDeniedError(
        "INTEGRITY_FAILED",
        "the artifact digest does not match its record",
      );
    }
    const written = await to.writeArtifact(
      input.projectId,
      artifact.path,
      bytes,
    );
    if (written.sha256 !== artifact.digest.value) {
      registry.record("artifact_handoff_rejected", input.projectId, {
        artifactId: artifact.artifactId,
        toRunnerId: input.toRunnerId,
        stage: "write",
      });
      throw new ExecutionDeniedError(
        "INTEGRITY_FAILED",
        "the receiving runner reported a different digest",
      );
    }
    registry.record("artifact_handoff_completed", input.projectId, {
      artifactId: artifact.artifactId,
      fromRunnerId: input.fromRunnerId,
      toRunnerId: input.toRunnerId,
      sha256: digest,
    });
    return {
      artifactId: artifact.artifactId,
      sha256: digest,
      size: bytes.byteLength,
    };
  }
}
