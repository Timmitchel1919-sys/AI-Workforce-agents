/**
 * AccessService — AUTHZ-1 operator access lifecycle.
 *
 * Firebase Authentication says WHO a user is; this service decides WHAT they
 * may do. It is the only writer of `OperatorAccount` records and the only
 * source of an `OperatorPrincipal`:
 *
 *   verified identity → account (by Firebase UID) → ACTIVE + role → principal
 *   anything else (no account, pending, rejected, suspended, revoked) → none
 *
 * Rules enforced here (never in the browser):
 *   - a new identity is recorded as PENDING — never granted anything;
 *   - only an active administrator (`manage_access`) changes accounts;
 *   - an administrator cannot change their own account;
 *   - a granted role can never outrank the granting role (least privilege);
 *   - project scopes must name registered projects;
 *   - the last active administrator cannot be suspended, revoked or demoted
 *     (enforced atomically by the store);
 *   - the initial administrator bootstrap works once, then locks.
 * Every change is audited (`access_event`), with no token or credential.
 */
import { type MyAccessView, type OperatorAccountStore, type OperatorAccountView, type OperatorPrincipal, type VerifiedIdentity } from "../../contracts/index.js";
import { type AuditLog } from "../audit/audit-log.js";
export interface AccessServiceOptions {
    store: OperatorAccountStore;
    audit: AuditLog;
    /** Project existence for scope validation (the ProjectRegistry). */
    projects: {
        has(projectId: string): boolean;
    };
    clock?: () => string;
    /**
     * Identity-provider refresh-token revocation (Firebase Admin). Optional:
     * without it, "sign out all devices" still refuses every existing ID token,
     * but a device holding a refresh token could mint a new one — the result
     * reports that honestly.
     */
    identityProvider?: {
        revokeRefreshTokens?(uid: string): Promise<void>;
    };
}
export interface AccessActor {
    principal: OperatorPrincipal;
    correlationId?: string;
}
export type AccessAction = "approve" | "reject" | "suspend" | "reactivate" | "revoke" | "change_role";
export declare class AccessService {
    private readonly options;
    private readonly clock;
    constructor(options: AccessServiceOptions);
    /** The principal for an identity, or null unless the account is ACTIVE. */
    resolvePrincipal(identity: VerifiedIdentity): Promise<OperatorPrincipal | null>;
    /** True when this token predates the account's last "sign out all devices". */
    isSessionRevoked(identity: VerifiedIdentity): Promise<boolean>;
    /**
     * `GET /api/me/access`. A first visit records a PENDING access request —
     * never access. Profile fields are refreshed from the verified token.
     */
    myAccess(identity: VerifiedIdentity): Promise<MyAccessView>;
    /**
     * "Sign out all devices" for the caller's OWN account. Reduces access only,
     * so it needs no extra approval. Every ID token issued before now is refused
     * from the next request on, and the identity provider's refresh tokens are
     * revoked when that capability is wired. Idempotent: repeating it just moves
     * the cut-off forward.
     */
    revokeOwnSessions(identity: VerifiedIdentity, correlationId?: string): Promise<{
        sessionsValidAfter: number;
        refreshTokensRevoked: boolean;
    }>;
    listAccounts(principal: OperatorPrincipal): Promise<OperatorAccountView[]>;
    /**
     * Apply one administrative action. Validation order: capability → target
     * exists → not self → allowed transition → role/scope → atomic commit.
     */
    apply(action: AccessAction, actor: AccessActor, input: {
        operatorId: string;
        role?: unknown;
        allowedProjects?: unknown;
        reason?: unknown;
    }): Promise<OperatorAccountView>;
    /**
     * Provision the FIRST administrator for an existing Firebase identity.
     * Idempotent for the same identity; refused once any administrator exists.
     * Never reachable through the HTTP API.
     */
    bootstrapInitialAdmin(identity: VerifiedIdentity): Promise<"created" | "already_provisioned">;
    private requireManage;
    private grantableRole;
    private validScope;
    private record;
}
