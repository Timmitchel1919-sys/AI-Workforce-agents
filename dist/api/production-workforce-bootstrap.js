/**
 * Trusted, runtime-neutral Workforce capability bootstrap.
 *
 * This is deliberately separate from HTTP and Firebase runtime adapters. Its
 * input is version-controlled TypeScript supplied by a deployment composition
 * root; executable bindings are trusted compiled functions, never strings that
 * resolve modules at runtime.
 */
import { ValidationError, } from "../contracts/index.js";
import { AgentRegistry, AuditLog, PermissionSystem, ProjectRegistry, RoutingAgentExecutor, ToolRegistry, approveNothing, } from "../core/index.js";
/**
 * Validates and materializes a trusted Workforce runtime configuration.
 * Invalid references fail before a request handler can be constructed.
 */
export function createProductionWorkforceBootstrap(configuration, audit = new AuditLog()) {
    assertConfiguration(configuration);
    const tools = new ToolRegistry(audit);
    for (const binding of configuration.tools) {
        const handler = configuration.toolHandlerBindings[binding.handlerKey];
        tools.register({ ...binding.definition, execute: handler });
    }
    const agents = new AgentRegistry();
    const agentExecutors = new RoutingAgentExecutor();
    for (const binding of configuration.agents) {
        agents.register(binding.definition);
        const trusted = configuration.executorBindings[binding.executorKey];
        agentExecutors.register(binding.definition.id, typeof trusted === "function" ? trusted(audit) : trusted);
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
function assertConfiguration(configuration) {
    if (!configuration || typeof configuration !== "object") {
        throw new ValidationError("production workforce configuration is required");
    }
    assertUnique(configuration.agents.map((binding) => binding.definition.id), "agent id");
    assertUnique(configuration.tools.map((binding) => binding.definition.id), "tool id");
    assertUnique(configuration.projectAdapters.map((binding) => binding.adapter.projectId), "project adapter id");
    assertUnique(configuration.agents.map((binding) => binding.executorKey), "agent executor binding");
    assertUnique(configuration.tools.map((binding) => binding.handlerKey), "tool handler binding");
    const toolIds = new Set(configuration.tools.map((binding) => binding.definition.id));
    const agentIds = new Set(configuration.agents.map((binding) => binding.definition.id));
    for (const binding of configuration.agents) {
        requireTrustedBinding(configuration.executorBindings, binding.executorKey, "agent executor");
        for (const toolId of binding.definition.allowedTools) {
            if (!toolIds.has(toolId)) {
                throw new ValidationError(`agent "${binding.definition.id}" references unknown tool "${toolId}"`);
            }
        }
    }
    for (const binding of configuration.tools) {
        requireTrustedBinding(configuration.toolHandlerBindings, binding.handlerKey, "tool handler");
        for (const agentId of binding.definition.allowedAgents) {
            if (agentId !== "*" && !agentIds.has(agentId)) {
                throw new ValidationError(`tool "${binding.definition.id}" references unknown agent "${agentId}"`);
            }
        }
    }
}
function assertUnique(values, label) {
    const seen = new Set();
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
function requireTrustedBinding(bindings, key, label) {
    if (!key || key.trim() === "" || !(key in bindings) || !bindings[key]) {
        throw new ValidationError(`unknown ${label} binding: ${key || "(blank)"}`);
    }
}
