import type { WriteScopeLeaseManager } from "../orchestrator/lease-manager.js";
import { ExecutionDeniedError } from "../../contracts/index.js";
import type { ExecutionOperationDefinition } from "../../contracts/index.js";

/**
 * ADR-0033: SandboxEnforcer
 * Validates tool operations to ensure they do not exceed their project-specific sandbox boundaries.
 * In particular, write operations to the workspace require an explicit unexpired lease over the target path.
 */
export class SandboxEnforcer {
  constructor(private readonly leaseManager: WriteScopeLeaseManager) {}

  public enforce(
    projectId: string,
    workspaceId: string,
    agentId: string,
    operation: ExecutionOperationDefinition,
    input: Record<string, unknown>,
  ): void {
    if (operation.workspaceAccess === "write") {
      const path = input.path as string;
      if (!path) {
        throw new ExecutionDeniedError(
          "POLICY_DENIED",
          "Workspace write operations require a path input.",
        );
      }

      if (!this.leaseManager.hasValidLease(workspaceId, agentId, path)) {
        throw new ExecutionDeniedError(
          "POLICY_DENIED",
          `Agent ${agentId} lacks an explicit write lease for path ${path} in workspace ${workspaceId}.`,
        );
      }
    }

    // Check if network access is authorized (stubbed for future expansion)
    if (operation.networkAccess !== "none") {
      // Further checks could go here.
    }
  }
}
