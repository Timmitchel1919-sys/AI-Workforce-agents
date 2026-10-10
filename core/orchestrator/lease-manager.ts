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
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
  type WriteScopeLease,
} from "../../contracts/index.js";
import { now } from "../shared.js";

export interface LeaseRepository<T extends { leaseId: string }> {
  list(): T[];
  findById(id: string): T | undefined;
  upsert(item: T): void;
}

export const DEFAULT_LEASE_TTL_MS = 3_600_000;
export const MAX_LEASE_TTL_MS = 86_400_000;
export const MAX_SCOPE_ENTRIES = 256;
const MAX_SCOPE_LENGTH = 512;

function validateScope(scope: readonly string[]): readonly string[] {
  if (!Array.isArray(scope)) {
    throw new ValidationError("lease scope must be an array");
  }
  if (scope.length > MAX_SCOPE_ENTRIES) {
    throw new ValidationError(
      `lease scope must contain at most ${MAX_SCOPE_ENTRIES} entries`,
    );
  }
  for (const entry of scope) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ValidationError(
        "lease scope entries must be non-empty strings",
      );
    }
    if (entry.length > MAX_SCOPE_LENGTH) {
      throw new ValidationError("lease scope entry is too long");
    }
    if (
      entry.includes("..") ||
      entry.startsWith("/") ||
      /^[A-Za-z]:/.test(entry)
    ) {
      // A lease scope is workspace-relative. An absolute or traversing scope
      // would let a caller claim a lease on a path outside the workspace and
      // then "hold" it forever.
      throw new ValidationError(
        `lease scope entry must be workspace-relative: ${JSON.stringify(entry)}`,
      );
    }
  }
  return scope;
}

function isLive(lease: WriteScopeLease, at: number): boolean {
  return lease.status === "active" && new Date(lease.expiresAt).getTime() > at;
}

/** Does the scope root `root` contain `path` (itself, or anything beneath it)? */
function rootCovers(root: string, path: string): boolean {
  if (root === "*") return true;
  const r = normalize(root);
  const p = normalize(path);
  return p === r || p.startsWith(r + "/");
}

/** Does `path` (a workspace-relative file or directory path) fall in `scope`? */
export function scopeCovers(scope: readonly string[], path: string): boolean {
  return scope.some((entry) => rootCovers(entry, path));
}

/** Do two scope sets touch at all? */
export function scopesConflict(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.includes("*") || b.includes("*")) return true;
  return a.some((left) =>
    b.some((right) => rootCovers(left, right) || rootCovers(right, left)),
  );
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export class WriteScopeLeaseManager {
  constructor(
    private readonly leases: LeaseRepository<WriteScopeLease>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

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
  }): WriteScopeLease {
    validateScope(input.scope);
    const ttl = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_LEASE_TTL_MS) {
      throw new ValidationError(
        `lease ttlMs must be a positive number no greater than ${MAX_LEASE_TTL_MS}`,
      );
    }
    const at = this.clock();
    const conflict = this.conflictingLease(input, at);
    if (conflict) {
      throw new StateTransitionError(
        `workspace ${input.workspaceId} already has a live write lease ${conflict.leaseId} held by ${conflict.agentId} for task ${conflict.taskId} over overlapping scope`,
      );
    }
    const lease: WriteScopeLease = {
      leaseId: input.leaseId,
      projectId: input.projectId,
      taskId: input.taskId,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      scope: [...input.scope],
      status: "active",
      acquiredAt: new Date(at).toISOString(),
      expiresAt: new Date(at + ttl).toISOString(),
      version: 1,
    };
    this.leases.upsert(lease);
    return Object.freeze(lease);
  }

  private conflictingLease(
    input: { projectId: string; workspaceId: string; scope: readonly string[] },
    at: number,
  ): WriteScopeLease | undefined {
    return (
      this.leases
        .list()
        .filter(
          (l) =>
            l.workspaceId === input.workspaceId &&
            l.projectId === input.projectId &&
            isLive(l, at) &&
            scopesConflict(l.scope, input.scope),
        )
        // Deterministic: the oldest live conflict is reported, so two racing
        // callers fail with the same message.
        .sort(
          (a, b) =>
            a.acquiredAt.localeCompare(b.acquiredAt) ||
            a.leaseId.localeCompare(b.leaseId),
        )[0]
    );
  }

  release(leaseId: string): WriteScopeLease {
    const lease = this.leases.findById(leaseId);
    if (!lease) throw new NotFoundError(`unknown lease: ${leaseId}`);
    if (lease.status !== "active") {
      throw new StateTransitionError(`lease is already ${lease.status}`);
    }
    const released: WriteScopeLease = {
      ...lease,
      status: "released",
      version: lease.version + 1,
    };
    this.leases.upsert(released);
    return released;
  }

  /** Release every live lease held by a task. Used when a task ends or is reassigned. */
  releaseForTask(taskId: string): readonly WriteScopeLease[] {
    const released: WriteScopeLease[] = [];
    for (const lease of this.leases.list()) {
      if (lease.taskId === taskId && lease.status === "active") {
        const next = {
          ...lease,
          status: "released" as const,
          version: lease.version + 1,
        };
        this.leases.upsert(next);
        released.push(next);
      }
    }
    return released;
  }

  /**
   * May this agent write this path right now?
   *
   * Used at the execution boundary. A false answer is a denial — there is no
   * "warn and proceed" path.
   */
  hasValidLease(workspaceId: string, agentId: string, path: string): boolean {
    const at = this.clock();
    return this.leases
      .list()
      .filter(
        (l) =>
          l.workspaceId === workspaceId &&
          l.agentId === agentId &&
          isLive(l, at),
      )
      .some((l) => scopeCovers(l.scope, path));
  }

  /** Live leases for a workspace — surfaced in the Control Center and the graph. */
  active(workspaceId: string): readonly WriteScopeLease[] {
    const at = this.clock();
    return this.leases
      .list()
      .filter((l) => l.workspaceId === workspaceId && isLive(l, at))
      .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
  }

  /** Sweep expired leases. Returns the ids that were expired. */
  expireStale(): readonly string[] {
    const at = this.clock();
    const expired: string[] = [];
    for (const lease of this.leases.list()) {
      if (
        lease.status === "active" &&
        new Date(lease.expiresAt).getTime() <= at
      ) {
        this.leases.upsert({
          ...lease,
          status: "expired",
          version: lease.version + 1,
        });
        expired.push(lease.leaseId);
      }
    }
    return expired;
  }
}

export { now };
