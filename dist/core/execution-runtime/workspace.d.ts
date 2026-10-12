import { type FileChange, type RuntimeWorkspaceDescriptor, type RuntimeWorkspaceEnvironment, type RuntimeWorkspaceOperation } from "../../contracts/execution-runtime.js";
/** Trusted configuration for one project's workspace. Contains a host path. */
export interface WorkspaceBinding {
    workspaceId: string;
    projectId: string;
    rootPath: string;
    repository?: string;
    branch?: string;
    environment: RuntimeWorkspaceEnvironment;
    runtime: string;
    packageManager?: string;
    permittedOperations: readonly RuntimeWorkspaceOperation[];
}
export declare class WorkspaceUnavailableError extends Error {
    constructor(message: string);
}
export declare class WorkspaceRegistry {
    private readonly bindings;
    register(binding: WorkspaceBinding): void;
    get(projectId: string): WorkspaceBinding | undefined;
    projects(): string[];
}
export interface ResolvedWorkspace {
    descriptor: RuntimeWorkspaceDescriptor;
    binding: WorkspaceBinding;
    /** realpath of the root; the anchor for every path check. */
    rootReal: string;
}
export declare class WorkspaceResolver {
    private readonly registry;
    private readonly clock;
    constructor(registry: Pick<WorkspaceRegistry, "get">, clock?: () => string);
    /** Resolve explicitly, or fail: there is no default workspace. */
    resolve(projectId: string): Promise<ResolvedWorkspace>;
}
export declare class ApprovalRequiredError extends Error {
    constructor(message: string);
}
export declare class FileConflictError extends Error {
    constructor(message: string);
}
export interface TreeEntry {
    path: string;
    type: "file" | "dir";
    size?: number;
}
export interface ChangeContext {
    taskId: string;
    agentId: string;
    clock: () => string;
}
export declare class GovernedFileSystem {
    private readonly rootReal;
    private readonly permitted;
    private readonly ctx;
    private operations;
    constructor(rootReal: string, permitted: readonly RuntimeWorkspaceOperation[], ctx: ChangeContext);
    private allow;
    tree(dir?: string, maxDepth?: number, maxEntries?: number): Promise<{
        entries: TreeEntry[];
        truncated: boolean;
    }>;
    read(input: unknown): Promise<{
        path: string;
        content: string;
        size: number;
        hash: string;
        truncated: boolean;
    }>;
    create(input: unknown, content: unknown): Promise<FileChange>;
    update(input: unknown, content: unknown, expectedHash?: string): Promise<FileChange>;
    rename(from: unknown, to: unknown, operation?: "rename" | "move"): Promise<FileChange>;
    /** Deletion is destructive: it requires the task's human approval. */
    delete(input: unknown, approved: boolean): Promise<FileChange>;
    private writable;
    private text;
    private change;
}
