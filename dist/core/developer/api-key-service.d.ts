import { type ApiKey, type ApiKeyPrincipal, type IssuedApiKey } from "../../contracts/index.js";
/**
 * In-memory credential store. A production deployment backs this with a
 * durable store; the interface and the scoping rules are the contract that
 * store must honour.
 */
export declare class ApiKeyService {
    private readonly clock;
    private readonly keys;
    /**
     * @param clock Millisecond epoch source. Injected so expiry is testable
     *   without sleeping, matching `WorkflowEngine`'s clock seam.
     */
    constructor(clock?: () => number);
    createKey(organizationId: string, name: string, scopes: readonly string[], expiresInDays?: number): IssuedApiKey;
    /**
     * Verify a presented credential. Returns the authenticated principal, or
     * `null` when the credential is unknown, revoked, expired, or malformed.
     *
     * All failure modes collapse to `null` so a caller cannot distinguish
     * "no such key" from "wrong secret".
     */
    verify(presented: unknown, requiredScope?: string): ApiKeyPrincipal | null;
    /**
     * Revoke a key owned by `organizationId`. A key belonging to another tenant
     * is reported as not-found rather than forbidden, so revocation cannot be
     * used to probe for key ids.
     */
    revokeKey(organizationId: string, keyId: string): ApiKey;
    listKeys(organizationId: string): ApiKey[];
    /**
     * Assert an authenticated principal holds a scope, so scope checks happen in
     * exactly one place at the API boundary.
     */
    static requireScope(principal: ApiKeyPrincipal, scope: string): void;
    private findByLocator;
    private copy;
}
