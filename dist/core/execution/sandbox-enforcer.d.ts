import type { WriteScopeLeaseManager } from "../orchestrator/lease-manager.js";
import type { ExecutionOperationDefinition } from "../../contracts/index.js";
/**
 * ADR-0033: SandboxEnforcer
 * Validates tool operations to ensure they do not exceed their project-specific sandbox boundaries.
 * In particular, write operations to the workspace require an explicit unexpired lease over the target path.
 */
export declare class SandboxEnforcer {
    private readonly leaseManager;
    constructor(leaseManager: WriteScopeLeaseManager);
    enforce(projectId: string, workspaceId: string, agentId: string, operation: ExecutionOperationDefinition, input: Record<string, unknown>): void;
}
