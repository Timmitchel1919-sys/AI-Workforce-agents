/**
 * WorkspaceBuildRunner — EO-4.4 host build/test runner.
 *
 * BUILD/TEST EXECUTION IS BOUNDED. It runs a registered build/test
 * operation's TRUSTED executable (absolute path from composition) with a
 * FIXED argument vector from the tool's argument template — no shell, no
 * `npm run <string>`, no agent-supplied flags — inside the session's
 * workspace root (resolved and leased by WorkspaceRepositorySandbox).
 *
 * It is honest: the project's own build/test code runs on the host, so it
 * does NOT isolate the filesystem or the network (`filesystemIsolation:
 * false`, `networkIsolation: false`). The sandbox registry only selects it
 * for `project_code` operations when a policy rule explicitly accepts that
 * risk with `trustedHostBuild`. Declared dependency paths must exist
 * (DEPENDENCY_MISSING otherwise); nothing is ever installed.
 */
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  ExecutionDeniedError,
  resolveWorkspacePath,
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
import { runBoundedProcess } from "../execution/bounded-process-runner.js";
import type { WorkspaceRepositorySandbox } from "./workspace-repository-sandbox.js";

export interface WorkspaceBuildRunnerOptions {
  workspace: WorkspaceRepositorySandbox;
  /** executableId → absolute path (trusted composition only). */
  executables: Readonly<Record<string, string>>;
  environmentInstanceIds: readonly string[];
  /** Controlled env values; only names a tool declares are passed. */
  controlledEnvironment?: Readonly<Record<string, string>>;
  maxConcurrentInvocations?: number;
}

const WINDOWS_ESSENTIALS = ["SystemRoot", "windir"] as const;

export class WorkspaceBuildRunner implements SandboxProvider {
  readonly providerId = "workspace-build-runner";
  readonly kind = "local_restricted_process" as const;
  readonly capabilities: SandboxProviderCapabilities;
  private readonly roots = new Map<string, string>();

  constructor(private readonly options: WorkspaceBuildRunnerOptions) {
    for (const [id, file] of Object.entries(options.executables)) {
      if (!path.isAbsolute(file))
        throw new Error(`trusted executable ${id} must be absolute`);
    }
    this.capabilities = {
      // Operation/session timeouts (process-tree kill), bounded output and
      // tool-call counts are enforced by this runner + the ExecutionManager;
      // artifact size is enforced when artifacts are recorded.
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
      executables: Object.keys(options.executables),
      workspaceExecution: true,
    };
  }

  isAvailableFor(environmentInstanceId: string): boolean {
    return this.options.environmentInstanceIds.includes(environmentInstanceId);
  }

  async prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace> {
    await this.options.workspace.rootForBuild(spec);
    return { ...spec.workspace, status: "prepared" };
  }

  async start(spec: SandboxSpec): Promise<SandboxHandle> {
    const root = await this.options.workspace.rootForBuild(spec);
    const sandboxId = `sbx_${randomUUID()}`;
    this.roots.set(sandboxId, root);
    return {
      sandboxId,
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
    const root = this.roots.get(handle.sandboxId);
    const file = this.options.executables[invocation.executableId];
    const denied = (
      code: ExecutionDeniedError["code"],
      detail: string,
    ): SandboxInvocationOutcome => ({
      exitClass: "denied",
      exitCode: null,
      stdout: { text: "", truncated: false, originalBytes: 0 },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: Date.now() - started,
      redactions: 0,
      denial: { code, detail },
    });
    if (!root) return denied("SANDBOX_FAILURE", "unknown build handle");
    if (!file)
      return denied(
        "TOOL_NOT_ALLOWED",
        "executable is not on the trusted build allowlist",
      );

    // Declared dependencies must already exist — never installed here.
    for (const required of invocation.requiredPaths ?? []) {
      const rel = resolveWorkspacePath(required);
      const present = await lstat(path.join(root, ...rel.split("/"))).then(
        () => true,
        () => false,
      );
      if (!present)
        return denied(
          "DEPENDENCY_MISSING",
          `required dependency path is missing: ${rel}`,
        );
    }

    const env: Record<string, string> = { CI: "1" };
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
    const run = await runBoundedProcess({
      executable: { executableId: invocation.executableId, path: file },
      argv: invocation.argv,
      cwd: root,
      env,
      timeoutMs: invocation.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
      knownSecrets: options.knownSecrets ?? [],
    });
    // Build/test logs: stdout then stderr, bounded; truncation explicit.
    const combined = [run.stdout.text, run.stderr.text]
      .filter(Boolean)
      .join("\n");
    const bounded = Buffer.from(combined, "utf8")
      .subarray(0, options.maxOutputBytes)
      .toString("utf8");
    return {
      exitClass: run.cancelled
        ? "cancelled"
        : run.timedOut
          ? "timeout"
          : run.exitCode === 0
            ? "success"
            : "tool_failure",
      exitCode: run.exitCode,
      stdout: {
        text: bounded,
        truncated:
          run.stdout.truncated ||
          run.stderr.truncated ||
          Buffer.byteLength(combined) > options.maxOutputBytes,
        originalBytes: run.stdout.originalBytes + run.stderr.originalBytes,
      },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: run.durationMs,
      redactions: run.redactions,
    };
  }

  async terminate(): Promise<void> {
    // Driven by the invocation AbortSignal (process-tree kill).
  }

  async collectOutputs(): Promise<readonly ArtifactReference[]> {
    // Artifacts are recorded by the ArtifactManager from declared paths.
    return [];
  }

  async cleanup(handle: SandboxHandle): Promise<void> {
    this.roots.delete(handle.sandboxId);
  }
}
