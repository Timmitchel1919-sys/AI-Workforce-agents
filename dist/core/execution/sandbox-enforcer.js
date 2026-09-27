import { ExecutionDeniedError } from "../../contracts/index.js";
/**
 * ADR-0033: SandboxEnforcer
 * Validates tool operations to ensure they do not exceed their project-specific sandbox boundaries.
 * In particular, write operations to the workspace require an explicit unexpired lease over the target path.
 */
export class SandboxEnforcer {
    leaseManager;
    constructor(leaseManager) {
        this.leaseManager = leaseManager;
    }
    enforce(projectId, workspaceId, agentId, operation, input) {
        if (operation.workspaceAccess === "write") {
            const path = input.path;
            if (!path) {
                throw new ExecutionDeniedError("POLICY_DENIED", "Workspace write operations require a path input.");
            }
            if (!this.leaseManager.hasValidLease(workspaceId, agentId, path)) {
                throw new ExecutionDeniedError("POLICY_DENIED", `Agent ${agentId} lacks an explicit write lease for path ${path} in workspace ${workspaceId}.`);
            }
        }
        // Check if network access is authorized (stubbed for future expansion)
        if (operation.networkAccess !== "none") {
            // Further checks could go here.
        }
    }
}
