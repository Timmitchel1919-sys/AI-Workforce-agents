import {
  NotFoundError,
  StateTransitionError,
  type WriteScopeLease,
} from "../../contracts/index.js";
import { now } from "../shared.js";

// We'll define a simple generic Repository interface if it's not exported.
export interface Repository<T> {
  list(): T[];
  findById(id: string): T | undefined;
  upsert(item: T): void;
}

/**
 * ADR-0033: WriteScopeLeaseManager
 * Ensures that agents explicitly acquire leases to write to a project's workspace,
 * preventing conflicts between concurrently executing specialists in a Software Factory.
 */
export class WriteScopeLeaseManager {
  constructor(private readonly leases: Repository<WriteScopeLease>) {}

  acquire(
    projectId: string,
    taskId: string,
    agentId: string,
    workspaceId: string,
    scope: string[],
    ttlMs: number = 3600000,
  ): WriteScopeLease {
    const timestamp = now();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    for (const existing of this.leases.list()) {
      if (
        existing.workspaceId === workspaceId &&
        existing.status === "active" &&
        new Date(existing.expiresAt).getTime() > Date.now()
      ) {
        // Simple scope intersection check
        const overlap =
          existing.scope.includes("*") ||
          scope.includes("*") ||
          existing.scope.some((s: string) => scope.includes(s));

        if (overlap) {
          throw new StateTransitionError(
            `Workspace ${workspaceId} has conflicting active lease ${existing.leaseId}`,
          );
        }
      }
    }

    const lease: WriteScopeLease = {
      leaseId: `lease-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      projectId,
      taskId,
      agentId,
      workspaceId,
      scope,
      status: "active",
      acquiredAt: timestamp,
      expiresAt,
      version: 1,
    };

    this.leases.upsert(lease);
    return lease;
  }

  release(leaseId: string): void {
    const lease = this.leases.findById(leaseId);
    if (!lease) throw new NotFoundError("Lease not found");
    if (lease.status !== "active") {
      throw new StateTransitionError("Lease is already " + lease.status);
    }
    this.leases.upsert({
      ...lease,
      status: "released",
      version: lease.version + 1,
    });
  }

  hasValidLease(workspaceId: string, agentId: string, path: string): boolean {
    const active = this.leases
      .list()
      .filter(
        (l: WriteScopeLease) =>
          l.workspaceId === workspaceId &&
          l.agentId === agentId &&
          l.status === "active" &&
          new Date(l.expiresAt).getTime() > Date.now(),
      );

    for (const lease of active) {
      if (
        lease.scope.includes("*") ||
        lease.scope.some((s: string) => path.startsWith(s) || s === path)
      ) {
        return true;
      }
    }
    return false;
  }
}
