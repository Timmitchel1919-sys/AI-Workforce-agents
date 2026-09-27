/**
 * Read-only repository source (PROJECT-2).
 *
 *   Control Plane → RepositorySourceReader → provider REST API (read-only)
 *
 * The reader fetches a file LISTING plus the content of a tiny allow-list of
 * manifests (`isContentAllowlisted`). It never clones, never writes, never
 * shells out. Credentials are server-side only: an optional token comes from
 * a `GitHubCredentialProvider` (default: a server environment secret), is
 * sent only as an Authorization header to api.github.com, and is never
 * placed in a URL, an error message, a log line or any returned value.
 *
 * REPOSITORY CONNECTED != REPOSITORY AUTHORIZED: when a repository is not
 * readable with the configured credential (or none is configured) the read
 * fails with an honest, actionable code instead of pretending.
 */
import type { SourceProvider } from "../../contracts/onboarding.js";
import { parseProjectRepositoryRef } from "../registry/project-repository-ref.js";
import {
  isContentAllowlisted,
  type RepositoryEvidence,
} from "./discovery.js";

export type RepositoryReadFailureCode =
  | "invalid_reference"
  | "unsupported_provider"
  | "not_found_or_private"
  | "unauthorized"
  | "rate_limited"
  | "unavailable";

export type RepositoryReadResult =
  | { ok: true; evidence: RepositoryEvidence }
  | { ok: false; code: RepositoryReadFailureCode; message: string };

export interface RepositorySourceReader {
  /** Providers this reader can genuinely read (used for honest capability views). */
  readonly providers: readonly SourceProvider[];
  /** True when a credential for private repositories is configured. */
  readonly privateAccess: boolean;
  read(request: {
    provider: SourceProvider;
    url: string;
    branch?: string;
  }): Promise<RepositoryReadResult>;
}

/** Yields a server-held read token, or undefined when none is configured. */
export interface GitHubCredentialProvider {
  token(): string | undefined;
}

export const environmentGitHubCredential: GitHubCredentialProvider = {
  token: () => {
    const value = process.env["AI_WORKFORCE_GITHUB_READ_TOKEN"];
    return value && value.trim() !== "" ? value.trim() : undefined;
  },
};

type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface GitHubRepositoryReaderOptions {
  fetch?: FetchLike;
  credentials?: GitHubCredentialProvider;
  maxContentFiles?: number;
  maxFileBytes?: number;
  timeoutMs?: number;
}

const API = "https://api.github.com";
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export class GitHubRepositoryReader implements RepositorySourceReader {
  readonly providers: readonly SourceProvider[] = ["github"];
  private readonly fetchImpl: FetchLike;
  private readonly credentials: GitHubCredentialProvider;
  private readonly maxContentFiles: number;
  private readonly maxFileBytes: number;
  private readonly timeoutMs: number;

  constructor(options: GitHubRepositoryReaderOptions = {}) {
    this.fetchImpl =
      options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.credentials = options.credentials ?? environmentGitHubCredential;
    this.maxContentFiles = options.maxContentFiles ?? 30;
    this.maxFileBytes = options.maxFileBytes ?? 200_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get privateAccess(): boolean {
    return this.credentials.token() !== undefined;
  }

  async read(request: {
    provider: SourceProvider;
    url: string;
    branch?: string;
  }): Promise<RepositoryReadResult> {
    if (request.provider !== "github") {
      return {
        ok: false,
        code: "unsupported_provider",
        message: `provider "${request.provider}" has no repository reader`,
      };
    }
    const target = parseGitHubTarget(request.url);
    if (!target) {
      return {
        ok: false,
        code: "invalid_reference",
        message:
          "repository must be a credential-free https://github.com/<owner>/<name> URL",
      };
    }
    if (request.branch !== undefined && !BRANCH.test(request.branch)) {
      return { ok: false, code: "invalid_reference", message: "invalid branch name" };
    }
    const { owner, name } = target;
    const base = `${API}/repos/${owner}/${name}`;

    const repo = await this.get(base);
    if (!repo.ok) return repo.failure;
    const info = repo.value as {
      private?: boolean;
      default_branch?: string;
    };
    const defaultBranch =
      typeof info.default_branch === "string" && BRANCH.test(info.default_branch)
        ? info.default_branch
        : undefined;
    const branch = request.branch ?? defaultBranch;
    if (!branch) {
      return { ok: false, code: "unavailable", message: "default branch unavailable" };
    }

    const branchInfo = await this.get(`${base}/branches/${encodeURIComponent(branch)}`);
    if (!branchInfo.ok) return branchInfo.failure;
    const commit = (branchInfo.value as {
      commit?: { sha?: string; commit?: { tree?: { sha?: string } } };
    }).commit;
    const commitSha = commit?.sha;
    const treeSha = commit?.commit?.tree?.sha;
    if (!isSha(commitSha) || !isSha(treeSha)) {
      return { ok: false, code: "unavailable", message: "branch commit unavailable" };
    }

    const tree = await this.get(`${base}/git/trees/${treeSha}?recursive=1`);
    if (!tree.ok) return tree.failure;
    const treeBody = tree.value as {
      tree?: Array<{ path?: string; type?: string; size?: number }>;
      truncated?: boolean;
    };
    const entries = Array.isArray(treeBody.tree) ? treeBody.tree : [];
    const paths: string[] = [];
    const fetchable: string[] = [];
    for (const entry of entries) {
      if (typeof entry.path !== "string" || !safePath(entry.path)) continue;
      paths.push(entry.path);
      if (
        entry.type === "blob" &&
        isContentAllowlisted(entry.path) &&
        (entry.size ?? 0) <= this.maxFileBytes
      ) {
        fetchable.push(entry.path);
      }
    }
    // Root manifests first, then nested ones, capped.
    fetchable.sort((a, b) => a.split("/").length - b.split("/").length);
    const files: Record<string, string> = {};
    for (const path of fetchable.slice(0, this.maxContentFiles)) {
      const text = await this.raw(
        `${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commitSha}`,
      );
      if (text !== undefined) files[path] = text.slice(0, this.maxFileBytes);
    }

    return {
      ok: true,
      evidence: {
        provider: "github",
        url: `https://github.com/${owner}/${name}`,
        visibility: info.private === true ? "private" : info.private === false ? "public" : "unknown",
        defaultBranch: defaultBranch ?? branch,
        branch,
        commit: commitSha,
        paths,
        truncated: treeBody.truncated === true,
        files,
      },
    };
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept,
      "user-agent": "ai-workforce-onboarding",
      "x-github-api-version": "2022-11-28",
    };
    const token = this.credentials.token();
    if (token) headers["authorization"] = `Bearer ${token}`;
    return headers;
  }

  private async get(
    url: string,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; failure: { ok: false; code: RepositoryReadFailureCode; message: string } }
  > {
    try {
      const response = await this.fetchImpl(url, {
        headers: this.headers("application/vnd.github+json"),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) return { ok: true, value: await response.json() };
      return { ok: false, failure: this.failureFor(response.status, response.headers.get("x-ratelimit-remaining")) };
    } catch {
      return {
        ok: false,
        failure: { ok: false, code: "unavailable", message: "the repository provider could not be reached" },
      };
    }
  }

  private async raw(url: string): Promise<string | undefined> {
    try {
      const response = await this.fetchImpl(url, {
        headers: this.headers("application/vnd.github.raw+json"),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok ? await response.text() : undefined;
    } catch {
      return undefined;
    }
  }

  private failureFor(
    status: number,
    rateRemaining: string | null,
  ): { ok: false; code: RepositoryReadFailureCode; message: string } {
    if (status === 404) {
      return {
        ok: false,
        code: "not_found_or_private",
        message: this.privateAccess
          ? "repository not found, or the configured GitHub credential cannot read it"
          : "repository not found or private: private repositories need the server-side GitHub integration, which is not configured",
      };
    }
    if (status === 401) {
      return { ok: false, code: "unauthorized", message: "the configured GitHub credential was rejected" };
    }
    if (status === 403 || status === 429) {
      return rateRemaining === "0" || status === 429
        ? { ok: false, code: "rate_limited", message: "the GitHub API rate limit was reached; retry later" }
        : { ok: false, code: "unauthorized", message: "access to the repository was denied" };
    }
    return { ok: false, code: "unavailable", message: `the repository provider returned an error (${status})` };
  }
}

/** A reader that reports nothing is readable (no provider configured). */
export class UnavailableRepositoryReader implements RepositorySourceReader {
  readonly providers: readonly SourceProvider[] = [];
  readonly privateAccess = false;
  async read(): Promise<RepositoryReadResult> {
    return {
      ok: false,
      code: "unsupported_provider",
      message: "no repository reader is configured",
    };
  }
}

/** Exactly `https://github.com/<owner>/<name>` (optional `.git`, trailing `/`). */
export function parseGitHubTarget(
  url: string,
): { owner: string; name: string } | undefined {
  const ref = parseProjectRepositoryRef({ url, defaultBranch: "main" });
  if (!ref) return undefined;
  const parsed = new URL(ref.url);
  if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return undefined;
  const owner = segments[0]!;
  const name = segments[1]!.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) return undefined;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === "..") {
    return undefined;
  }
  return { owner, name };
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

/** Repository-relative path with no traversal or control characters. */
function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length < 400 &&
    !path.startsWith("/") &&
    !path.split("/").some((segment) => segment === ".." || segment === "") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(path)
  );
}
