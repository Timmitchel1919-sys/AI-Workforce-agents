import type { AcquireWorkerWorkspaceInput, WorkerWorkspaceLease, WorkerWorkspaceManager } from "../../core/execution/worker-workspace.js";
export interface EphemeralLocalWorkspaceManagerOptions {
    /** Base directory under which per-run workspaces are created. */
    readonly baseDir?: string;
    /** File-system prefix for the per-run directory. Default `aw-workspace`. */
    readonly prefix?: string;
    /** Clock injectable for tests. */
    readonly clock?: () => Date;
}
export declare class EphemeralLocalWorkspaceManager implements WorkerWorkspaceManager {
    private readonly baseDir;
    private readonly prefix;
    private readonly clock;
    private readonly active;
    constructor(options?: EphemeralLocalWorkspaceManagerOptions);
    acquire(input: AcquireWorkerWorkspaceInput): Promise<WorkerWorkspaceLease>;
    /** Test helper: how many workspaces are currently active. */
    activeCount(): number;
    /** Containment check used by tool handlers that already have an absolute path. */
    isInsideWorkspace(workspaceId: string, absolutePath: string): boolean;
}
