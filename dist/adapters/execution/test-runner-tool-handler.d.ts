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
import { type GovernedProcessOutput, type GovernedProcessToolHandlerOptions } from "./governed-process-tool-handler.js";
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
export declare class TestRunnerToolHandler {
    private readonly process;
    private readonly defaultExecutableId;
    private readonly defaultArgs;
    private readonly defaultTimeoutMs;
    constructor(options: TestRunnerToolHandlerOptions);
    run(lease: WorkspaceAccess, input: TestRunInput, signal?: AbortSignal): Promise<TestRunOutput>;
}
