/**
 * Pure path-safety policy for Money Mind file access. Shared by the in-memory
 * fixture backend (tests, demo) and the real filesystem backend so the exact
 * same traversal / denylist rules are exercised regardless of which one is
 * under test.
 *
 * `resolveSafeRelativePath` never touches disk — it only decides whether a
 * caller-supplied path string is even eligible to be looked up. The real
 * filesystem backend additionally re-checks containment against the resolved
 * absolute path (belt-and-braces against symlink or OS-specific edge cases).
 */
import { ValidationError } from "../../../contracts/index.js";

const SENSITIVE_SEGMENT_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.git$/i,
  /^\.firebase$/i,
  /^node_modules$/i,
  /credential/i,
  /secret/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /serviceaccount.*\.json$/i,
  /firebase-debug\.log$/i,
];

export function isSensitiveSegment(segment: string): boolean {
  return SENSITIVE_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment));
}

export function isSensitivePath(path: string): boolean {
  return path.split("/").some(isSensitiveSegment);
}

/**
 * Normalize and validate a caller-supplied path as relative to the Money Mind
 * repository root. Throws `ValidationError` (never a raw filesystem error) on
 * anything unsafe: empty, absolute (POSIX or Windows drive-letter), containing
 * a `..` segment, a NUL byte, or a sensitive file/directory name.
 */
export function resolveSafeRelativePath(relPath: string): string {
  if (typeof relPath !== "string") {
    throw new ValidationError("path must be a string");
  }
  if (relPath.trim() === "") {
    return ""; // the repository root itself — a valid, explicit target
  }
  if (relPath.includes("\0")) {
    throw new ValidationError(
      `path contains an invalid character: "${relPath}"`,
    );
  }

  const normalized = relPath.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new ValidationError(
      `path must be relative to the money-mind repository root: "${relPath}"`,
    );
  }

  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) {
    return "";
  }
  if (segments.some((s) => s === "..")) {
    throw new ValidationError(`path traversal is not allowed: "${relPath}"`);
  }
  if (segments.some(isSensitiveSegment)) {
    throw new ValidationError(
      `access to this path is not permitted: "${relPath}"`,
    );
  }
  return segments.join("/");
}

/** Directory names never descended into by structure inspection. */
export const MONEY_MIND_IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".git",
  ".firebase",
]);
