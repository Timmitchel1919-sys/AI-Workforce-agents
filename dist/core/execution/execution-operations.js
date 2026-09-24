/**
 * Registered execution operations + structured input validation (EO-4.1).
 *
 * The agent-facing boundary is `{ operationId, input }`. Unknown operation →
 * deny. Input is validated field by field against the operation's declared
 * schema; unexpected properties are rejected; workspace paths are resolved
 * relative to the workspace. Model output is untrusted input: nothing here is
 * ever interpreted as a command, module name or function name.
 */
import { ExecutionDeniedError, ValidationError, validateOperationDefinition, } from "../../contracts/index.js";
import { resolveWorkspacePath } from "./workspace-paths.js";
export class ExecutionOperationRegistry {
    operations = new Map();
    register(operation) {
        validateOperationDefinition(operation);
        if (this.operations.has(operation.id)) {
            throw new ValidationError(`operation ${operation.id} is already registered`);
        }
        const frozen = Object.freeze(structuredClone(operation));
        this.operations.set(operation.id, frozen);
        return frozen;
    }
    /** Exact lookup. There is no dynamic resolution of unknown ids. */
    get(operationId) {
        return this.operations.get(operationId);
    }
    forStageKind(kind) {
        return [...this.operations.values()]
            .filter((o) => o.stageKind === kind)
            .sort((a, b) => a.id.localeCompare(b.id));
    }
    list() {
        return [...this.operations.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
}
/**
 * Validate structured input for an operation. Throws
 * `ExecutionDeniedError("INVALID_TOOL_INPUT")` for schema violations and
 * `ExecutionDeniedError("WORKSPACE_VIOLATION")` for paths escaping the workspace.
 */
export function validateOperationInput(operation, input) {
    const provided = input ?? {};
    const invalid = (detail) => new ExecutionDeniedError("INVALID_TOOL_INPUT", detail);
    const unexpected = Object.keys(provided).filter((k) => !(k in operation.input));
    if (unexpected.length > 0) {
        throw invalid(`unexpected input: ${unexpected.sort().join(", ")}`);
    }
    const out = {};
    for (const [name, field] of Object.entries(operation.input)) {
        const value = provided[name];
        if (value === undefined) {
            if (field.required)
                throw invalid(`input.${name} is required`);
            continue;
        }
        if (field.kind === "enum") {
            if (typeof value !== "string" || !field.values.includes(value)) {
                throw invalid(`input.${name} must be one of the allowed values`);
            }
            out[name] = value;
        }
        else if (field.kind === "integer") {
            if (typeof value !== "number" ||
                !Number.isInteger(value) ||
                value < field.min ||
                value > field.max) {
                throw invalid(`input.${name} must be an integer in [${field.min}, ${field.max}]`);
            }
            out[name] = value;
        }
        else {
            if (typeof value !== "string")
                throw invalid(`input.${name} must be a path`);
            const resolved = resolveWorkspacePath(value);
            if (resolved.startsWith("-")) {
                // A path that looks like a flag could be read as an option.
                throw new ExecutionDeniedError("WORKSPACE_VIOLATION", `input.${name} must not start with "-"`);
            }
            out[name] = resolved;
        }
    }
    return Object.freeze(out);
}
/**
 * Render a server-controlled executable template into a structured
 * invocation. Arguments come ONLY from the template: literals, or validated
 * enum / bounded integer / workspace-path inputs. There is no free-form
 * argument and no shell. Not executed anywhere in EO-4.1.
 */
export function buildStructuredInvocation(executable, operationId, input, workingDirectoryRef, timeoutMs) {
    const template = executable.operations[operationId];
    if (!template) {
        throw new ExecutionDeniedError("TOOL_NOT_ALLOWED", `executable ${executable.executableId} has no operation ${operationId}`);
    }
    const argv = template.map((slot) => {
        switch (slot.kind) {
            case "literal":
                return slot.value;
            case "enum_input": {
                const v = input[slot.input];
                if (typeof v !== "string" || !slot.values.includes(v)) {
                    throw new ExecutionDeniedError("INVALID_TOOL_INPUT", `argument ${slot.input} is invalid`);
                }
                return v;
            }
            case "integer_input": {
                const v = input[slot.input];
                if (typeof v !== "number" ||
                    !Number.isInteger(v) ||
                    v < slot.min ||
                    v > slot.max) {
                    throw new ExecutionDeniedError("INVALID_TOOL_INPUT", `argument ${slot.input} is invalid`);
                }
                return String(v);
            }
            case "workspace_path_input": {
                const v = input[slot.input];
                const resolved = resolveWorkspacePath(v);
                if (resolved.startsWith("-")) {
                    throw new ExecutionDeniedError("WORKSPACE_VIOLATION", `argument ${slot.input} looks like a flag`);
                }
                return resolved;
            }
        }
    });
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new ExecutionDeniedError("RESOURCE_LIMIT", "invocation must be time-bounded");
    }
    return Object.freeze({
        executableId: executable.executableId,
        operationId,
        argv: Object.freeze(argv),
        workingDirectoryRef,
        environmentVariableRefs: Object.freeze([
            ...executable.environmentVariables,
        ]),
        timeoutMs,
    });
}
