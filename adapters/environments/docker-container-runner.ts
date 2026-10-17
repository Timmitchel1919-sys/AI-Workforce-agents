/**
 * EO-4.5 DockerContainerRunner — a REAL isolating runner.
 *
 * Wraps a `docker run` invocation around a {@link StructuredInvocation}:
 *
 *   - the trusted docker CLI is spawned via the EO-4.2 bounded process runner
 *     (no shell, constructed environment, output caps, redaction, tree-kill);
 *   - the business executable's argv is passed to the container, never to the
 *     host — the host runs ONLY `docker` with a server-controlled argv;
 *   - every container is created with a hardened default argv: `--rm`,
 *     `--read-only`, `--network=none`, `--cap-drop=ALL`,
 *     `--security-opt=no-new-privileges`, non-root `--user`, memory / cpu /
 *     pids limits and a deterministic `--name` for cancellation;
 *   - images come from a trusted, composition-time
 *     `imagesByExecutable` map (digest-pinned per the container policy); the
 *     policy itself is re-evaluated on every call and refuses privileged,
 *     host-network, host-pid, docker-socket and device requests;
 *   - cancellation issues `docker kill` against the deterministic container
 *     name through the same bounded runner, so a stuck container cannot
 *     outlive its session.
 *
 * This runner is OFF by default: production composition only registers it
 * when a trusted `ContainerPolicy` lists approved digest-pinned images AND a
 * local docker daemon is reachable. Everything else is honestly
 * `not_configured`.
 */
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluateContainerRequest,
  type ContainerPolicy,
  type ExecutionRunner,
  type RunnerDescriptor,
  type RunnerHeartbeat,
  type RunnerJobSpec,
  type RunnerRunOptions,
  type RunnerRunResult,
  type StructuredInvocation,
} from "../../contracts/index.js";
import {
  runBoundedProcess,
  type BoundedProcessResult,
  type BoundedProcessSpec,
} from "../execution/bounded-process-runner.js";

/** A single image mapped to one business executable. */
export interface DockerImageBinding {
  /** Approved image name, exactly as it appears in {@link ContainerPolicy}. */
  readonly name: string;
  /** Approved image tag/version. */
  readonly version: string;
  /** Pinned digest (`sha256:...`); required when the policy demands it. */
  readonly digest?: string;
  /**
   * Entry point inside the container. Server-controlled; the agent never
   * supplies it. Defaults to the executableId itself, e.g. "node".
   */
  readonly entrypoint?: readonly string[];
  /** Non-root UID the container must run as. Defaults to 1000. */
  readonly uid?: number;
  /** Hard container limits — all honestly reported in the descriptor. */
  readonly limits?: {
    readonly memoryBytes?: number;
    readonly cpus?: number;
    readonly pidsLimit?: number;
  };
}

export interface DockerContainerRunnerOptions {
  readonly runnerId: string;
  /** Must equal the registered adapter id (`docker-container`). */
  readonly adapterId: string;
  readonly environmentInstanceIds: readonly string[];
  /** Verifiable local-host identity, e.g. the EO-2 host fingerprint. */
  readonly identityFingerprint: string;
  /** Absolute path to the docker CLI (resolved by trusted composition). */
  readonly dockerExecutable: string;
  /** executableId → image binding; agents never see this map. */
  readonly imagesByExecutable: Readonly<Record<string, DockerImageBinding>>;
  /** Live container policy — re-evaluated on every call. */
  readonly containerPolicy: ContainerPolicy;
  readonly capacity?: number;
  /** Injected for tests; defaults to the EO-4.2 bounded process runner. */
  readonly processRunner?: (spec: BoundedProcessSpec) => Promise<BoundedProcessResult>;
  /** Injected for tests; defaults to crypto.randomUUID. */
  readonly nameFactory?: () => string;
}

interface JobState {
  readonly controller: AbortController;
  readonly containerName: string;
}

const CONTAINER_NAME_PREFIX = "aiw-exec-";

export class DockerContainerRunner implements ExecutionRunner {
  readonly descriptor: RunnerDescriptor;
  private readonly jobs = new Map<string, JobState>();
  private readonly processRunner: (spec: BoundedProcessSpec) => Promise<BoundedProcessResult>;
  private readonly nameFactory: () => string;

  constructor(private readonly options: DockerContainerRunnerOptions) {
    if (!path.isAbsolute(options.dockerExecutable)) {
      throw new Error("docker executable must be an absolute path");
    }
    if (Object.keys(options.imagesByExecutable).length === 0) {
      throw new Error(
        "DockerContainerRunner requires at least one imagesByExecutable binding",
      );
    }
    this.processRunner = options.processRunner ?? runBoundedProcess;
    this.nameFactory =
      options.nameFactory ?? (() => `${CONTAINER_NAME_PREFIX}${randomUUID()}`);
    const enforcedLimits: Array<
      | "sessionTimeoutMs"
      | "operationTimeoutMs"
      | "maxOutputBytes"
      | "maxArtifactBytes"
      | "maxToolCalls"
      | "memoryBytes"
      | "cpuMillicores"
      | "maxProcesses"
    > = [
      "sessionTimeoutMs",
      "operationTimeoutMs",
      "maxOutputBytes",
      "maxArtifactBytes",
      "maxToolCalls",
    ];
    const bindings = Object.values(options.imagesByExecutable);
    if (bindings.some((b) => b.limits?.memoryBytes !== undefined)) {
      enforcedLimits.push("memoryBytes");
    }
    if (bindings.some((b) => b.limits?.cpus !== undefined)) {
      enforcedLimits.push("cpuMillicores");
    }
    if (bindings.some((b) => b.limits?.pidsLimit !== undefined)) {
      enforcedLimits.push("maxProcesses");
    }
    this.descriptor = Object.freeze<RunnerDescriptor>({
      runnerId: options.runnerId,
      adapterId: options.adapterId,
      environmentInstanceIds: options.environmentInstanceIds,
      runnerClass: "self_hosted",
      trust: "trusted",
      identity: { fingerprint: options.identityFingerprint, verified: true },
      capacity: options.capacity ?? 1,
      sandbox: {
        filesystemIsolation: true,
        networkIsolation: true,
        enforcedLimits,
        networkModes: ["deny_all"],
        supportsKill: true,
      },
    });
  }

  heartbeat(): RunnerHeartbeat {
    return { status: "online", at: new Date().toISOString() };
  }

  async healthCheck(
    signal: AbortSignal,
  ): Promise<{ ready: boolean; detail: string }> {
    const present = await access(this.options.dockerExecutable).then(
      () => true,
      () => false,
    );
    if (!present) return { ready: false, detail: "docker CLI is missing" };
    const result = await this.processRunner({
      executable: { executableId: "docker", path: this.options.dockerExecutable },
      argv: ["version", "--format", "{{.Server.Version}}"],
      cwd: os.tmpdir(),
      env: this.buildChildEnv(),
      timeoutMs: 5_000,
      maxOutputBytes: 4096,
      signal,
    });
    if (result.exitCode === 0 && !result.timedOut && !result.cancelled) {
      return {
        ready: true,
        detail: `daemon ${result.stdout.text.trim() || "online"}`,
      };
    }
    return { ready: false, detail: "docker daemon is not reachable" };
  }

  async prepare(spec: RunnerJobSpec): Promise<void> {
    this.jobs.set(spec.jobId, {
      controller: new AbortController(),
      containerName: this.nameFactory(),
    });
  }

  async run(
    jobId: string,
    invocation: StructuredInvocation,
    options: RunnerRunOptions,
  ): Promise<RunnerRunResult> {
    const job = this.jobs.get(jobId);
    const binding = this.options.imagesByExecutable[invocation.executableId];
    const blank = { text: "", truncated: false, originalBytes: 0 };
    if (!job) {
      return {
        exitClass: "denied",
        exitCode: null,
        stdout: blank,
        stderr: blank,
        durationMs: 0,
        redactions: 0,
        denial: {
          code: "TOOL_NOT_ALLOWED",
          detail: "no prepared job for this runner",
        },
      };
    }
    if (!binding) {
      return {
        exitClass: "denied",
        exitCode: null,
        stdout: blank,
        stderr: blank,
        durationMs: 0,
        redactions: 0,
        denial: {
          code: "TOOL_NOT_ALLOWED",
          detail: `executable ${invocation.executableId} has no approved image binding on this runner`,
        },
      };
    }
    const policyReasons = evaluateContainerRequest(
      {
        image: {
          name: binding.name,
          version: binding.version,
          ...(binding.digest ? { digest: binding.digest } : {}),
        },
        mounts: [],
      },
      this.options.containerPolicy,
    );
    if (policyReasons.length > 0) {
      return {
        exitClass: "denied",
        exitCode: null,
        stdout: blank,
        stderr: blank,
        durationMs: 0,
        redactions: 0,
        denial: {
          code: "CAPABILITY_NOT_GRANTED",
          detail: policyReasons[0]?.detail ?? "container policy denied",
        },
      };
    }

    const dockerArgv = this.composeDockerArgv(
      job.containerName,
      binding,
      invocation,
    );
    const signal = AbortSignal.any([options.signal, job.controller.signal]);
    const run = await this.processRunner({
      executable: {
        executableId: "docker",
        path: this.options.dockerExecutable,
      },
      argv: dockerArgv,
      cwd: os.tmpdir(),
      env: this.buildChildEnv(),
      timeoutMs: invocation.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal,
      knownSecrets: options.knownSecrets,
    });
    return {
      exitClass: run.cancelled
        ? "cancelled"
        : run.timedOut
          ? "timeout"
          : run.exitCode === 0
            ? "success"
            : "tool_failure",
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      durationMs: run.durationMs,
      redactions: run.redactions,
    };
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.controller.abort();
    try {
      await this.processRunner({
        executable: {
          executableId: "docker",
          path: this.options.dockerExecutable,
        },
        argv: ["kill", job.containerName],
        cwd: os.tmpdir(),
        env: this.buildChildEnv(),
        timeoutMs: 5_000,
        maxOutputBytes: 4096,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* already gone / daemon unreachable: nothing more we can do here */
    }
  }

  async release(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  private buildChildEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (process.platform === "win32") {
      for (const name of ["SystemRoot", "windir"] as const) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    }
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) env[process.platform === "win32" ? "USERPROFILE" : "HOME"] = home;
    return env;
  }

  /** Build the hardened `docker run` argv. Pure function, test-friendly. */
  composeDockerArgv(
    containerName: string,
    binding: DockerImageBinding,
    invocation: StructuredInvocation,
  ): string[] {
    const argv: string[] = [
      "run",
      "--rm",
      "--read-only",
      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--user=${binding.uid ?? 1000}`,
      "--pids-limit",
      String(binding.limits?.pidsLimit ?? 128),
      `--name=${containerName}`,
    ];
    if (binding.limits?.memoryBytes !== undefined) {
      argv.push(`--memory=${binding.limits.memoryBytes}`);
      argv.push(`--memory-swap=${binding.limits.memoryBytes}`);
    }
    if (binding.limits?.cpus !== undefined) {
      argv.push(`--cpus=${binding.limits.cpus}`);
    }
    argv.push(this.formatImageRef(binding));
    const entrypoint = binding.entrypoint ?? [invocation.executableId];
    argv.push(...entrypoint, ...invocation.argv);
    return argv;
  }

  private formatImageRef(binding: DockerImageBinding): string {
    const base = `${binding.name}:${binding.version}`;
    return binding.digest ? `${base}@${binding.digest}` : base;
  }
}
