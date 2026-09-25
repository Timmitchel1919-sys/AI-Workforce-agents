/**
 * LocalHostDiagnosticsSandbox — EO-4.2 host process provider for SAFE,
 * REGISTERED DIAGNOSTIC operations only (e.g. `node.version`).
 *
 * It is honest about what it is: it does NOT isolate the filesystem or the
 * network (`filesystemIsolation: false`, `networkIsolation: false`). The
 * sandbox registry therefore only selects it when a policy rule explicitly
 * opts in (`hostProcess: true`) AND the operation touches no workspace and no
 * network. It never runs project builds, installs, shells or scripts.
 *
 * Enforced by provider + ExecutionManager together: operation/session timeout
 * (process-tree kill), output cap, tool-call count; artifacts are never
 * collected. CPU, memory, process count and filesystem quota are NOT
 * enforced and are reported `unsupported`.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ExecutionDeniedError,
  type ArtifactReference,
  type ExecutionWorkspace,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxInvokeOptions,
  type SandboxProvider,
  type SandboxProviderCapabilities,
  type SandboxSpec,
  type StructuredInvocation,
} from "../../contracts/index.js";
import { runBoundedProcess } from "./bounded-process-runner.js";

export interface LocalHostDiagnosticsOptions {
  /** executableId → absolute path, from trusted composition only. */
  executables: Readonly<Record<string, string>>;
  /** Environment instances (on this host) the provider may serve. */
  environmentInstanceIds: readonly string[];
  /** Controlled env var values; only names an executable declares are passed. */
  controlledEnvironment?: Readonly<Record<string, string>>;
  /** Parent for per-invocation scratch directories. Default: OS temp dir. */
  scratchRoot?: string;
  maxConcurrentInvocations?: number;
}

/**
 * Minimal, non-secret variables Windows processes need to start. Note: on
 * Windows, libuv additionally injects a fixed non-secret system baseline
 * (PATH, TEMP, USERNAME, USERPROFILE, …) into every child; no credential
 * variable (API keys, cloud/Firebase credentials, tokens) is ever passed.
 */
const WINDOWS_ESSENTIALS = ["SystemRoot", "windir"] as const;

export class LocalHostDiagnosticsSandbox implements SandboxProvider {
  readonly providerId = "local-host-diagnostics";
  readonly kind = "local_restricted_process" as const;
  readonly capabilities: SandboxProviderCapabilities;
  private readonly scratch = new Map<string, string>();

  constructor(private readonly options: LocalHostDiagnosticsOptions) {
    for (const [id, file] of Object.entries(options.executables)) {
      if (!path.isAbsolute(file)) {
        throw new Error(`trusted executable ${id} must be an absolute path`);
      }
    }
    this.capabilities = {
      enforcedLimits: [
        "sessionTimeoutMs",
        "operationTimeoutMs",
        "maxOutputBytes",
        "maxArtifactBytes",
        "maxToolCalls",
      ],
      networkModes: ["deny_all"],
      networkIsolation: false,
      filesystemIsolation: false,
      supportsKill: true,
      maxConcurrentInvocations: options.maxConcurrentInvocations ?? 1,
    };
  }

  isAvailableFor(environmentInstanceId: string): boolean {
    return this.options.environmentInstanceIds.includes(environmentInstanceId);
  }

  async prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace> {
    // Diagnostics never materialize a project workspace.
    return { ...spec.workspace, status: "released" };
  }

  async start(spec: SandboxSpec): Promise<SandboxHandle> {
    const root = await realpath(this.options.scratchRoot ?? os.tmpdir());
    const dir = await realpath(await mkdtemp(path.join(root, "aiw-diag-")));
    if (path.dirname(dir) !== root) {
      await rm(dir, { recursive: true, force: true });
      throw new ExecutionDeniedError(
        "WORKSPACE_VIOLATION",
        "scratch directory escaped its root",
      );
    }
    const handle = {
      sandboxId: `sbx_${randomUUID()}`,
      providerId: this.providerId,
      sessionId: spec.sessionId,
    };
    this.scratch.set(handle.sandboxId, dir);
    return handle;
  }

  async invoke(
    handle: SandboxHandle,
    invocation: StructuredInvocation,
    options: SandboxInvokeOptions,
  ): Promise<SandboxInvocationOutcome> {
    const cwd = this.scratch.get(handle.sandboxId);
    const file = this.options.executables[invocation.executableId];
    if (!cwd)
      throw new ExecutionDeniedError(
        "SANDBOX_FAILURE",
        "unknown sandbox handle",
      );
    if (!file) {
      throw new ExecutionDeniedError(
        "TOOL_NOT_ALLOWED",
        "executable is not on the trusted allowlist",
      );
    }
    const env: Record<string, string> = {};
    if (process.platform === "win32") {
      for (const name of WINDOWS_ESSENTIALS) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    }
    for (const name of invocation.environmentVariableRefs) {
      const value = this.options.controlledEnvironment?.[name];
      if (value !== undefined) env[name] = value;
    }
    const result = await runBoundedProcess({
      executable: { executableId: invocation.executableId, path: file },
      argv: invocation.argv,
      cwd,
      env,
      timeoutMs: invocation.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
      knownSecrets: options.knownSecrets ?? [],
    });
    return {
      exitClass: result.cancelled
        ? "cancelled"
        : result.timedOut
          ? "timeout"
          : result.exitCode === 0
            ? "success"
            : "tool_failure",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      redactions: result.redactions,
    };
  }

  async terminate(): Promise<void> {
    // Termination is driven by the invocation AbortSignal (process-tree kill).
  }

  async collectOutputs(): Promise<readonly ArtifactReference[]> {
    return [];
  }

  async cleanup(handle: SandboxHandle): Promise<void> {
    const dir = this.scratch.get(handle.sandboxId);
    this.scratch.delete(handle.sandboxId);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
