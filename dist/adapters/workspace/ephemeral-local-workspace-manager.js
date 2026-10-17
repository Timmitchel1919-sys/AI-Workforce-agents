/**
 * EphemeralLocalWorkspaceManager — per-job scratch workspace rooted in a
 * trusted temp directory (R2). This is the worker-side companion to
 * `WorkspaceRepositorySandbox`: it does not model change-sets, verification
 * state or git — it only exists so one tool-action run has an isolated
 * directory to read, write and spawn inside, bounded by `resolveInside`
 * and cleaned up on `release()`.
 *
 * Each workspace lives under <tmpDir>/<prefix>-<workspaceId>. The id is
 * injected (so one lease matches the Firestore job's workspaceId) and the
 * manager keeps a map of active leases so a crashed worker can be swept
 * on restart.
 */
import { mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../../contracts/index.js";
import { isPathInside, resolveWithinWorkspace, } from "../../core/execution/path-confinement.js";
export class EphemeralLocalWorkspaceManager {
    baseDir;
    prefix;
    clock;
    active = new Map();
    constructor(options = {}) {
        this.baseDir = options.baseDir ?? tmpdir();
        this.prefix = options.prefix ?? "aw-workspace";
        this.clock = options.clock ?? (() => new Date());
    }
    async acquire(input) {
        if (!input.workspaceId || typeof input.workspaceId !== "string") {
            throw new ValidationError("workspaceId required");
        }
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(input.workspaceId)) {
            throw new ValidationError(`workspaceId must match [A-Za-z0-9_.-]{1,128}: ${JSON.stringify(input.workspaceId)}`);
        }
        if (this.active.has(input.workspaceId)) {
            throw new ValidationError(`workspace already active: ${input.workspaceId}`);
        }
        const rootPath = join(this.baseDir, `${this.prefix}-${input.workspaceId}`);
        await mkdir(rootPath, { recursive: true });
        // Resolve the root through realpath so a tmp dir that is itself a
        // symlink does not confuse later containment checks.
        const canonicalRoot = await realpath(rootPath);
        const createdAt = this.clock().toISOString();
        const lease = {
            workspaceId: input.workspaceId,
            rootPath: canonicalRoot,
            projectId: input.projectId,
            createdAt,
            release: async () => {
                this.active.delete(input.workspaceId);
                await rm(canonicalRoot, { recursive: true, force: true });
            },
            resolveInside: async (relativePath) => {
                const absolute = resolveWithinWorkspace(canonicalRoot, relativePath);
                return absolute;
            },
        };
        this.active.set(input.workspaceId, lease);
        return lease;
    }
    /** Test helper: how many workspaces are currently active. */
    activeCount() {
        return this.active.size;
    }
    /** Containment check used by tool handlers that already have an absolute path. */
    isInsideWorkspace(workspaceId, absolutePath) {
        const lease = this.active.get(workspaceId);
        if (!lease)
            return false;
        return isPathInside(lease.rootPath, absolutePath);
    }
}
