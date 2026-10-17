import { GovernedProcessToolHandler, } from "./governed-process-tool-handler.js";
export class TestRunnerToolHandler {
    process;
    defaultExecutableId;
    defaultArgs;
    defaultTimeoutMs;
    constructor(options) {
        this.process = new GovernedProcessToolHandler(options);
        this.defaultExecutableId = options.defaultExecutableId ?? "npm";
        this.defaultArgs = options.defaultArgs ?? ["test"];
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10 * 60 * 1000;
    }
    async run(lease, input, signal) {
        const result = await this.process.run(lease, {
            executableId: input.executableId ?? this.defaultExecutableId,
            args: input.args ?? this.defaultArgs,
            timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
        }, signal);
        return { ...result, passed: result.exitCode === 0 && !result.timedOut };
    }
}
