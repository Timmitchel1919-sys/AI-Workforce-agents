import { NotFoundError, StateTransitionError, } from "../../contracts/index.js";
import { now } from "../shared.js";
/**
 * ADR-0033: WriteScopeLeaseManager
 * Ensures that agents explicitly acquire leases to write to a project's workspace,
 * preventing conflicts between concurrently executing specialists in a Software Factory.
 */
export class WriteScopeLeaseManager {
    leases;
    constructor(leases) {
        this.leases = leases;
    }
    acquire(projectId, taskId, agentId, workspaceId, scope, ttlMs = 3600000) {
        const timestamp = now();
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        for (const existing of this.leases.list()) {
            if (existing.workspaceId === workspaceId &&
                existing.status === "active" &&
                new Date(existing.expiresAt).getTime() > Date.now()) {
                // Simple scope intersection check
                const overlap = existing.scope.includes("*") ||
                    scope.includes("*") ||
                    existing.scope.some((s) => scope.includes(s));
                if (overlap) {
                    throw new StateTransitionError(`Workspace ${workspaceId} has conflicting active lease ${existing.leaseId}`);
                }
            }
        }
        const lease = {
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
    release(leaseId) {
        const lease = this.leases.findById(leaseId);
        if (!lease)
            throw new NotFoundError("Lease not found");
        if (lease.status !== "active") {
            throw new StateTransitionError("Lease is already " + lease.status);
        }
        this.leases.upsert({
            ...lease,
            status: "released",
            version: lease.version + 1,
        });
    }
    hasValidLease(workspaceId, agentId, path) {
        const active = this.leases.list().filter((l) => l.workspaceId === workspaceId &&
            l.agentId === agentId &&
            l.status === "active" &&
            new Date(l.expiresAt).getTime() > Date.now());
        for (const lease of active) {
            if (lease.scope.includes("*") ||
                lease.scope.some((s) => path.startsWith(s) || s === path)) {
                return true;
            }
        }
        return false;
    }
}
