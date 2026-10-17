import { type WorkspaceFilePolicy } from "../../contracts/index.js";
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
export type FilesystemAction = "read" | "write" | "list" | "exists";
export interface FilesystemReadInput {
    readonly action: "read";
    readonly path: string;
}
export interface FilesystemReadOutput {
    readonly action: "read";
    readonly content: string;
    readonly bytes: number;
    readonly truncated: boolean;
}
export interface FilesystemWriteInput {
    readonly action: "write";
    readonly path: string;
    readonly content: string;
    /** If true, create missing parent directories. Default false. */
    readonly createParents?: boolean;
}
export interface FilesystemWriteOutput {
    readonly action: "write";
    readonly bytes: number;
}
export interface FilesystemListInput {
    readonly action: "list";
    readonly path: string;
}
export interface FilesystemListOutput {
    readonly action: "list";
    readonly entries: ReadonlyArray<{
        readonly name: string;
        readonly kind: "file" | "directory" | "other";
    }>;
    readonly truncated: boolean;
}
export interface FilesystemExistsInput {
    readonly action: "exists";
    readonly path: string;
}
export interface FilesystemExistsOutput {
    readonly action: "exists";
    readonly kind: "file" | "directory" | "missing";
}
export type FilesystemToolInput = FilesystemReadInput | FilesystemWriteInput | FilesystemListInput | FilesystemExistsInput;
export type FilesystemToolOutput = FilesystemReadOutput | FilesystemWriteOutput | FilesystemListOutput | FilesystemExistsOutput;
export interface FilesystemToolHandlerOptions {
    readonly policy?: WorkspaceFilePolicy;
}
export declare class FilesystemToolHandler {
    private readonly policy;
    constructor(options?: FilesystemToolHandlerOptions);
    run(lease: WorkspaceAccess, input: FilesystemToolInput): Promise<FilesystemToolOutput>;
    private read;
    private write;
    private list;
    private exists;
    private assertNotSecretOrProtected;
}
