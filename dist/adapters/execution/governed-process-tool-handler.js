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
import { evaluateCommand, validateCommandDescriptor, DEFAULT_COMMAND_POLICY, } from "../../core/execution/command-policy.js";
import { runBoundedProcess, } from "./bounded-process-runner.js";
export class GovernedProcessToolHandler {
    resolve;
    policy;
    defaultMaxOutputBytes;
    envPassthrough;
    constructor(options) {
        this.resolve = options.resolve;
        this.policy = options.policy ?? DEFAULT_COMMAND_POLICY;
        this.defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? 64 * 1024;
        this.envPassthrough = options.envPassthrough ?? this.policy.envAllowlist;
    }
    async run(lease, input, signal) {
        const trusted = this.resolve(input.executableId);
        if (!trusted) {
            throw new ValidationError(`executable not configured: ${input.executableId}`);
        }
        const descriptor = {
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
    buildEnv(overrides) {
        const env = {};
        for (const key of this.envPassthrough) {
            const value = process.env[key];
            if (typeof value === "string")
                env[key] = value;
        }
        if (overrides) {
            for (const [key, value] of Object.entries(overrides)) {
                env[key] = value;
            }
        }
        return env;
    }
}
