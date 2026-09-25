import { type Environment, type ExecutionToolDefinition, type OperationOutputSpec, type SandboxHandle, type SandboxProvider, type StructuredInvocation, type Tool } from "../../contracts/index.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
export declare class ExecutionToolRegistry {
    private readonly tools;
    register(def: ExecutionToolDefinition): ExecutionToolDefinition;
    /** Exact lookup only — unknown ids are never resolved dynamically. */
    get(toolId: string): ExecutionToolDefinition | undefined;
    list(): ExecutionToolDefinition[];
}
/** Everything a prepared invocation needs; held server-side only. */
export interface PreparedInvocation {
    /** The execution tool this invocation was prepared for. */
    toolId: string;
    provider: SandboxProvider;
    handle: SandboxHandle;
    invocation: StructuredInvocation;
    signal: AbortSignal;
    maxOutputBytes: number;
    knownSecrets: readonly string[];
}
/**
 * Holds prepared invocations under opaque, single-use references and runs
 * them when the ToolExecutionEngine calls the tool handler.
 */
export declare class BoundedInvocationDispatcher {
    private readonly prepared;
    prepare(invocation: PreparedInvocation): string;
    /** Drop a reference that was never dispatched (e.g. engine denial). */
    discard(ref: string): void;
    /** The ToolRegistry handler for one execution tool. */
    handlerFor(toolId: string): Tool["execute"];
}
/**
 * Trusted composition: register an execution tool in both registries. The
 * ToolRegistry entry scopes agents/projects/deployment environments; its
 * timeout/limits sit ABOVE the execution ceilings so the sandbox, not the
 * engine race, is what terminates a slow invocation.
 */
export declare function registerExecutionTool(tools: ToolRegistry, executionTools: ExecutionToolRegistry, dispatcher: BoundedInvocationDispatcher, def: ExecutionToolDefinition, scope: {
    allowedAgents: readonly string[];
    allowedProjects: readonly string[];
    allowedEnvironments: readonly Environment[];
}): ExecutionToolDefinition;
/**
 * Validate stdout against the operation's declared output schema before it
 * reaches an agent, workflow, API or receipt. Returns the structured result.
 */
export declare function validateOperationOutput(spec: OperationOutputSpec | undefined, stdout: string): Record<string, unknown>;
