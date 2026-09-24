/**
 * Operator access contracts — AUTHZ-1.
 *
 * AUTHENTICATION ≠ AUTHORIZATION. Firebase Authentication proves WHO a user
 * is (a verified ID token → a stable Firebase UID). This module describes
 * WHAT that user may do in AI Workforce: an `OperatorAccount` keyed by the
 * Firebase UID, with one authoritative lifecycle and one of the existing
 * operator roles (`viewer` | `operator` | `admin`).
 *
 *   pending ──approve──▶ active ──suspend──▶ suspended ──reactivate──▶ active
 *      │                   │                     │
 *      └─reject─▶ rejected └──────revoke─────────┴──▶ revoked (terminal)
 *   rejected ──approve──▶ active
 *
 * Only an ACTIVE account with a role authorizes Control Plane access. Every
 * mutation is made server-side, atomically, and audited. Nothing here stores
 * a password, a token, or a credential.
 */
import { ValidationError, requireText } from "./index.js";
import { OPERATOR_ROLES, ROLE_CAPABILITIES, } from "./control.js";
export const OPERATOR_ACCOUNT_STATUSES = [
    "pending",
    "active",
    "suspended",
    "rejected",
    "revoked",
];
/** Role hierarchy (least → most privileged). A role may only grant ≤ itself. */
export const ROLE_RANK = {
    viewer: 1,
    operator: 2,
    admin: 3,
};
/* ------------------------------------------------------------------ */
/* Helpers + validation                                               */
/* ------------------------------------------------------------------ */
export function isActiveAdmin(account) {
    return account?.status === "active" && account.role === "admin";
}
/**
 * The single authorization decision: only an ACTIVE account with a role
 * yields a principal. Pending, rejected, suspended, revoked or missing → null.
 */
export function principalFor(account) {
    if (!account || account.status !== "active" || !account.role)
        return null;
    return {
        id: account.id,
        role: account.role,
        allowedProjects: account.allowedProjects,
    };
}
export function capabilitiesFor(account) {
    if (account?.status !== "active" || !account.role)
        return [];
    return ROLE_CAPABILITIES[account.role] ?? [];
}
export function validateOperatorAccount(account) {
    if (!account || typeof account !== "object") {
        throw new ValidationError("operator account must be an object");
    }
    requireText(account.id, "account.id");
    if (!OPERATOR_ACCOUNT_STATUSES.includes(account.status)) {
        throw new ValidationError("account.status is not a known status");
    }
    if (account.role !== undefined && !OPERATOR_ROLES.includes(account.role)) {
        throw new ValidationError("account.role is not a known role");
    }
    if (account.status === "active" && account.role === undefined) {
        throw new ValidationError("an active account must have a role");
    }
    if (account.allowedProjects !== "*" &&
        (!Array.isArray(account.allowedProjects) ||
            !account.allowedProjects.every((p) => typeof p === "string"))) {
        throw new ValidationError('account.allowedProjects must be "*" or a list of project ids');
    }
    if (typeof account.emailVerified !== "boolean") {
        throw new ValidationError("account.emailVerified must be a boolean");
    }
    if (!Number.isInteger(account.revision) || account.revision < 1) {
        throw new ValidationError("account.revision must be a positive integer");
    }
    requireText(account.requestedAt, "account.requestedAt");
    requireText(account.updatedAt, "account.updatedAt");
}
