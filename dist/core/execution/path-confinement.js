/**
 * Workspace path confinement (R2, security-critical).
 *
 * Every filesystem action a tool handler takes must resolve its argument
 * through this helper. The helper rejects every path shape that could
 * escape the workspace root:
 *
 *   - absolute paths (POSIX `/`, Windows `C:\`, `\\server\share`)
 *   - traversal segments (`..`)
 *   - percent-encoded or back-slash-encoded traversal
 *   - empty-string / null-byte paths
 *   - any resolved path whose canonical form is not under the root
 *
 * Symlink-escape protection must be enforced by the caller after this
 * returns, because resolving the real path requires `fs.realpath`.
 */
import { ValidationError } from "../../contracts/index.js";
import { isAbsolute, resolve, sep } from "node:path";
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;
export function assertWorkspaceRelative(relativePath) {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
        throw new ValidationError("path must be a non-empty workspace-relative string");
    }
    if (relativePath.includes("\u0000")) {
        throw new ValidationError("path must not contain null bytes");
    }
    if (relativePath.includes("%")) {
        // We never URL-decode a path on the way in. Reject any percent-encoded
        // byte to remove the `%2e%2e` traversal class entirely.
        throw new ValidationError("path must not contain percent-encoded bytes");
    }
    if (isAbsolute(relativePath) || WINDOWS_DRIVE_PREFIX.test(relativePath) || UNC_PREFIX.test(relativePath)) {
        throw new ValidationError(`path must be workspace-relative: ${JSON.stringify(relativePath)}`);
    }
    const parts = relativePath.replace(/\\/g, "/").split("/");
    if (parts.some((segment) => segment === "..")) {
        throw new ValidationError(`path must not traverse outside the workspace: ${JSON.stringify(relativePath)}`);
    }
}
/**
 * Resolve `relativePath` against `rootPath` and return the absolute, no-dot
 * form. Throws if the resolved path is not within `rootPath`. Does NOT
 * follow symlinks — the caller must use `fs.realpath` after the file is
 * known to exist, then re-check containment.
 */
export function resolveWithinWorkspace(rootPath, relativePath) {
    assertWorkspaceRelative(relativePath);
    const absoluteRoot = resolve(rootPath);
    const absolute = resolve(absoluteRoot, relativePath);
    if (!isPathInside(absoluteRoot, absolute)) {
        throw new ValidationError(`resolved path escaped workspace root: ${JSON.stringify(relativePath)}`);
    }
    return absolute;
}
export function isPathInside(root, candidate) {
    const normalizedRoot = resolve(root);
    const normalizedCandidate = resolve(candidate);
    if (normalizedCandidate === normalizedRoot)
        return true;
    const prefix = normalizedRoot.endsWith(sep)
        ? normalizedRoot
        : normalizedRoot + sep;
    return normalizedCandidate.startsWith(prefix);
}
