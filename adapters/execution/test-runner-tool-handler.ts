/**
 * `tests.run` tool-action handler (R2).
 *
 * A thin façade on `GovernedProcessToolHandler` that forces the capability
 * surface to the test-runner contract: a known test command, bounded
 * duration, structured success/failure. The project may configure which
 * command it wants via `TestRunnerConfig.command`; the fallback is
 * `npm test` which the default `CommandPolicy` allows.
 */
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
import {
  GovernedProcessToolHandler,
  type GovernedProcessOutput,
  type GovernedProcessToolHandlerOptions,
} from "./governed-process-tool-handler.js";

export interface TestRunInput {
  readonly executableId?: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
}

export interface TestRunOutput extends GovernedProcessOutput {
  readonly passed: boolean;
}

export interface TestRunnerToolHandlerOptions extends GovernedProcessToolHandlerOptions {
  readonly defaultExecutableId?: string;
  readonly defaultArgs?: readonly string[];
  readonly defaultTimeoutMs?: number;
}

export class TestRunnerToolHandler {
  private readonly process: GovernedProcessToolHandler;
  private readonly defaultExecutableId: string;
  private readonly defaultArgs: readonly string[];
  private readonly defaultTimeoutMs: number;

  constructor(options: TestRunnerToolHandlerOptions) {
    this.process = new GovernedProcessToolHandler(options);
    this.defaultExecutableId = options.defaultExecutableId ?? "npm";
    this.defaultArgs = options.defaultArgs ?? ["test"];
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10 * 60 * 1000;
  }

  async run(
    lease: WorkspaceAccess,
    input: TestRunInput,
    signal?: AbortSignal,
  ): Promise<TestRunOutput> {
    const result = await this.process.run(
      lease,
      {
        executableId: input.executableId ?? this.defaultExecutableId,
        args: input.args ?? this.defaultArgs,
        timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      },
      signal,
    );
    return { ...result, passed: result.exitCode === 0 && !result.timedOut };
  }
}
