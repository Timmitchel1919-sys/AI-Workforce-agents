/**
 * Canonical workspace-relative form of `requested` (`/`-separated, no `.`
 * segments), or throws `ExecutionDeniedError("WORKSPACE_VIOLATION")`.
 * `"."` / `""`-free: the workspace root itself is `"."`.
 */
export declare function resolveWorkspacePath(requested: unknown): string;
/** Whether canonical `path` lies within canonical workspace-relative `scope`. */
export declare function isWithinScope(path: string, scope: string): boolean;
/**
 * Post-materialization check for providers: after resolving symlinks,
 * junctions and reparse points (realpath), the result must still be inside
 * the real workspace root. `platform` selects separator and case rules.
 */
export declare function assertRealPathWithinRoot(realRoot: string, realPath: string, platform: "win32" | "posix"): void;
