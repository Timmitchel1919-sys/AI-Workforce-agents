import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
export interface ArtifactCollectInput {
    readonly paths: readonly string[];
}
export interface ArtifactCollectOutput {
    readonly artifacts: ReadonlyArray<{
        readonly path: string;
        readonly size: number;
        readonly sha256: string;
    }>;
    readonly skipped: ReadonlyArray<{
        readonly path: string;
        readonly reason: string;
    }>;
}
export interface ArtifactCollectorToolHandlerOptions {
    /** Maximum files per collection call. Default 128. */
    readonly maxFiles?: number;
    /** Per-file size cap for hashing (prevents hashing of huge files). Default 10 MiB. */
    readonly maxFileBytes?: number;
}
export declare class ArtifactCollectorToolHandler {
    private readonly maxFiles;
    private readonly maxFileBytes;
    constructor(options?: ArtifactCollectorToolHandlerOptions);
    run(lease: WorkspaceAccess, input: ArtifactCollectInput): Promise<ArtifactCollectOutput>;
}
