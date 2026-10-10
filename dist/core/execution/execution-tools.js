/**
 * EO-4.2 execution tools: registry, bounded dispatch and output validation.
 *
 * REGISTERED TOOL ≠ AUTHORIZED TOOL ≠ AUTHORIZED OPERATION.
 *
 * - `ExecutionToolRegistry` holds trusted, composition-time tool definitions
 *   (frozen; no runtime or model-driven registration, no dynamic loading).
 * - Each execution tool is ALSO registered in the existing `ToolRegistry` via
 *   {@link registerExecutionTool}, so every invocation passes through the one
 *   bounded tool pipeline (`ToolExecutionEngine`: agent/project/environment
 *   eligibility, permission system, call ceilings, timeout, audit).
 * - The engine-facing handler never receives anything invocation-shaped from
 *   a caller: its input is an opaque, single-use reference to an invocation
 *   the ExecutionManager prepared after every gate passed.
 */
import { randomUUID } from "node:crypto";
import { ExecutionDeniedError, LIMIT_CEILINGS, ValidationError, validateExecutionToolDefinition, } from "../../contracts/index.js";
function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const entry of Object.values(value)) {
            deepFreeze(entry);
        }
    }
    return value;
}
export class ExecutionToolRegistry {
    tools = new Map();
    register(def) {
        validateExecutionToolDefinition(def);
        if (this.tools.has(def.toolId)) {
            throw new ValidationError(`execution tool ${def.toolId} is already registered`);
        }
        const frozen = deepFreeze(structuredClone(def));
        this.tools.set(def.toolId, frozen);
        return frozen;
    }
    /** Exact lookup only — unknown ids are never resolved dynamically. */
    get(toolId) {
        return this.tools.get(toolId);
    }
    list() {
        return [...this.tools.values()].sort((a, b) => a.toolId.localeCompare(b.toolId));
    }
}
/**
 * Holds prepared invocations under opaque, single-use references and runs
 * them when the ToolExecutionEngine calls the tool handler.
 */
export class BoundedInvocationDispatcher {
    prepared = new Map();
    prepare(invocation) {
        const ref = `inv_${randomUUID()}`;
        this.prepared.set(ref, invocation);
        return ref;
    }
    /** Drop a reference that was never dispatched (e.g. engine denial). */
    discard(ref) {
        this.prepared.delete(ref);
    }
    /** The ToolRegistry handler for one execution tool. */
    handlerFor(toolId) {
        return async (input) => {
            const ref = input && typeof input === "object" && !Array.isArray(input)
                ? input.invocationRef
                : undefined;
            const keys = input && typeof input === "object" ? Object.keys(input) : [];
            if (typeof ref !== "string" || keys.length !== 1) {
                throw new ExecutionDeniedError("TOOL_NOT_ALLOWED", "execution tools accept only a prepared invocation reference");
            }
            const prepared = this.prepared.get(ref);
            this.prepared.delete(ref); // single use
            if (!prepared || prepared.toolId !== toolId) {
                throw new ExecutionDeniedError("TOOL_NOT_ALLOWED", "unknown, used or foreign invocation reference");
            }
            if (prepared.handle.providerId !== prepared.provider.providerId) {
                throw new ExecutionDeniedError("SANDBOX_FAILURE", "sandbox handle mismatch");
            }
            const outcome = await prepared.provider.invoke(prepared.handle, prepared.invocation, {
                signal: prepared.signal,
                maxOutputBytes: prepared.maxOutputBytes,
                knownSecrets: prepared.knownSecrets,
            });
            return outcome;
        };
    }
}
/**
 * Trusted composition: register an execution tool in both registries. The
 * ToolRegistry entry scopes agents/projects/deployment environments; its
 * timeout/limits sit ABOVE the execution ceilings so the sandbox, not the
 * engine race, is what terminates a slow invocation.
 */
export function registerExecutionTool(tools, executionTools, dispatcher, def, scope) {
    const registered = executionTools.register(def);
    const ceiling = LIMIT_CEILINGS.operationTimeoutMs + 30_000;
    tools.register({
        id: def.toolId,
        name: def.displayName,
        description: def.description,
        version: def.version,
        capabilities: ["bounded-execution", ...def.operations],
        requiredPermission: { action: "execute" },
        allowedAgents: [...scope.allowedAgents],
        allowedProjects: [...scope.allowedProjects],
        allowedEnvironments: [...scope.allowedEnvironments],
        timeoutMs: ceiling,
        limits: {
            maxCallsPerTask: 1000,
            maxCallsPerAgent: 10_000,
            maxDurationMs: ceiling,
            maxInputBytes: 1024,
            maxOutputBytes: LIMIT_CEILINGS.maxOutputBytes * 2 + 64 * 1024,
        },
        metadata: { executionTool: true },
        execute: dispatcher.handlerFor(def.toolId),
    });
    return registered;
}
const SEMVER = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
/**
 * Validate stdout against the operation's declared output schema before it
 * reaches an agent, workflow, API or receipt. Returns the structured result.
 */
export function validateOperationOutput(spec, stdout) {
    if (!spec || spec.kind === "text")
        return {};
    if (spec.kind === "json") {
        let parsed;
        try {
            parsed = JSON.parse(stdout);
        }
        catch {
            throw new ExecutionDeniedError("INVALID_OUTPUT", "output is not valid JSON");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new ExecutionDeniedError("INVALID_OUTPUT", "output is not a JSON object");
        }
        return parsed;
    }
    const match = SEMVER.exec(stdout.trim());
    if (!match) {
        throw new ExecutionDeniedError("INVALID_OUTPUT", "output is not a single semantic version");
    }
    return { version: match[1] };
}
