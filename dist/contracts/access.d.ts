import { type ControlCapability, type OperatorPrincipal, type OperatorRole } from "./control.js";
export declare const OPERATOR_ACCOUNT_STATUSES: readonly ["pending", "active", "suspended", "rejected", "revoked"];
export type OperatorAccountStatus = (typeof OPERATOR_ACCOUNT_STATUSES)[number];
/** Role hierarchy (least → most privileged). A role may only grant ≤ itself. */
export declare const ROLE_RANK: Readonly<Record<OperatorRole, number>>;
/** The authoritative authorization record for one Firebase identity. */
export interface OperatorAccount {
    /** The Firebase Auth UID (stable identity). */
    id: string;
    status: OperatorAccountStatus;
    /** Set once approved; kept on suspended/revoked accounts for history. */
    role?: OperatorRole;
    /** `"*"` = every project; otherwise an explicit allow-list. */
    allowedProjects: readonly string[] | "*";
    /** Minimal profile from the verified token, for administrators only. */
    email?: string;
    displayName?: string;
    emailVerified: boolean;
    requestedAt: string;
    updatedAt: string;
    decidedBy?: string;
    decidedAt?: string;
    statusReason?: string;
    /** True for the account created by the initial administrator bootstrap. */
    bootstrap?: boolean;
    /** Optimistic-concurrency counter; bumped on every committed change. */
    revision: number;
}
/** A verified Firebase identity — authentication only, no authorization. */
export interface VerifiedIdentity {
    uid: string;
    email?: string;
    displayName?: string;
    emailVerified: boolean;
}
/** Verifies an opaque credential (Firebase ID token) → identity or null. */
export interface IdentityVerifier {
    verify(credential: string): Promise<VerifiedIdentity | null>;
}
/** `GET /api/me/access` — what the signed-in user may do. Safe for the UI. */
export interface MyAccessView {
    authenticated: true;
    authorized: boolean;
    status: OperatorAccountStatus;
    role?: OperatorRole;
    allowedProjects?: readonly string[] | "*";
    /** Capabilities of the active role — UX only; the backend re-checks. */
    capabilities: readonly ControlCapability[];
}
/** One account as shown to an administrator (Users & Access). */
export interface OperatorAccountView {
    operatorId: string;
    email?: string;
    displayName?: string;
    emailVerified: boolean;
    status: OperatorAccountStatus;
    role?: OperatorRole;
    allowedProjects: readonly string[] | "*";
    requestedAt: string;
    updatedAt: string;
    decidedAt?: string;
    statusReason?: string;
    /** The requesting administrator's own account (self-changes are refused). */
    isSelf: boolean;
}
export type OperatorAccountChange = 
/** Create a pending account unless one exists (idempotent). */
{
    kind: "create_pending";
    account: OperatorAccount;
}
/**
 * Replace an account if it is still at `expectedRevision`. `activeAdminDelta`
 * adjusts the atomic active-administrator count; a change that would leave
 * zero active administrators is refused (`LastAdministratorError`, see contracts/index.ts).
 */
 | {
    kind: "update";
    account: OperatorAccount;
    expectedRevision: number;
    activeAdminDelta: -1 | 0 | 1;
}
/**
 * One-time initial administrator. Refused (`BootstrapLockedError`) once the
 * bootstrap lock exists for another identity or any active administrator
 * exists. Re-running for the same, still-active administrator is a no-op.
 */
 | {
    kind: "bootstrap";
    account: OperatorAccount;
};
export type OperatorAccountCommitResult = "committed" | "exists" | "already_provisioned";
/** Authoritative, transactional account storage (Firestore in production). */
export interface OperatorAccountStore {
    get(operatorId: string): Promise<OperatorAccount | undefined>;
    list(): Promise<OperatorAccount[]>;
    commit(change: OperatorAccountChange): Promise<OperatorAccountCommitResult>;
}
export declare function isActiveAdmin(account: OperatorAccount | undefined): boolean;
/**
 * The single authorization decision: only an ACTIVE account with a role
 * yields a principal. Pending, rejected, suspended, revoked or missing → null.
 */
export declare function principalFor(account: OperatorAccount | undefined): OperatorPrincipal | null;
export declare function capabilitiesFor(account: OperatorAccount | undefined): readonly ControlCapability[];
export declare function validateOperatorAccount(account: OperatorAccount): void;
