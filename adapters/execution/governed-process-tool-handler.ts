/**
 * Governed process-run tool-action handler (R2).
 *
 * Wraps the primitive `runBoundedProcess` with:
 *
 *   1. `CommandPolicy` evaluation (allowlisted executables, allowlisted
 *      arg shapes, env allowlist, timeout ceiling).
 *   2. `TrustedExecutable` resolution — the caller provides an
 *      `executableId` (e.g. `node`, `npm`); this handler resolves it to
 *      an absolute path through a trusted `ExecutableResolver` the
 *      composition injects. Agents never supply arbitrary host paths.
 *   3. Workspace-root cwd enforcement — cwd is always the per-job
 *      workspace root, never a caller-supplied directory.
 *   4. Secret redaction (inherited from `runBoundedProcess`).
 */
import { ValidationError } from "../../contracts/index.js";
import {
  evaluateCommand,
  validateCommandDescriptor,
  type CommandDescriptor,
  type CommandPolicy,
  DEFAULT_COMMAND_POLICY,
} from "../../core/execution/command-policy.js";
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
import {
  runBoundedProcess,
  type BoundedProcessResult,
  type TrustedExecutable,
} from "./bounded-process-runner.js";

export interface GovernedProcessInput {
  readonly executableId: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly knownSecrets?: readonly string[];
  readonly maxOutputBytes?: number;
}

export interface GovernedProcessOutput {
  readonly executableId: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly durationMs: number;
  readonly stdout: BoundedProcessResult["stdout"];
  readonly stderr: BoundedProcessResult["stderr"];
  readonly redactions: number;
}

export type ExecutableResolver = (
  executableId: string,
) => TrustedExecutable | undefined;

export interface GovernedProcessToolHandlerOptions {
  readonly resolve: ExecutableResolver;
  readonly policy?: CommandPolicy;
  readonly defaultMaxOutputBytes?: number;
  /** Full environment allowlist to pass through from the host env. */
  readonly envPassthrough?: readonly string[];
}

export class GovernedProcessToolHandler {
  private readonly resolve: ExecutableResolver;
  private readonly policy: CommandPolicy;
  private readonly defaultMaxOutputBytes: number;
  private readonly envPassthrough: readonly string[];

  constructor(options: GovernedProcessToolHandlerOptions) {
    this.resolve = options.resolve;
    this.policy = options.policy ?? DEFAULT_COMMAND_POLICY;
    this.defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? 64 * 1024;
    this.envPassthrough = options.envPassthrough ?? this.policy.envAllowlist;
  }

  async run(
    lease: WorkspaceAccess,
    input: GovernedProcessInput,
    signal?: AbortSignal,
  ): Promise<GovernedProcessOutput> {
    const trusted = this.resolve(input.executableId);
    if (!trusted) {
      throw new ValidationError(
        `executable not configured: ${input.executableId}`,
      );
    }
    const descriptor: CommandDescriptor = {
      executable: input.executableId,
      args: input.args,
      cwd: lease.rootPath,
      env: input.env,
      timeoutMs: input.timeoutMs,
    };
    validateCommandDescriptor(descriptor);
    const decision = evaluateCommand(descriptor, this.policy);
    if (decision.outcome !== "allowed") {
      throw new ValidationError(`command rejected: ${decision.reason}`);
    }
    const env = this.buildEnv(input.env);
    const result = await runBoundedProcess({
      executable: trusted,
      argv: descriptor.args,
      cwd: descriptor.cwd,
      env,
      timeoutMs: descriptor.timeoutMs,
      maxOutputBytes: input.maxOutputBytes ?? this.defaultMaxOutputBytes,
      signal: signal ?? new AbortController().signal,
      knownSecrets: input.knownSecrets,
    });
    return {
      executableId: input.executableId,
      args: input.args,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      redactions: result.redactions,
    };
  }

  private buildEnv(
    overrides: Readonly<Record<string, string>> | undefined,
  ): Readonly<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const key of this.envPassthrough) {
      const value = process.env[key];
      if (typeof value === "string") env[key] = value;
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        env[key] = value;
      }
    }
    return env;
  }
}
