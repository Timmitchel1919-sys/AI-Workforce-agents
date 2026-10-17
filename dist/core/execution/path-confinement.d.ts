export declare function assertWorkspaceRelative(relativePath: string): void;
/**
 * Resolve `relativePath` against `rootPath` and return the absolute, no-dot
 * form. Throws if the resolved path is not within `rootPath`. Does NOT
 * follow symlinks — the caller must use `fs.realpath` after the file is
 * known to exist, then re-check containment.
 */
export declare function resolveWithinWorkspace(rootPath: string, relativePath: string): string;
export declare function isPathInside(root: string, candidate: string): boolean;
