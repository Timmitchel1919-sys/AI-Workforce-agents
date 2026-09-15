/**
 * Trusted, runtime-neutral Workforce capability bootstrap.
 *
 * This is deliberately separate from HTTP and Firebase runtime adapters. Its
 * input is version-controlled TypeScript supplied by a deployment composition
 * root; executable bindings are trusted compiled functions, never strings that
 * resolve modules at runtime.
 */
import {
  type Agent,
  type AgentExecutor,
  type ApprovalPolicy,
  type PermissionGrant,
  type ProjectAdapter,
  type Tool,
  type ToolDefinition,
  type ToolExecutionContext,
  ValidationError,
} from "../contracts/index.js";
import {
  AgentRegistry,
  AuditLog,
  PermissionSystem,
  ProjectRegistry,
  RoutingAgentExecutor,
  ToolRegistry,
  approveNothing,
} from "../core/index.js";

export type TrustedToolHandler = (
  input: unknown,
  context: ToolExecutionContext,
) => Promise<unknown>;

export interface ProductionAgentBinding {
  definition: Agent;
  executorKey: string;
}

export interface ProductionToolBinding {
  definition: ToolDefinition;
  handlerKey: string;
}

export interface ProductionProjectBinding {
  adapter: ProjectAdapter;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The authoritative, non-secret capability declaration for one runtime.
 * Secrets remain in environment-backed provider/runtime adapters, never here.
 */
export interface ProductionWorkforceConfiguration {
  agents: readonly ProductionAgentBinding[];
  executorBindings: Readonly<Record<string, AgentExecutor>>;
  tools: readonly ProductionToolBinding[];
  toolHandlerBindings: Readonly<Record<string, TrustedToolHandler>>;
  projectAdapters: readonly ProductionProjectBinding[];
  permissionGrants: readonly PermissionGrant[];
  approvalPolicy?: ApprovalPolicy;
}

export interface ProductionWorkforceBootstrap {
  readonly agents: AgentRegistry;
  readonly agentExecutors: RoutingAgentExecutor;
  readonly tools: ToolRegistry;
  readonly projects: ProjectRegistry;
  readonly permissions: PermissionSystem;
  readonly approvalPolicy: ApprovalPolicy;
  readonly report: Readonly<{
    agentCount: number;
    executorCount: number;
    toolCount: number;
    toolHandlerCount: number;
    projectAdapterCount: number;
    operational: boolean;
  }>;
}

/**
 * Validates and materializes a trusted Workforce runtime configuration.
 * Invalid references fail before a request handler can be constructed.
 */
export function createProductionWorkforceBootstrap(
  configuration: ProductionWorkforceConfiguration,
  audit: AuditLog = new AuditLog(),
): ProductionWorkforceBootstrap {
  assertConfiguration(configuration);

  const tools = new ToolRegistry(audit);
  for (const binding of configuration.tools) {
    const handler = configuration.toolHandlerBindings[binding.handlerKey]!;
    tools.register({ ...binding.definition, execute: handler });
  }

  const agents = new AgentRegistry();
  const agentExecutors = new RoutingAgentExecutor();
  for (const binding of configuration.agents) {
    agents.register(binding.definition);
    agentExecutors.register(
      binding.definition.id,
      configuration.executorBindings[binding.executorKey]!,
    );
  }

  const projects = new ProjectRegistry();
  for (const binding of configuration.projectAdapters) {
    projects.register(binding.adapter, {
      displayName: binding.displayName,
      metadata: binding.metadata,
    });
  }

  const report = Object.freeze({
    agentCount: agents.list().length,
    executorCount: agentExecutors.list().length,
    toolCount: tools.list().length,
    toolHandlerCount: Object.keys(configuration.toolHandlerBindings).length,
    projectAdapterCount: projects.list().length,
    operational: agents.list().length > 0 && agentExecutors.list().length > 0,
  });

  return Object.freeze({
    agents,
    agentExecutors,
    tools,
    projects,
    permissions: new PermissionSystem(configuration.permissionGrants),
    approvalPolicy: configuration.approvalPolicy ?? approveNothing,
    report,
  });
}

function assertConfiguration(
  configuration: ProductionWorkforceConfiguration,
): void {
  if (!configuration || typeof configuration !== "object") {
    throw new ValidationError("production workforce configuration is required");
  }
  assertUnique(
    configuration.agents.map((binding) => binding.definition.id),
    "agent id",
  );
  assertUnique(
    configuration.tools.map((binding) => binding.definition.id),
    "tool id",
  );
  assertUnique(
    configuration.projectAdapters.map((binding) => binding.adapter.projectId),
    "project adapter id",
  );
  assertUnique(
    configuration.agents.map((binding) => binding.executorKey),
    "agent executor binding",
  );
  assertUnique(
    configuration.tools.map((binding) => binding.handlerKey),
    "tool handler binding",
  );

  const toolIds = new Set(
    configuration.tools.map((binding) => binding.definition.id),
  );
  const agentIds = new Set(
    configuration.agents.map((binding) => binding.definition.id),
  );

  for (const binding of configuration.agents) {
    requireTrustedBinding(
      configuration.executorBindings,
      binding.executorKey,
      "agent executor",
    );
    for (const toolId of binding.definition.allowedTools) {
      if (!toolIds.has(toolId)) {
        throw new ValidationError(
          `agent "${binding.definition.id}" references unknown tool "${toolId}"`,
        );
      }
    }
  }

  for (const binding of configuration.tools) {
    requireTrustedBinding(
      configuration.toolHandlerBindings,
      binding.handlerKey,
      "tool handler",
    );
    for (const agentId of binding.definition.allowedAgents) {
      if (agentId !== "*" && !agentIds.has(agentId)) {
        throw new ValidationError(
          `tool "${binding.definition.id}" references unknown agent "${agentId}"`,
        );
      }
    }
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || value.trim() === "") {
      throw new ValidationError(`${label} must not be blank`);
    }
    if (seen.has(value)) {
      throw new ValidationError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function requireTrustedBinding<T>(
  bindings: Readonly<Record<string, T>>,
  key: string,
  label: string,
): void {
  if (!key || key.trim() === "" || !(key in bindings) || !bindings[key]) {
    throw new ValidationError(`unknown ${label} binding: ${key || "(blank)"}`);
  }
}
