export type PathRefusal = "invalid_path" | "absolute_path" | "traversal" | "outside_workspace" | "sensitive_path" | "protected_path";
export declare class PathRefusedError extends Error {
    readonly reason: PathRefusal;
    constructor(reason: PathRefusal, message: string);
}
/** Normalise separators; never resolves anything on disk. */
export declare function normalizeRelative(input: unknown): string;
export declare function isSensitivePath(relative: string): boolean;
/** Paths an agent may never write, create, rename into/out of, or delete. */
export declare function isProtectedPath(relative: string): boolean;
export interface ResolvedPath {
    relative: string;
    absolute: string;
}
/**
 * Resolve `input` inside `root`. `rootReal` must already be the realpath of
 * the workspace root. The deepest EXISTING ancestor is realpath'd so a symlink
 * cannot smuggle a path outside the root (including for paths not yet created).
 */
export declare function resolveInside(rootReal: string, input: unknown, options?: {
    allowSensitive?: boolean;
}): Promise<ResolvedPath>;
