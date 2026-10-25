/**
 * R9 (ADR-0034) — SandboxWorkspacePathResolver.
 *
 * Trusted bridge between the EO-4.3 `WorkspaceRepositorySandbox` and the
 * EO-4.5 `DockerContainerRunner`. Takes a workspaceId + projectId and
 * returns the absolute HOST path the sandbox materialized the workspace
 * at. The raw host path never crosses the contract boundary that agents
 * see; only the Docker runner (trusted composition) consumes it.
 *
 * Invariants:
 *   - Project-scoped: a workspaceId that belongs to another project
 *     returns `null` (NOT the path), matching the sandbox's own IDOR
 *     behaviour.
 *   - Fail-closed: anything that throws inside the lookup becomes `null`
 *     so the runner falls back to a mount-less invocation (no leak of
 *     adapter-internal state).
 *   - Returns an absolute path or `null`; the runner itself refuses a
 *     non-absolute result with `WORKSPACE_VIOLATION`.
 */
import type { WorkspacePathResolver } from "./docker-container-runner.js";
/** Minimal lookup surface from the WorkspaceRepositorySandbox. */
export interface WorkspaceRootLookup {
    workspaceRoot(workspaceId: string, projectId: string): string | null;
}
export declare class SandboxWorkspacePathResolver implements WorkspacePathResolver {
    private readonly lookup;
    constructor(lookup: WorkspaceRootLookup);
    resolve(workspaceId: string, projectId: string): Promise<string | null>;
}
