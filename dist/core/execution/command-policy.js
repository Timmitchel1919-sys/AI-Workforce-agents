/**
 * Governed command policy (R2 process runner).
 *
 * The worker never evaluates a raw shell string. A `CommandDescriptor` is a
 * normalized, structured call that the policy evaluates against:
 *
 *   - executable allowlist
 *   - argument-shape allowlist (per-executable, exact or regex)
 *   - cwd confinement (must be the current workspace root)
 *   - environment-variable allowlist (passthrough only; no secret values here)
 *   - timeout ceiling
 *
 * The returned decision is one of `allowed`, `denied`, or `requires_approval`.
 */
import { ValidationError } from "../../contracts/index.js";
export const DEFAULT_COMMAND_POLICY = Object.freeze({
    // A deliberately tiny initial allowlist. Expanding this is a policy
    // decision — never a code change that quietly ships new shell power.
    allowedExecutables: Object.freeze([
        Object.freeze({
            executable: "node",
            argPatterns: Object.freeze([
                // `node --version` — a safe liveness/sanity probe
                Object.freeze(["--version"]),
            ]),
            maxTimeoutMs: 10_000,
            riskLevel: "low",
        }),
        Object.freeze({
            executable: "npm",
            argPatterns: Object.freeze([
                Object.freeze(["--version"]),
                Object.freeze(["test"]),
                Object.freeze(["run", /^[a-z][a-z0-9:_-]{0,63}$/]),
            ]),
            maxTimeoutMs: 10 * 60 * 1000,
            riskLevel: "medium",
        }),
    ]),
    maxArgLength: 256,
    maxArgs: 32,
    defaultMaxTimeoutMs: 60_000,
    envAllowlist: Object.freeze(["PATH", "HOME", "LANG", "LC_ALL", "CI", "NODE_ENV"]),
});
export function evaluateCommand(descriptor, policy = DEFAULT_COMMAND_POLICY) {
    if (!descriptor.executable || typeof descriptor.executable !== "string") {
        return { outcome: "denied", reason: "executable missing" };
    }
    if (!Array.isArray(descriptor.args)) {
        return { outcome: "denied", reason: "args must be an array" };
    }
    if (descriptor.args.length > policy.maxArgs) {
        return {
            outcome: "denied",
            reason: `too many args (${descriptor.args.length} > ${policy.maxArgs})`,
        };
    }
    for (const arg of descriptor.args) {
        if (typeof arg !== "string") {
            return { outcome: "denied", reason: "arg must be a string" };
        }
        if (arg.length > policy.maxArgLength) {
            return { outcome: "denied", reason: "arg too long" };
        }
        if (arg.includes("\u0000")) {
            return { outcome: "denied", reason: "arg contains null byte" };
        }
    }
    const allowed = policy.allowedExecutables.find((candidate) => candidate.executable === descriptor.executable);
    if (!allowed) {
        return {
            outcome: "denied",
            reason: `executable not in allowlist: ${descriptor.executable}`,
        };
    }
    if (allowed.argPatterns && allowed.argPatterns.length > 0) {
        const matched = allowed.argPatterns.some((pattern) => matchesArgPattern(descriptor.args, pattern));
        if (!matched) {
            return {
                outcome: "denied",
                reason: `args do not match any allowed pattern for ${descriptor.executable}`,
            };
        }
    }
    const maxTimeout = allowed.maxTimeoutMs ?? policy.defaultMaxTimeoutMs;
    if (descriptor.timeoutMs > maxTimeout) {
        return {
            outcome: "denied",
            reason: `timeout ${descriptor.timeoutMs}ms exceeds max ${maxTimeout}ms`,
        };
    }
    if (descriptor.env) {
        for (const key of Object.keys(descriptor.env)) {
            if (!policy.envAllowlist.includes(key)) {
                return {
                    outcome: "denied",
                    reason: `env variable not in allowlist: ${key}`,
                };
            }
        }
    }
    if (allowed.requiresApproval) {
        return {
            outcome: "requires_approval",
            reason: `${descriptor.executable} requires explicit approval`,
        };
    }
    return { outcome: "allowed" };
}
function matchesArgPattern(args, pattern) {
    if (args.length !== pattern.length)
        return false;
    return args.every((arg, index) => {
        const expected = pattern[index];
        if (typeof expected === "string")
            return arg === expected;
        return expected.test(arg);
    });
}
export function validateCommandDescriptor(descriptor) {
    if (!descriptor.executable) {
        throw new ValidationError("command descriptor: executable required");
    }
    if (!descriptor.cwd) {
        throw new ValidationError("command descriptor: cwd required");
    }
    if (typeof descriptor.timeoutMs !== "number" ||
        !Number.isFinite(descriptor.timeoutMs) ||
        descriptor.timeoutMs <= 0) {
        throw new ValidationError("command descriptor: timeoutMs must be a positive number");
    }
}
