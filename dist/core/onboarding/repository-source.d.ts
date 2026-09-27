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
import { type RepositoryEvidence } from "./discovery.js";
export type RepositoryReadFailureCode = "invalid_reference" | "unsupported_provider" | "not_found_or_private" | "unauthorized" | "rate_limited" | "unavailable";
export type RepositoryReadResult = {
    ok: true;
    evidence: RepositoryEvidence;
} | {
    ok: false;
    code: RepositoryReadFailureCode;
    message: string;
};
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
export declare const environmentGitHubCredential: GitHubCredentialProvider;
type FetchLike = (input: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    headers: {
        get(name: string): string | null;
    };
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
export declare class GitHubRepositoryReader implements RepositorySourceReader {
    readonly providers: readonly SourceProvider[];
    private readonly fetchImpl;
    private readonly credentials;
    private readonly maxContentFiles;
    private readonly maxFileBytes;
    private readonly timeoutMs;
    constructor(options?: GitHubRepositoryReaderOptions);
    get privateAccess(): boolean;
    read(request: {
        provider: SourceProvider;
        url: string;
        branch?: string;
    }): Promise<RepositoryReadResult>;
    private headers;
    private get;
    private raw;
    private failureFor;
}
/** A reader that reports nothing is readable (no provider configured). */
export declare class UnavailableRepositoryReader implements RepositorySourceReader {
    readonly providers: readonly SourceProvider[];
    readonly privateAccess = false;
    read(): Promise<RepositoryReadResult>;
}
/** Exactly `https://github.com/<owner>/<name>` (optional `.git`, trailing `/`). */
export declare function parseGitHubTarget(url: string): {
    owner: string;
    name: string;
} | undefined;
export {};
