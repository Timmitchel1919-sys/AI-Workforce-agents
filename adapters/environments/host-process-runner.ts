/**
 * EO-4.5 HostProcessRunner — a REAL runner on the local host.
 *
 * Runs a registered operation's trusted executable (absolute path from
 * composition) with its fixed argv through the EO-4.2 bounded process
 * runner: no shell, constructed environment, output caps, redaction,
 * process-tree kill (Windows included), timeouts. It declares NO filesystem
 * or network isolation, so the sandbox registry only selects it for
 * host-process operations that touch neither workspace nor network, unless a
 * policy explicitly accepts more (EO-4.2 / EO-4.4 rules).
 *
 * It is a runner, not a terminal: there is no method that accepts text to run.
 */
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ExecutionRunner,
  RunnerDescriptor,
  RunnerHeartbeat,
  RunnerJobSpec,
  RunnerRunOptions,
  RunnerRunResult,
  StructuredInvocation,
} from "../../contracts/index.js";
import { runBoundedProcess } from "../execution/bounded-process-runner.js";

export interface HostProcessRunnerOptions {
  runnerId: string;
  adapterId: string;
  environmentInstanceIds: readonly string[];
  /** executableId → absolute path (trusted composition only). */
  executables: Readonly<Record<string, string>>;
  /** Stable host identity (e.g. the EO-2 host fingerprint). */
  identityFingerprint: string;
  capacity?: number;
}

const WINDOWS_ESSENTIALS = ["SystemRoot", "windir"] as const;

export class HostProcessRunner implements ExecutionRunner {
  readonly descriptor: RunnerDescriptor;
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly options: HostProcessRunnerOptions) {
    for (const [id, file] of Object.entries(options.executables)) {
      if (!path.isAbsolute(file)) {
        throw new Error(`trusted executable ${id} must be an absolute path`);
      }
    }
    this.descriptor = {
      runnerId: options.runnerId,
      adapterId: options.adapterId,
      environmentInstanceIds: options.environmentInstanceIds,
      runnerClass: "local",
      trust: "trusted",
      // The local host is identified by its discovery fingerprint.
      identity: { fingerprint: options.identityFingerprint, verified: true },
      capacity: options.capacity ?? 1,
      sandbox: {
        filesystemIsolation: false,
        networkIsolation: false,
        enforcedLimits: [
          "sessionTimeoutMs",
          "operationTimeoutMs",
          "maxOutputBytes",
          "maxArtifactBytes",
          "maxToolCalls",
        ],
        networkModes: ["deny_all"],
        supportsKill: true,
      },
    };
  }

  heartbeat(): RunnerHeartbeat {
    // In-process runner: alive exactly while this process is.
    return { status: "online", at: new Date().toISOString() };
  }

  async healthCheck(): Promise<{ ready: boolean; detail: string }> {
    for (const [id, file] of Object.entries(this.options.executables)) {
      const ok = await access(file).then(
        () => true,
        () => false,
      );
      if (!ok) return { ready: false, detail: `executable ${id} is missing` };
    }
    return { ready: true, detail: "executables present" };
  }

  async prepare(spec: RunnerJobSpec): Promise<void> {
    this.jobs.set(spec.jobId, new AbortController());
  }

  async run(
    jobId: string,
    invocation: StructuredInvocation,
    options: RunnerRunOptions,
  ): Promise<RunnerRunResult> {
    const job = this.jobs.get(jobId);
    const file = this.options.executables[invocation.executableId];
    const blank = { text: "", truncated: false, originalBytes: 0 };
    if (!job || !file) {
      return {
        exitClass: "denied",
        exitCode: null,
        stdout: blank,
        stderr: blank,
        durationMs: 0,
        redactions: 0,
        denial: {
          code: "TOOL_NOT_ALLOWED",
          detail: "executable is not on this runner's allowlist",
        },
      };
    }
    const env: Record<string, string> = {};
    if (process.platform === "win32") {
      for (const name of WINDOWS_ESSENTIALS) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    }
    const signal = AbortSignal.any([options.signal, job.signal]);
    const run = await runBoundedProcess({
      executable: { executableId: invocation.executableId, path: file },
      argv: invocation.argv,
      cwd: os.tmpdir(),
      env,
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
    this.jobs.get(jobId)?.abort();
  }

  async release(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }
}
