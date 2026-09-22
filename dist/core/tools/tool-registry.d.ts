import { type Tool, type ToolApprovalRule, type ToolDefinition, type ToolExecutionLimits } from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";
/** Tool metadata without executable/schema functions — safe to expose. */
export interface ToolMetadataView {
    id: string;
    name: string;
    description: string;
    version: string;
    capabilities: readonly string[];
    requiredPermission: {
        action: string;
    };
    approvalPolicy?: ToolApprovalRule;
    allowedAgents: readonly string[];
    allowedProjects: readonly string[];
    allowedEnvironments: readonly string[];
    timeoutMs: number;
    limits: ToolExecutionLimits;
    metadata: Record<string, unknown>;
}
/**
 * Registry of validated tools. A tool definition is frozen on registration and
 * can only change through {@link ToolRegistry.update} (which re-validates). The
 * registry never executes anything — it answers "does this tool exist / is this
 * agent or project eligible / what does it need".
 */
export declare class ToolRegistry {
    private readonly audit?;
    private readonly tools;
    constructor(audit?: AuditLog | undefined);
    register(tool: Tool): Tool;
    /** The only sanctioned way to change a registered definition. Re-validates. */
    update(id: string, changes: Partial<Omit<ToolDefinition, "id">>): Tool;
    has(id: string): boolean;
    get(id: string): Tool | undefined;
    require(id: string): Tool;
    list(): Tool[];
    byCapability(capability: string): Tool[];
    eligibleForAgent(id: string, agentId: string): boolean;
    eligibleForProject(id: string, projectId: string): boolean;
    /** Public metadata for a tool — no handler, no schema functions. */
    describe(id: string): ToolMetadataView;
}
