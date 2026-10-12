/**
 * Path guard (Layer 5) — the project-isolation boundary for file access.
 *
 * Every workspace path an agent names is untrusted. It is resolved against the
 * workspace root and refused if it is absolute, contains a traversal segment,
 * a NUL byte, a drive/UNC prefix, or — after symlink resolution — lands
 * outside the root. Sensitive files are never readable or writable through
 * the agent surface.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";

export type PathRefusal =
  | "invalid_path"
  | "absolute_path"
  | "traversal"
  | "outside_workspace"
  | "sensitive_path"
  | "protected_path";

export class PathRefusedError extends Error {
  constructor(
    readonly reason: PathRefusal,
    message: string,
  ) {
    super(message);
    this.name = "PathRefusedError";
  }
}

const SENSITIVE_FILE =
  /(^|\/)(\.env(\.[^/]*)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^/]*\.(pem|p12|pfx|key|keystore|jks)|service[-_]?account[^/]*\.json|credentials(\.json)?|\.git-credentials|secrets?\.(json|ya?ml|toml))$/i;
const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/i;

/** Normalise separators; never resolves anything on disk. */
export function normalizeRelative(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 400) {
    throw new PathRefusedError(
      "invalid_path",
      "path must be a non-empty string of at most 400 characters",
    );
  }
  if (input.includes("\0"))
    throw new PathRefusedError("invalid_path", "path contains a NUL byte");
  const slashed = input.replace(/\\/g, "/");
  if (
    slashed.startsWith("/") ||
    /^[A-Za-z]:/.test(slashed) ||
    slashed.startsWith("//")
  ) {
    throw new PathRefusedError(
      "absolute_path",
      "absolute paths are not allowed",
    );
  }
  const segments = slashed.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) {
    throw new PathRefusedError(
      "traversal",
      "parent-directory segments are not allowed",
    );
  }
  if (segments.length === 0) return ".";
  return segments.join("/");
}

export function isSensitivePath(relative: string): boolean {
  if (ENV_EXAMPLE.test(relative)) return false;
  return SENSITIVE_FILE.test(relative);
}

/** Paths an agent may never write, create, rename into/out of, or delete. */
export function isProtectedPath(relative: string): boolean {
  return (
    relative === ".git" ||
    relative.startsWith(".git/") ||
    relative === "node_modules" ||
    relative.startsWith("node_modules/") ||
    isSensitivePath(relative)
  );
}

export interface ResolvedPath {
  relative: string;
  absolute: string;
}

/**
 * Resolve `input` inside `root`. `rootReal` must already be the realpath of
 * the workspace root. The deepest EXISTING ancestor is realpath'd so a symlink
 * cannot smuggle a path outside the root (including for paths not yet created).
 */
export async function resolveInside(
  rootReal: string,
  input: unknown,
  options: { allowSensitive?: boolean } = {},
): Promise<ResolvedPath> {
  const relative = normalizeRelative(input);
  if (
    !options.allowSensitive &&
    relative !== "." &&
    isSensitivePath(relative)
  ) {
    throw new PathRefusedError(
      "sensitive_path",
      "access to credential-bearing files is not allowed",
    );
  }
  const absolute = path.resolve(rootReal, relative);
  if (!isInside(rootReal, absolute)) {
    throw new PathRefusedError(
      "outside_workspace",
      "path resolves outside the workspace",
    );
  }
  let probe = absolute;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isInside(rootReal, real)) {
        throw new PathRefusedError(
          "outside_workspace",
          "path resolves outside the workspace (symlink)",
        );
      }
      break;
    } catch (error) {
      if (error instanceof PathRefusedError) throw error;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return { relative, absolute };
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
