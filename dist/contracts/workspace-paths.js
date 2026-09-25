/**
 * Workspace path safety (EO-4.1).
 *
 * Every future filesystem operation names a path RELATIVE to its session's
 * workspace. These pure functions decide — without touching the filesystem —
 * whether a requested path stays inside the workspace, under BOTH Windows and
 * POSIX semantics (the stricter union applies, because a workspace may be
 * materialized on either platform):
 *
 *   rejected: empty / NUL / control characters, absolute POSIX paths,
 *   drive letters (`C:\`, drive-relative `C:foo`), UNC (`\\server\share`),
 *   device/verbatim prefixes (`\\?\`, `\\.\`), rooted `\foo`, `~` expansion,
 *   any `..` segment (with `/`, `\` or mixed separators), NTFS alternate data
 *   streams (`:`), Windows reserved device names (CON, NUL, COM1…), and
 *   segments with trailing dots/spaces (Windows silently strips them).
 *
 * Symlinks, junctions and reparse points cannot be judged from a string. A
 * sandbox provider MUST resolve the real path after materialization and call
 * {@link assertRealPathWithinRoot}; this module never claims to do that alone.
 */
import { ExecutionDeniedError } from "./index.js";
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENTS = 64;
function violation(detail) {
    return new ExecutionDeniedError("WORKSPACE_VIOLATION", detail);
}
/**
 * Canonical workspace-relative form of `requested` (`/`-separated, no `.`
 * segments), or throws `ExecutionDeniedError("WORKSPACE_VIOLATION")`.
 * `"."` / `""`-free: the workspace root itself is `"."`.
 */
export function resolveWorkspacePath(requested) {
    if (typeof requested !== "string")
        throw violation("path must be a string");
    if (requested.length === 0)
        throw violation("path must not be empty");
    if (requested.length > MAX_PATH_LENGTH)
        throw violation("path is too long");
    // NUL and other control characters (incl. newline) are never legitimate.
    for (let i = 0; i < requested.length; i += 1) {
        const code = requested.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) {
            throw violation("path contains control characters");
        }
    }
    if (requested.startsWith("~"))
        throw violation("home expansion is not allowed");
    if (requested.startsWith("/"))
        throw violation("absolute paths are not allowed");
    if (requested.startsWith("\\")) {
        // `\foo` (rooted), `\\server\share` (UNC), `\\?\` and `\\.\` (device).
        throw violation("rooted, UNC and device paths are not allowed");
    }
    if (/^[A-Za-z]:/.test(requested)) {
        throw violation("drive-letter paths are not allowed");
    }
    if (requested.includes(":")) {
        throw violation("alternate data streams and URLs are not allowed");
    }
    const segments = requested.split(/[\\/]+/);
    if (segments.length > MAX_SEGMENTS)
        throw violation("path is too deep");
    const out = [];
    for (const segment of segments) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..") {
            throw violation("parent-directory traversal is not allowed");
        }
        if (/[. ]$/.test(segment)) {
            throw violation("segments must not end with a dot or space");
        }
        if (WINDOWS_RESERVED.test(segment)) {
            throw violation("reserved device names are not allowed");
        }
        if (/[<>"|?*]/.test(segment)) {
            throw violation("path contains characters invalid on Windows");
        }
        out.push(segment);
    }
    return out.length === 0 ? "." : out.join("/");
}
/** Whether canonical `path` lies within canonical workspace-relative `scope`. */
export function isWithinScope(path, scope) {
    const p = resolveWorkspacePath(path);
    const s = resolveWorkspacePath(scope);
    if (s === ".")
        return true;
    const pl = p.toLowerCase();
    const sl = s.toLowerCase();
    // Case-insensitive on purpose: the stricter rule when Windows may be the host.
    return pl === sl || pl.startsWith(`${sl}/`);
}
/**
 * Post-materialization check for providers: after resolving symlinks,
 * junctions and reparse points (realpath), the result must still be inside
 * the real workspace root. `platform` selects separator and case rules.
 */
export function assertRealPathWithinRoot(realRoot, realPath, platform) {
    const normalize = (value) => {
        let v = platform === "win32" ? value.replace(/\//g, "\\") : value;
        const sep = platform === "win32" ? "\\" : "/";
        while (v.length > 1 && v.endsWith(sep) && !/^[A-Za-z]:\\$/.test(v)) {
            v = v.slice(0, -1);
        }
        return platform === "win32" ? v.toLowerCase() : v;
    };
    const root = normalize(realRoot);
    const path = normalize(realPath);
    const sep = platform === "win32" ? "\\" : "/";
    if (path !== root &&
        !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
        throw violation("resolved path escapes the workspace root");
    }
}
