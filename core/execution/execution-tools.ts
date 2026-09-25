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
import {
  ExecutionDeniedError,
  LIMIT_CEILINGS,
  ValidationError,
  validateExecutionToolDefinition,
  type Environment,
  type ExecutionToolDefinition,
  type OperationOutputSpec,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxProvider,
  type StructuredInvocation,
  type Tool,
} from "../../contracts/index.js";
import type { ToolRegistry } from "../tools/tool-registry.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
  }
  return value;
}

export class ExecutionToolRegistry {
  private readonly tools = new Map<string, ExecutionToolDefinition>();

  register(def: ExecutionToolDefinition): ExecutionToolDefinition {
    validateExecutionToolDefinition(def);
    if (this.tools.has(def.toolId)) {
      throw new ValidationError(
        `execution tool ${def.toolId} is already registered`,
      );
    }
    const frozen = deepFreeze(structuredClone(def));
    this.tools.set(def.toolId, frozen);
    return frozen;
  }

  /** Exact lookup only — unknown ids are never resolved dynamically. */
  get(toolId: string): ExecutionToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(): ExecutionToolDefinition[] {
    return [...this.tools.values()].sort((a, b) =>
      a.toolId.localeCompare(b.toolId),
    );
  }
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
export class BoundedInvocationDispatcher {
  private readonly prepared = new Map<string, PreparedInvocation>();

  prepare(invocation: PreparedInvocation): string {
    const ref = `inv_${randomUUID()}`;
    this.prepared.set(ref, invocation);
    return ref;
  }

  /** Drop a reference that was never dispatched (e.g. engine denial). */
  discard(ref: string): void {
    this.prepared.delete(ref);
  }

  /** The ToolRegistry handler for one execution tool. */
  handlerFor(toolId: string): Tool["execute"] {
    return async (input: unknown) => {
      const ref =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>).invocationRef
          : undefined;
      const keys = input && typeof input === "object" ? Object.keys(input) : [];
      if (typeof ref !== "string" || keys.length !== 1) {
        throw new ExecutionDeniedError(
          "TOOL_NOT_ALLOWED",
          "execution tools accept only a prepared invocation reference",
        );
      }
      const prepared = this.prepared.get(ref);
      this.prepared.delete(ref); // single use
      if (!prepared || prepared.toolId !== toolId) {
        throw new ExecutionDeniedError(
          "TOOL_NOT_ALLOWED",
          "unknown, used or foreign invocation reference",
        );
      }
      if (prepared.handle.providerId !== prepared.provider.providerId) {
        throw new ExecutionDeniedError(
          "SANDBOX_FAILURE",
          "sandbox handle mismatch",
        );
      }
      const outcome: SandboxInvocationOutcome = await prepared.provider.invoke(
        prepared.handle,
        prepared.invocation,
        {
          signal: prepared.signal,
          maxOutputBytes: prepared.maxOutputBytes,
          knownSecrets: prepared.knownSecrets,
        },
      );
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
export function registerExecutionTool(
  tools: ToolRegistry,
  executionTools: ExecutionToolRegistry,
  dispatcher: BoundedInvocationDispatcher,
  def: ExecutionToolDefinition,
  scope: {
    allowedAgents: readonly string[];
    allowedProjects: readonly string[];
    allowedEnvironments: readonly Environment[];
  },
): ExecutionToolDefinition {
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
export function validateOperationOutput(
  spec: OperationOutputSpec | undefined,
  stdout: string,
): Record<string, unknown> {
  if (!spec || spec.kind === "text") return {};
  if (spec.kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new ExecutionDeniedError(
        "INVALID_OUTPUT",
        "output is not valid JSON",
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ExecutionDeniedError(
        "INVALID_OUTPUT",
        "output is not a JSON object",
      );
    }
    return parsed as Record<string, unknown>;
  }
  const match = SEMVER.exec(stdout.trim());
  if (!match) {
    throw new ExecutionDeniedError(
      "INVALID_OUTPUT",
      "output is not a single semantic version",
    );
  }
  return { version: match[1]! };
}
