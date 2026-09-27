import { type WriteScopeLease } from "../../contracts/index.js";
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
export declare class WriteScopeLeaseManager {
    private readonly leases;
    constructor(leases: Repository<WriteScopeLease>);
    acquire(projectId: string, taskId: string, agentId: string, workspaceId: string, scope: string[], ttlMs?: number): WriteScopeLease;
    release(leaseId: string): void;
    hasValidLease(workspaceId: string, agentId: string, path: string): boolean;
}
