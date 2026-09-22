/**
 * Project adapter boundary.
 *
 * Each real project (AIMS, Money Mind, Mastery, Tripod) is reached only
 * through a `ProjectAdapter` that exposes a fixed, declared set of
 * capabilities. Project internals are never vendored into this repository.
 *
 * `BaseProjectAdapter` enforces the contract: a stable `projectId`, a declared
 * capability list, and rejection of any operation that was not declared.
 */
import type { ProjectAdapter, ProjectCapability } from "../../contracts/index.js";
export type { ProjectAdapter, ProjectCapability, } from "../../contracts/index.js";
export type ProjectOperationHandler = (input: unknown) => Promise<unknown> | unknown;
export interface ProjectOperation {
    capability: ProjectCapability;
    handler: ProjectOperationHandler;
}
export declare abstract class BaseProjectAdapter implements ProjectAdapter {
    abstract readonly projectId: string;
    protected abstract readonly displayName: string;
    protected abstract readonly operations: Record<string, ProjectOperation>;
    describe(): Promise<{
        name: string;
        capabilities: readonly ProjectCapability[];
    }>;
    execute(operation: string, input: unknown): Promise<unknown>;
}
