import { inspect } from "node:util";
import type { Entity, Repository } from "../../contracts/persistence.js";
export declare class Secret {
    #private;
    constructor(value: string);
    reveal(): string;
    toString(): string;
    toJSON(): string;
    [inspect.custom](): string;
}
export declare class VaultError extends Error {
    readonly code: "no_key" | "not_found" | "invalid" | "expired" | "tampered";
    constructor(code: "no_key" | "not_found" | "invalid" | "expired" | "tampered", message: string);
}
export interface StoredCredential extends Entity {
    /** id === ref, e.g. `cred:github` or `cred:github:aims`. */
    ref: string;
    connectorId: string;
    kind: "api_key" | "token" | "basic" | "oauth2" | "webhook_secret";
    /** base64(iv):base64(tag):base64(ciphertext) */
    sealed: string;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    /** Which user stored it — metadata only. */
    createdBy: string;
}
export interface CredentialMeta {
    ref: string;
    connectorId: string;
    kind: StoredCredential["kind"];
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
    createdBy: string;
}
export declare class CredentialVault {
    private readonly clock;
    private readonly repo;
    private readonly key;
    readonly uses: Record<string, number>;
    constructor(repo: Repository<StoredCredential>, clock: () => string, options?: {
        key?: string;
        env?: NodeJS.ProcessEnv;
    });
    private readonly env;
    /** True when secrets can be stored (a key is configured). */
    get canStore(): boolean;
    private seal;
    private unseal;
    static refFor(connectorId: string, purpose?: string): string;
    store(input: {
        ref: string;
        connectorId: string;
        kind: StoredCredential["kind"];
        value: string;
        by: string;
        expiresAt?: string;
    }): CredentialMeta;
    has(ref: string): boolean;
    private meta;
    metadata(ref: string): CredentialMeta | undefined;
    list(connectorId?: string): CredentialMeta[];
    revoke(ref: string): boolean;
    /**
     * Run `fn` with the secret. The secret is never returned; only what `fn` returns leaves.
     * `env:NAME` references resolve to a server-side environment variable.
     */
    use<T>(ref: string, purpose: string, fn: (secret: Secret) => Promise<T> | T): Promise<T>;
}
export interface OAuthProviderConfig {
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    scopes: string[];
    /** Server-side environment variable names holding the OAuth client credentials. */
    clientIdEnv: string;
    clientSecretEnv: string;
    /** Extra authorize params (e.g. Google `access_type=offline`). */
    extraAuthorizeParams?: Record<string, string>;
    /** Token endpoint wants JSON instead of form encoding. */
    jsonTokenRequest?: boolean;
}
export interface OAuthStateRecord extends Entity {
    stateHash: string;
    connectorId: string;
    verifier: string;
    redirectUri: string;
    by: string;
    expiresAt: string;
    used: boolean;
}
type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "manual" | "follow";
}) => Promise<{
    ok: boolean;
    status: number;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
}>;
export declare class OAuthManager {
    private readonly vault;
    private readonly clock;
    private readonly fetchImpl;
    private readonly env;
    private readonly states;
    constructor(states: Repository<OAuthStateRecord>, vault: CredentialVault, clock: () => string, fetchImpl?: FetchLike, env?: NodeJS.ProcessEnv);
    isConfigured(cfg: OAuthProviderConfig): boolean;
    begin(connectorId: string, cfg: OAuthProviderConfig, redirectUri: string, by: string): {
        authorizeUrl: string;
        expiresAt: string;
    };
    private tokenRequest;
    /** Complete the code exchange. The state is single-use and expires. */
    complete(state: string, code: string, cfg: OAuthProviderConfig, by: string): Promise<{
        connectorId: string;
        expiresAt?: string;
    }>;
    /** Access token for a connector, refreshing it first when it expires within a minute. */
    accessToken<T>(connectorId: string, cfg: OAuthProviderConfig | undefined, fn: (token: Secret) => Promise<T>): Promise<T>;
    /** Revoke at the provider when it supports it, then forget the credential either way. */
    revoke(connectorId: string, cfg: OAuthProviderConfig | undefined): Promise<{
        revokedAtProvider: boolean;
    }>;
}
export {};
