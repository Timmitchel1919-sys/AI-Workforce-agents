import type { ProjectRepositoryRef } from "../../contracts/index.js";

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/**
 * Validates a project repository reference. Only an https URL with NO
 * embedded credentials, query or fragment is accepted, so a token can never
 * ride along in project metadata. Returns `undefined` when invalid.
 */
export function parseProjectRepositoryRef(
  input: unknown,
): ProjectRepositoryRef | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { url, defaultBranch } = input as Record<string, unknown>;
  if (typeof url !== "string" || typeof defaultBranch !== "string") {
    return undefined;
  }
  if (!BRANCH.test(defaultBranch) || defaultBranch.includes("..")) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname === "" ||
    // Named hosts on the default port only: no IP literals, no localhost.
    parsed.port !== "" ||
    !parsed.hostname.includes(".") ||
    /^[\d.]+$/.test(parsed.hostname) ||
    parsed.hostname.startsWith("[")
  ) {
    return undefined;
  }
  // owner/repo style path: plain segments only (no percent-encoding, no
  // token-shaped or exotic content), at least two of them.
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.length < 2 ||
    !segments.every((segment) => /^[A-Za-z0-9._-]{1,100}$/.test(segment))
  ) {
    return undefined;
  }
  return { url: parsed.toString(), defaultBranch };
}

/** Case-insensitive identity of a repository, ignoring a trailing `.git` or `/`. */
export function repositoryKey(ref: ProjectRepositoryRef): string {
  const parsed = new URL(ref.url);
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
}
