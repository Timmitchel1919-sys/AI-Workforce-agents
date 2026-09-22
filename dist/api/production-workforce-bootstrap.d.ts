/**
 * Trusted, runtime-neutral Workforce capability bootstrap.
 *
 * This is deliberately separate from HTTP and Firebase runtime adapters. Its
 * input is version-controlled TypeScript supplied by a deployment composition
 * root; executable bindings are trusted compiled functions, never strings that
 * resolve modules at runtime.
 */
import { type Agent, type AgentExecutor, type ApprovalPolicy, type PermissionGrant, type ProjectAdapter, type ToolDefinition, type ToolExecutionContext } from "../contracts/index.js";
import { AgentRegistry, AuditLog, PermissionSystem, ProjectRegistry, RoutingAgentExecutor, ToolRegistry } from "../core/index.js";
export type TrustedToolHandler = (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
/** A trusted compiled factory receives the runtime audit sink at bootstrap. */
export type TrustedAgentExecutorBinding = AgentExecutor | ((audit: AuditLog) => AgentExecutor);
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
    executorBindings: Readonly<Record<string, TrustedAgentExecutorBinding>>;
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
export declare function createProductionWorkforceBootstrap(configuration: ProductionWorkforceConfiguration, audit?: AuditLog): ProductionWorkforceBootstrap;
