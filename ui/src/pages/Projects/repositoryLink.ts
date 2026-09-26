/**
 * Defensive client-side check for the optional repository reference. The Control Plane already
 * validates it; this only refuses to render anything that could be a credentialed or non-https
 * link. Returns null (=> render nothing) unless the URL is plain https without user info.
 */
export interface RepositoryLink {
  href: string;
  text: string;
  defaultBranch: string;
}

export function safeRepositoryLink(
  repository: { url?: unknown; defaultBranch?: unknown } | null | undefined,
): RepositoryLink | null {
  if (!repository || typeof repository.url !== "string" || typeof repository.defaultBranch !== "string") return null;
  const raw = repository.url.trim();
  if (!raw.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") return null;
  // Mirror the server rules: no port, query or fragment, and a named host.
  if (url.port !== "" || url.search !== "" || url.hash !== "" || !url.hostname.includes(".")) return null;
  // A user:pass@ that URL parsing normalises away must still be rejected.
  if (/^https:\/\/[^/]*@/.test(raw)) return null;
  const branch = repository.defaultBranch.trim();
  if (branch === "") return null;
  const path = url.pathname.replace(/\/+$/, "");
  return { href: url.toString(), text: `${url.host}${path}`, defaultBranch: branch };
}
