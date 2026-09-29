/**
 * ADR-0033 — WriteScopeLeaseManager.
 *
 * Two specialists must never write the same path at the same time. This is not
 * a convention agents are asked to respect; it is an invariant the platform
 * enforces, because "the agents were careful" is not a concurrency control.
 *
 * Scope semantics, stated once and used consistently by BOTH acquisition and
 * enforcement (the previous implementation disagreed with itself: acquisition
 * compared scope entries by exact string equality while enforcement used
 * `path.startsWith`, so a lease on `src/` did not block an acquisition of
 * `src` and vice versa):
 *
 *   `*`          the entire workspace. Conflicts with everything.
 *   `a/b`        a SCOPE ROOT: covers that path and everything beneath it,
 *                compared at path-segment boundaries. `a/b` and `a/b/c` DO
 *                overlap; `a/b` and `a/bc` do not.
 *
 * Treating every entry as a root (rather than guessing whether it names a file
 * or a directory) removes the ambiguity that made acquisition and enforcement
 * disagree, and it fails closed: a lease on `src/index.ts` also covers
 * `src/index.ts.bak`, which is the safe direction for a write lease.
 *
 * Leases are project-scoped, task-scoped, bounded by a TTL, and auditable.
 * There is no global, unscoped lease and no unrestricted filesystem access.
 */
import { type WriteScopeLease } from "../../contracts/index.js";
import { now } from "../shared.js";
export interface LeaseRepository<T extends {
    leaseId: string;
}> {
    list(): T[];
    findById(id: string): T | undefined;
    upsert(item: T): void;
}
export declare const DEFAULT_LEASE_TTL_MS = 3600000;
export declare const MAX_LEASE_TTL_MS = 86400000;
export declare const MAX_SCOPE_ENTRIES = 256;
/** Does `path` (a workspace-relative file or directory path) fall in `scope`? */
export declare function scopeCovers(scope: readonly string[], path: string): boolean;
/** Do two scope sets touch at all? */
export declare function scopesConflict(a: readonly string[], b: readonly string[]): boolean;
export declare class WriteScopeLeaseManager {
    private readonly leases;
    private readonly clock;
    constructor(leases: LeaseRepository<WriteScopeLease>, clock?: () => number);
    /**
     * Acquire a write lease, or fail closed.
     *
     * A conflicting live lease in the same workspace is a hard error — never a
     * silent overwrite, never a "proceed anyway". Callers are expected to
     * serialize (wait, or route the conflicting task elsewhere) rather than to
     * retry blindly.
     */
    acquire(input: {
        projectId: string;
        taskId: string;
        agentId: string;
        workspaceId: string;
        scope: readonly string[];
        ttlMs?: number;
        leaseId: string;
    }): WriteScopeLease;
    private conflictingLease;
    release(leaseId: string): WriteScopeLease;
    /** Release every live lease held by a task. Used when a task ends or is reassigned. */
    releaseForTask(taskId: string): readonly WriteScopeLease[];
    /**
     * May this agent write this path right now?
     *
     * Used at the execution boundary. A false answer is a denial — there is no
     * "warn and proceed" path.
     */
    hasValidLease(workspaceId: string, agentId: string, path: string): boolean;
    /** Live leases for a workspace — surfaced in the Control Center and the graph. */
    active(workspaceId: string): readonly WriteScopeLease[];
    /** Sweep expired leases. Returns the ids that were expired. */
    expireStale(): readonly string[];
}
export { now };
