/**
 * Per-run workspace management (R2 worker side).
 *
 * NOTE: this is intentionally a different port from `contracts/workspace.ts`
 * `WorkspaceControl` — that one is the authorized change-set lifecycle API
 * reached through the ExecutionManager. This port is the thin filesystem
 * isolation seam the worker uses to open a scratch directory for one job,
 * bound every tool action to that directory via `resolveInside`, and clean
 * it up afterward. Keeping the two separate means the change-set lifecycle
 * stays untouched by R2.
 */
/**
 * The slim shape every tool-action handler receives — just enough to
 * read/write within the workspace. Separated so handlers can be unit-
 * tested with a stub access object instead of a full lease.
 */
export interface WorkspaceAccess {
    readonly rootPath: string;
    /**
     * Resolve `relativePath` to an absolute path that is proven to live
     * inside this workspace. Throws if `relativePath` would escape via `..`,
     * absolute paths, backslash tricks, or a symlink that lands outside.
     */
    resolveInside(relativePath: string): Promise<string>;
}
export interface WorkerWorkspaceLease extends WorkspaceAccess {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly createdAt: string;
    release(): Promise<void>;
}
export interface AcquireWorkerWorkspaceInput {
    readonly workspaceId: string;
    readonly projectId: string;
}
export interface WorkerWorkspaceManager {
    acquire(input: AcquireWorkerWorkspaceInput): Promise<WorkerWorkspaceLease>;
}
